'use strict';
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ApiError, thumb, ID_RE } = require('./util');
const resolver = require('./resolver');
const searchSvc = require('./search');
const localfiles = require('./localfiles');

const S = { IDLE: 'IDLE', RESOLVING: 'RESOLVING', PLAYING: 'PLAYING', PAUSED: 'PAUSED', ERROR: 'ERROR' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// MC nói: nhạc hạ xuống nhanh (0,3 giây), trở lại chậm hơn (0,8 giây) cho tự nhiên
const DUCK_DOWN_MS = 300, DUCK_UP_MS = 800;
const SFX_DUCK_WATCHDOG_MS = 180000; // phòng cửa sổ phát bị đóng đột ngột lúc hiệu ứng đang chạy: tự trả nhạc sau 3 phút
// Nút giữ (phím M / nhấn giữ trên điện thoại) mà quên nhả thì tự trả nhạc sau chừng này; bên giữ gửi lại tín hiệu mỗi ~12 giây
const DUCK_WATCHDOG_MS = 45000;

function newItem(o) {
  return {
    itemId: crypto.randomUUID(), videoId: o.videoId, title: o.title, channel: o.channel || '',
    durationSec: o.durationSec | 0, addedBy: o.addedBy || null, addedAt: Date.now(),
    status: 'PENDING', source: o.source || 'USER', local: o.local || null // local = đường dẫn file trong máy
  };
}
function itemJson(it) {
  return {
    itemId: it.itemId, videoId: it.videoId, title: it.title, channel: it.channel,
    thumbnailUrl: it.local ? '' : thumb(it.videoId), local: !!it.local, durationSec: it.durationSec, addedBy: it.addedBy,
    addedAtEpochMs: it.addedAt, status: it.status, source: it.source
  };
}

/**
 * Bộ não: hàng đợi + máy trạng thái phát. Việc phát video thật nằm ở cửa sổ (renderer):
 *  - controller phát lệnh qua sự kiện 'player' ({type:'load'|'pause'|'resume'|'seek'|'volume'|'stop'})
 *  - cửa sổ báo lại bằng playerEvent(kind,key,a,b): started | ended | error | pos
 */
class Controller extends EventEmitter {
  /** downloads: DownloadLibrary (bài YouTube đã tải sẵn về máy) hoặc null. Có thể gắn sau bằng setDownloads(). */
  constructor(settings, store, seedFile, downloads) {
    super();
    this.settings = settings;
    this.downloads = downloads || null;
    this.offlineKey = null; // itemId của bài đang phát từ file đã tải (item.local vẫn null để thẻ bài giữ thông tin YouTube)
    this.store = store;
    this.seedFile = seedFile;
    this.queue = [];
    this.current = null;
    this.state = S.IDLE;
    this.queueVersion = 0;
    this.volume = 100;
    this.seq = 0;
    this.karaoke = false;
    this.favVersion = 0;
    this.dlVer = 0;          // tăng mỗi khi danh sách bài đã tải đổi: giao diện thấy số này đổi thì lấy lại danh sách mã
    // âm lượng "mềm" (nhân thêm vào âm lượng chính): MC nói + fade out
    this.duck = false; this.duckWd = null;
    this.sfxDuck = false; this.sfxDuckWd = null; // hạ nhạc tự động khi hiệu ứng âm thanh riêng đang phát (độc lập với nút MC)
    this.fading = false; this.fadedOut = false; this.fadeTimer = null;

    this.sources = [];
    this.srcIdx = 0;
    this.lastItemId = null;
    this.reresolved = false;
    this.stallRetries = 0;
    this.consecutiveFails = 0;
    this.streamFailStreak = 0;
    this.halted = false;
    this.userPaused = false;
    this.forceIframeItem = null;
    this.fallbackHint = false;
    this.netWait = false;
    this.usingIframe = false;
    this.playerAttached = false; // có cửa sổ nào đang giữ trình phát hay chưa
    this.pos = 0;
    this.dur = 0;
    this.prefetchedId = null;
    this.startTimer = null;
    this.retryTimer = null;
    this.playToken = 0;

    this.seedPool = [];
    this.seedFilling = false;
    this.lastSeedId = null;

    this.errorSeq = 0; this.errCode = ''; this.errMsg = '';
    this.lastActor = null; this.lastActorAt = 0;
    this.lastPos = -1; this.lastPosChangeAt = 0;

    this.search = { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null };
    this.ui = { seq: 0, state: S.IDLE, nowTitle: null, nextText: null, iframe: false, noCurrent: true, message: null };
  }

  start() {
    this.restore();
    this.tickTimer = setInterval(() => { try { this.tick(); } catch (e) { /* watchdog không được chết */ } }, 1000);
    this.startNext();
  }
  stop() { clearInterval(this.tickTimer); clearTimeout(this.duckWd); clearTimeout(this.sfxDuckWd); clearTimeout(this.fadeTimer); }

  // ---------------------------------------------------------------- tìm kiếm dùng chung TV <-> remote
  searchBegin(q, source) {
    const o = this.search;
    this.search = { version: o.version + 1, query: q, source, results: [], hasMore: false, page: 0, loading: true, error: null };
    this.emit('search', this.search);
  }
  searchLoadingMore() {
    this.search = { ...this.search, version: this.search.version + 1, loading: true, error: null };
    this.emit('search', this.search);
  }
  searchDone(q, source, page, hits, hasMore) {
    const o = this.search;
    let list = hits;
    if (page > 0 && o.query === q) list = o.results.concat(hits.filter(h => !o.results.some(x => x.videoId === h.videoId)));
    this.search = { version: o.version + 1, query: q, source, results: list.slice(0, 120), hasMore, page, loading: false, error: null };
    this.emit('search', this.search);
  }
  searchFail(q, source, msg) {
    const o = this.search;
    this.search = { version: o.version + 1, query: q, source, results: o.query === q ? o.results : [], hasMore: false, page: o.page, loading: false, error: msg };
    this.emit('search', this.search);
  }
  async runSearch(q, page, source) {
    // dùng cho cả TV lẫn remote; trả về { hits, hasMore }
    return searchSvc.search(q, page, this.karaoke);
  }

  setDownloads(lib) { this.downloads = lib || null; this.prefetchedId = null; }

  setKaraoke(on) { this.karaoke = !!on; this.emit('karaoke', this.karaoke); }
  react(id) { this.emit('reaction', id); }
  // hiệu ứng âm thanh riêng: remote/máy tính gọi, main.js lắng nghe rồi phát
  sfx(id) { this.emit('sfx', String(id)); }
  sfxStop() { this.emit('sfx-stop'); }
  message(sender, text) { this.emit('message', { sender, text }); }
  /** Danh sách bài đã tải vừa đổi (tải xong, quét lại, bài hỏng bị bỏ): báo giao diện lấy lại. */
  noteDownloadsChanged() { this.dlVer++; }
  noteFavsChangedByRemote() { this.favVersion++; this.emit('favs'); }
  bumpFavVersion() { this.favVersion++; }
  catsChanged() { this.emit('cats'); }
  noteActor(by) { this.lastActor = by || null; this.lastActorAt = Date.now(); }
  lastActorName() { return (this.lastActor || '').trim() || null; }

  // ---------------------------------------------------------------- lệnh
  pendingVideoIds() {
    const s = new Set(this.queue.map(i => i.videoId));
    if (this.current && this.current.source === 'USER') s.add(this.current.videoId);
    return s;
  }

  /** Trả về 0 = phát ngay, 1 = vào hàng đợi, 2 = đã có, 3 = đầy. */
  addFromTv(videoId, title, channel, durationSec, priority) {
    const idle = !this.current || this.current.source === 'SEED';
    try {
      if (idle) {
        this.add(videoId, title, channel, durationSec, 'TV', 'next', true);
        if (this.current && this.current.videoId !== videoId) this.skip();
        return 0;
      }
      this.add(videoId, title, channel, durationSec, 'TV', priority ? 'next' : 'end', false);
      return 1;
    } catch (e) {
      if (e.code === 'QUEUE_FULL') return 3;
      return 2;
    }
  }

  /** File trong máy: giống addFromTv (0 = phát ngay, 1 = vào hàng đợi, 2 = đã có, 3 = đầy). Đường dẫn do tiến trình chính kiểm tra trước. */
  addLocalFromTv(filePath, priority) {
    const id = localfiles.idFor(filePath), title = localfiles.titleOf(filePath);
    const idle = !this.current || this.current.source === 'SEED';
    try {
      if (idle) {
        this.add(id, title, '', 0, 'TV', 'next', true, filePath);
        if (this.current && this.current.videoId !== id) this.skip();
        return 0;
      }
      this.add(id, title, 'Trong máy', 0, 'TV', priority ? 'next' : 'end', false, filePath);
      return 1;
    } catch (e) {
      if (e.code === 'QUEUE_FULL') return 3;
      return 2;
    }
  }
  /** "Phát ngay": đưa lên đầu hàng đợi rồi chuyển bài (cho phép phát lại dù bài đã có trong hàng đợi). */
  playLocalNow(filePath) {
    const id = localfiles.idFor(filePath);
    if (this.current && this.current.videoId === id) { this.replayCurrent(); return 0; }
    const dup = this.queue.find(i => i.videoId === id);
    if (dup) { this.playNow(dup.itemId); return 0; }
    try { this.add(id, localfiles.titleOf(filePath), 'Trong máy', 0, 'TV', 'next', true, filePath); } catch (e) { return 3; }
    if (this.current && this.current.videoId !== id) this.skip();
    return 0;
  }
  /** "Phát ngay" đúng bài đang phát: phát lại từ đầu (và bỏ tạm dừng), không thêm bản sao vào hàng đợi. */
  replayCurrent() { this.restart(); if (this.userPaused) this.resume(); }
  /** Bài YouTube "phát ngay" (dùng cho lá bài kịch bản): giống playLocalNow. 0 = ổn, 3 = hàng đợi đầy. */
  playYoutubeNow(videoId, title, channel, durationSec) {
    if (this.current && this.current.videoId === videoId) { this.replayCurrent(); return 0; }
    const dup = this.queue.find(i => i.videoId === videoId);
    if (dup) { this.playNow(dup.itemId); return 0; }
    try { this.add(videoId, title, channel, durationSec | 0, 'TV', 'next', true); } catch (e) { return 3; }
    if (this.current && this.current.videoId !== videoId) this.skip();
    return 0;
  }

  add(videoId, title, channel, durationSec, addedBy, position, force, local) {
    if (this.queue.length >= 200) throw new ApiError(409, 'QUEUE_FULL', 'Queue is full');
    if (!force && this.queue.some(i => i.videoId === videoId)) throw new ApiError(409, 'DUPLICATE_PENDING', 'Already in queue');
    const noTitle = !title || !String(title).trim();
    const item = newItem({
      videoId, title: noTitle ? 'YouTube · ' + videoId : String(title).slice(0, 500),
      channel: String(channel || '').slice(0, 200), durationSec, addedBy: addedBy ? String(addedBy).slice(0, 40) : null, local: local || null
    });
    if (position === 'next') this.queue.unshift(item); else this.queue.push(item);
    const wasHalted = this.halted;
    if (wasHalted) { this.halted = false; this.consecutiveFails = 0; }
    this.bump();
    if (!this.current || wasHalted) this.startNext();
    if (noTitle) {
      resolver.meta(videoId).then(m => {
        if (m && m.title) { item.title = m.title; item.channel = m.channel; item.durationSec = m.durationSec; this.bump(); }
      }).catch(() => {});
    }
    return item;
  }

  findQ(itemId) {
    const i = this.queue.findIndex(x => x.itemId === itemId);
    if (i < 0) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Item not found');
    return i;
  }
  remove(itemId) {
    if (this.current && this.current.itemId === itemId) { this.skip(); return; }
    this.queue.splice(this.findQ(itemId), 1);
    this.bump();
  }
  prioritize(itemId) {
    const it = this.queue.splice(this.findQ(itemId), 1)[0];
    this.queue.unshift(it);
    this.bump();
  }
  reorder(itemId, newIndex) {
    const it = this.queue.splice(this.findQ(itemId), 1)[0];
    this.queue.splice(Math.min(Math.max(0, newIndex | 0), this.queue.length), 0, it);
    this.bump();
  }
  playNow(itemId) {
    const it = this.queue.splice(this.findQ(itemId), 1)[0];
    if (this.current) this.current.status = 'DONE';
    this.halted = false; this.consecutiveFails = 0;
    this.queueVersion++;
    this.persist();
    this.playItem(it, 0);
  }
  skip() { this.halted = false; this.consecutiveFails = 0; this.startNext(); }
  pause() { this.userPaused = true; this.applyPause(); this.fadeCancel(0); }
  resume() { this.userPaused = false; this.applyResume(); }
  restart() { this.cmd({ type: 'seek', ms: 0 }); }

  setMaxHeight(h) {
    const v = h <= 360 ? 360 : h <= 480 ? 480 : h <= 720 ? 720 : 1080;
    if (v === this.settings.maxHeight) return;
    this.settings.maxHeight = v;
    this.prefetchedId = null;
    const cur = this.current;
    if (cur && !cur.local && !this.isOffline(cur) && !this.usingIframe && (this.state === S.PLAYING || this.state === S.PAUSED)) this.playItem(cur, this.pos);
    else this.publish();
    this.prefetchHead();
  }

  // ---------------------------------------------------------------- MC nói (hạ nhạc) + fade vào/ra
  /** Hệ số nhân âm lượng khi KHÔNG đang fade: 1 bình thường, duckLevel% khi MC nói. */
  gainTarget() { return (this.duck || this.sfxDuck) ? Math.min(100, Math.max(0, this.settings.duckLevel)) / 100 : 1; }
  /** Hệ số hiện tại (cho cửa sổ vừa mở): đang/đã fade out thì 0. */
  currentGain() { return this.fading || this.fadedOut ? 0 : this.gainTarget(); }
  fadeInMs() { return Math.max(0, this.settings.fadeInSec) * 1000; }
  applyGain(ms) {
    if (this.fading || this.fadedOut) return; // đang fade out thì không chen vào
    this.cmd({ type: 'gain', target: this.gainTarget(), ms });
  }
  /** Bật/tắt MC. momentary = kiểu giữ nút (có hẹn giờ an toàn phòng khi quên nhả). */
  setDuck(on, momentary) {
    on = !!on;
    clearTimeout(this.duckWd); this.duckWd = null;
    if (on && momentary) this.duckWd = setTimeout(() => { this.duckWd = null; this.setDuck(false); }, DUCK_WATCHDOG_MS);
    if (on === this.duck) return this.duck;
    const before = this.gainTarget();
    this.duck = on;
    if (this.gainTarget() !== before) this.applyGain(on ? DUCK_DOWN_MS : DUCK_UP_MS); // hiệu ứng riêng đang hạ sẵn thì không cần gửi lại
    this.publish();
    return this.duck;
  }
  /**
   * Hiệu ứng âm thanh riêng đang phát -> hạ nhạc (cùng mức duckLevel với nút MC); hết thì trả nhạc.
   * Không đụng tới cờ `duck` của MC: MC đang giữ thì hiệu ứng hết, nhạc vẫn nhỏ; không hiện chữ "MC nói".
   */
  setSfxDuck(on) {
    on = !!on;
    clearTimeout(this.sfxDuckWd); this.sfxDuckWd = null;
    if (on) this.sfxDuckWd = setTimeout(() => { this.sfxDuckWd = null; this.setSfxDuck(false); }, SFX_DUCK_WATCHDOG_MS);
    if (on === this.sfxDuck) return this.sfxDuck;
    const before = this.gainTarget();
    this.sfxDuck = on;
    if (this.gainTarget() !== before) this.applyGain(on ? DUCK_DOWN_MS : DUCK_UP_MS);
    return this.sfxDuck;
  }
  /** Đổi mức hạ nhạc trong cài đặt khi đang hạ. */
  refreshGain() { this.applyGain(400); this.publish(); }
  /** Bấm lần 1: nhạc nhỏ dần rồi dừng. Bấm lại giữa chừng: huỷ. Trả về 'start' | 'cancel' | 'none'. */
  fadeOut() {
    if (this.fading) { this.fadeCancel(600); return 'cancel'; }
    if (this.state !== S.PLAYING) return 'none';
    const ms = Math.max(1, this.settings.fadeOutSec) * 1000;
    this.fading = true;
    this.cmd({ type: 'gain', target: 0, ms });
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      if (!this.fading) return;
      this.fading = false; this.fadedOut = true;
      this.userPaused = true; this.applyPause(); // dừng hẳn; bấm Phát sẽ vào lại bằng fade in
      this.publish();
    }, ms + 100);
    this.publish();
    return 'start';
  }
  fadeCancel(ms) {
    clearTimeout(this.fadeTimer); this.fadeTimer = null;
    if (!this.fading) return;
    this.fading = false;
    this.applyGain(ms);
    this.publish();
  }
  /** Nạp bài mới: bỏ trạng thái fade cũ. */
  fadeReset() {
    clearTimeout(this.fadeTimer); this.fadeTimer = null;
    this.fading = false; this.fadedOut = false;
  }

  setVolumeAbs(level) {
    this.volume = Math.min(100, Math.max(0, level | 0));
    this.cmd({ type: 'volume', v: this.volume });
    this.publish();
    this.emit('volume', this.volume);
    return this.volume;
  }
  changeVolume(delta) { return this.setVolumeAbs(this.volume + delta); }

  seekTo(positionMs, deltaMs) {
    if (!this.current || (this.state !== S.PLAYING && this.state !== S.PAUSED)) return;
    let dur = this.dur || (this.current.durationSec || 0) * 1000;
    let target = Math.max(0, positionMs != null ? positionMs : this.pos + (deltaMs || 0));
    if (dur > 0) target = Math.min(target, Math.max(0, dur - 1500));
    this.pos = target;
    this.cmd({ type: 'seek', ms: target });
    this.lastPosChangeAt = Date.now();
  }

  forceResume() {
    this.userPaused = false;
    if (this.state === S.PAUSED) this.applyResume();
    else if (this.state === S.PLAYING) this.cmd({ type: 'resume' });
  }

  // ---------------------------------------------------------------- nội bộ
  cmd(c) { this.emit('player', c); }

  applyPause() {
    if (this.state === S.PLAYING) { this.cmd({ type: 'pause' }); this.state = S.PAUSED; this.publish(); }
    else if (this.state === S.RESOLVING) this.publish();
  }
  applyResume() {
    if (this.state === S.PAUSED) {
      if (this.fadedOut) { // vừa fade out xong: vào lại từ im lặng cho êm
        this.fadedOut = false;
        this.cmd({ type: 'gain', target: this.gainTarget(), from: 0, ms: this.fadeInMs() });
      }
      this.cmd({ type: 'resume' }); this.state = S.PLAYING; this.publish();
    }
  }

  bump() { this.queueVersion++; this.persist(); this.publish(); this.prefetchHead(); }

  prefetchHead() {
    const next = this.queue[0];
    if (!next || next.local || this.hasOffline(next) || this.prefetchedId === next.videoId || this.settings.backend === 'IFRAME') return;
    this.prefetchedId = next.videoId;
    const id = next.videoId;
    resolver.resolve(id, this.settings.maxHeight).catch(() => { if (this.prefetchedId === id) this.prefetchedId = null; });
  }

  publish() {
    this.seq++;
    const next = this.queue[0];
    const label = next ? next.title + (next.addedBy ? ' · ' + next.addedBy : '') : null;
    this.ui = {
      seq: this.seq, state: this.state, nowTitle: this.current ? this.current.title : null,
      nextText: label, iframe: this.usingIframe, noCurrent: !this.current, message: this.netWait ? 'net' : null
    };
    this.emit('ui', this.ui);
  }

  emitError(code, msg) { this.errorSeq++; this.errCode = code; this.errMsg = msg; }

  clearTimers() {
    clearTimeout(this.startTimer); clearTimeout(this.retryTimer);
    this.startTimer = null; this.retryTimer = null;
  }

  startNext() {
    this.clearTimers();
    this.playToken++;
    if (this.current) this.current.status = 'DONE';
    const next = this.queue.length ? this.queue.shift() : this.seedNext();
    if (!next) {
      this.current = null;
      this.state = S.IDLE;
      this.usingIframe = false;
      this.pos = 0; this.dur = 0;
      this.cmd({ type: 'stop' });
      this.bump();
      return;
    }
    this.queueVersion++;
    this.persist();
    this.playItem(next, 0);
    this.prefetchHead();
  }

  seedNext() {
    if (!this.settings.seedAutoplay) return null;
    if (!this.seedPool.length) { this.fillSeed(); return null; }
    const it = this.seedPool.shift();
    this.lastSeedId = it.videoId;
    return it;
  }

  async fillSeed() {
    if (this.seedFilling) return;
    this.seedFilling = true;
    let got = [];
    try { got = await this.loadSeed(); } catch (e) { /* bỏ qua */ }
    this.seedFilling = false;
    if (got.length) {
      this.seedPool.push(...got);
      if (!this.current && !this.queue.length) this.startNext();
    } else {
      await sleep(10000);
      if (!this.current && !this.queue.length) this.startNext();
    }
  }

  async loadSeed() {
    const out = [];
    const root = JSON.parse(fs.readFileSync(this.seedFile, 'utf8'));
    for (const o of root.videos || []) {
      if (ID_RE.test(o.videoId || '')) out.push(newItem({ videoId: o.videoId, title: o.title || 'YouTube · ' + o.videoId, source: 'SEED' }));
    }
    const qs = (root.queries || []).slice().sort(() => Math.random() - 0.5).slice(0, 2);
    for (const q of qs) {
      try {
        const r = await searchSvc.search(q, 0, false);
        for (const h of r.hits) {
          if (h.durationSec >= 120 && h.durationSec <= 900 && h.videoId !== this.lastSeedId) {
            out.push(newItem({ videoId: h.videoId, title: h.title, channel: h.channel, durationSec: h.durationSec, source: 'SEED' }));
          }
        }
      } catch (e) { /* bỏ qua */ }
    }
    return out.sort(() => Math.random() - 0.5);
  }

  async playItem(item, startMs) {
    this.clearTimers();
    this.fadeReset();
    const token = ++this.playToken;
    this.current = item;
    item.status = 'RESOLVING';
    this.state = S.RESOLVING;
    this.netWait = false;
    this.sources = []; this.srcIdx = 0;
    this.offlineKey = null;
    if (this.lastItemId !== item.itemId) {
      this.lastItemId = item.itemId; this.reresolved = false; this.stallRetries = 0; this.sameSrcRetry = 0;
    }
    this.lastPos = -1;
    this.pos = startMs || 0; this.dur = (item.durationSec || 0) * 1000;
    this.publish();

    if (item.local) { this.playLocal(item, startMs || 0, token); return; }
    // Bài đã tải sẵn: phát từ file trong máy (không yt-dlp, không cần mạng). File mất/không đọc được thì phát trực tuyến như thường.
    const off = this.offlineFile(item);
    if (off) {
      const ok = await fs.promises.access(off, fs.constants.R_OK).then(() => true, () => false);
      if (token !== this.playToken) return;
      if (ok) { this.startOffline(item, off, startMs || 0); return; }
      if (this.downloads) { this.downloads.forget(item.videoId); this.noteDownloadsChanged(); }
      resolver.log('FILE ĐÃ TẢI KHÔNG ĐỌC ĐƯỢC ' + item.videoId + ' -> phát trực tuyến');
    }
    const useIframe = this.settings.backend === 'IFRAME' || (this.settings.backend === 'AUTO' && this.forceIframeItem === item.itemId);
    if (useIframe) { this.playIframe(item, startMs || 0); return; }
    this.usingIframe = false;
    this.cmd({ type: 'stop' });
    try {
      const r = await this.resolveWithRetry(item, token);
      if (token !== this.playToken) return;
      this.sources = r.sources; this.srcIdx = 0;
      if (item.title.startsWith('YouTube · ') && r.title) {
        item.title = r.title; item.channel = r.channel; item.durationSec = r.durationSec; this.publish();
      }
      this.startStream(item, startMs || 0);
    } catch (e) {
      if (token !== this.playToken) return;
      if (e instanceof resolver.UnavailableError) { this.lastFail = e; this.failCurrent(item, 'UNAVAILABLE'); }
      else { this.lastFail = e; this.failCurrent(item, 'PLAYBACK_FAILED'); }
    }
  }

  /** File trong máy: không cần yt-dlp, không cần mạng; tiến trình chính đổi nguồn này thành đường dẫn cục bộ (proxy). */
  async playLocal(item, startMs, token) {
    this.usingIframe = false;
    this.cmd({ type: 'stop' });
    try { await fs.promises.access(item.local, fs.constants.R_OK); }
    catch (e) {
      if (token !== this.playToken) return;
      this.lastFail = { message: 'Không mở được file (đã bị xoá/đổi tên hoặc ổ đĩa đã rút): ' + path.basename(item.local) };
      this.failCurrent(item, 'UNAVAILABLE');
      return;
    }
    if (token !== this.playToken) return;
    this.sources = [{ local: item.local, mime: localfiles.mimeOf(item.local), audioOnly: localfiles.kindOf(item.local) === 'audio' }];
    this.srcIdx = 0;
    this.startStream(item, startMs);
  }

  // ---- bài đã tải sẵn ----
  /** Đường dẫn file đã tải của bài YouTube (null nếu chưa tải, file mất, hoặc file này đã hỏng khi phát). */
  offlineFile(item) {
    if (!this.downloads || !item || item.local || item.skipOffline) return null;
    try { return this.downloads.fileFor(item.videoId) || null; } catch (e) { return null; }
  }
  hasOffline(item) { return !!this.offlineFile(item); }
  /** Bài này đang phát từ file đã tải? */
  isOffline(item) { return !!item && this.offlineKey === item.itemId; }

  startOffline(item, file, startMs) {
    if (!this.current || this.current.itemId !== item.itemId) return;
    this.usingIframe = false;
    this.cmd({ type: 'stop' });
    this.offlineKey = item.itemId;
    this.sources = [{ local: file, mime: localfiles.mimeOf(file), audioOnly: localfiles.kindOf(file) === 'audio' }];
    this.srcIdx = 0;
    this.startStream(item, startMs);
  }

  /** File đã tải hỏng / không phát được / đứng hình: bỏ file này, phát trực tuyến tiếp từ vị trí đang nghe. */
  fallbackFromOffline(item, why) {
    const pos = this.pos;
    item.skipOffline = true; this.offlineKey = null;
    if (this.downloads) { this.downloads.forget(item.videoId); this.noteDownloadsChanged(); }
    resolver.log('FILE ĐÃ TẢI LỖI (' + why + ') ' + item.videoId + ' -> phát trực tuyến từ ' + Math.round(pos / 1000) + 's');
    this.playItem(item, pos > 1500 ? pos : 0);
  }

  async resolveWithRetry(item, token) {
    const c = resolver.cached(item.videoId, this.settings.maxHeight);
    if (c) return c;
    let attempt = 0;
    for (;;) {
      try {
        return await resolver.resolve(item.videoId, this.settings.maxHeight);
      } catch (e) {
        if (e instanceof resolver.UnavailableError) throw e;
        attempt++;
        if (attempt >= 2 || token !== this.playToken) throw e;
        await sleep(500);
      }
    }
  }

  startStream(item, startMs) {
    if (!this.current || this.current.itemId !== item.itemId) return;
    const s = this.sources[this.srcIdx];
    if (!s) { this.failCurrent(item, 'PLAYBACK_FAILED'); return; }
    this.usingIframe = false;
    this.cmd({
      type: 'load', mode: 'stream', key: item.itemId, videoId: item.videoId, title: item.title, src: s,
      startMs: startMs || 0, volume: this.volume, paused: this.userPaused,
      gain: this.gainTarget(), fadeInMs: startMs > 0 ? 0 : this.fadeInMs()
    });
    this.armStartTimeout(item, item.local || this.isOffline(item) ? 15000 : 30000);
  }

  playIframe(item, startMs) {
    this.usingIframe = true;
    this.publish();
    this.cmd({
      type: 'load', mode: 'iframe', key: item.itemId, videoId: item.videoId,
      startMs: startMs || 0, volume: this.volume, paused: this.userPaused,
      gain: this.gainTarget(), fadeInMs: startMs > 0 ? 0 : this.fadeInMs()
    });
    this.armStartTimeout(item, 25000);
  }

  armStartTimeout(item, ms) {
    clearTimeout(this.startTimer);
    if (!this.playerAttached) return; // chưa có cửa sổ phát thì chờ
    this.startTimer = setTimeout(() => {
      if (this.current && this.current.itemId === item.itemId && this.state === S.RESOLVING) {
        if (this.usingIframe) this.failCurrent(item, 'PLAYBACK_FAILED');
        else this.handleStreamError(item);
      }
    }, ms);
  }

  /** Có cửa sổ phát vừa sẵn sàng: nạp lại bài đang chờ. */
  attachPlayer(on) {
    this.playerAttached = on;
    if (on && this.current && this.state === S.RESOLVING) {
      if (this.usingIframe) this.playIframe(this.current, this.pos);
      else if (this.sources.length) this.startStream(this.current, this.pos);
    }
  }

  /** Cửa sổ báo về: started | ended | error | pos. */
  playerEvent(kind, key, a, b) {
    const item = this.current;
    if (!item || item.itemId !== key) return;
    if (kind === 'pos') {
      this.pos = a | 0; if (b > 0) this.dur = b | 0;
      return;
    }
    if (kind === 'started') {
      if (this.state === S.RESOLVING) {
        clearTimeout(this.startTimer); resolver.markGood(item.videoId);
        item.status = 'PLAYING';
        this.consecutiveFails = 0; this.streamFailStreak = 0; this.failScreen = false;
        this.state = this.userPaused ? S.PAUSED : S.PLAYING;
        this.lastPosChangeAt = Date.now();
        this.publish();
      }
    } else if (kind === 'ended') {
      this.consecutiveFails = 0;
      this.startNext();
    } else if (kind === 'error') {
      if (this.usingIframe) this.failCurrent(item, 'UNAVAILABLE');
      else this.handleStreamError(item);
    }
  }

  handleStreamError(item) {
    if (!this.current || this.current.itemId !== item.itemId) return;
    if (item.local) {
      this.lastFail = { message: 'File không phát được (định dạng hoặc codec không được hỗ trợ, hoặc file hỏng): ' + path.basename(item.local) };
      this.failCurrent(item, 'UNAVAILABLE');
      return;
    }
    if (this.isOffline(item)) { this.fallbackFromOffline(item, 'không phát được'); return; }
    const pos = this.pos;
    if ((this.sameSrcRetry || 0) < 2 && this.sources[this.srcIdx]) {
      this.sameSrcRetry = (this.sameSrcRetry || 0) + 1;
      resolver.log('RETRY same source #' + this.sameSrcRetry + ' ' + item.videoId);
      setTimeout(() => this.startStream(item, pos > 5000 ? pos : 0), 400);
      return;
    }
    if (this.srcIdx + 1 < this.sources.length) {
      this.srcIdx++;
      this.startStream(item, pos > 5000 ? pos : 0);
      return;
    }
    if ((this.reresolved | 0) < 2) {
      this.reresolved = (this.reresolved | 0) + 1; this.sameSrcRetry = 1;
      resolver.nextVariant(item.videoId); // link bị từ chối (403) -> thử client YouTube khác
      resolver.invalidate(item.videoId);
      this.playItem(item, pos > 5000 ? pos : 0);
      return;
    }
    this.failCurrent(item, 'PLAYBACK_FAILED');
  }

  failCurrent(item, code) {
    if (!this.current || this.current.itemId !== item.itemId) return;
    this.clearTimers();
    item.status = 'UNAVAILABLE';
    if (!item.local && code !== 'UNAVAILABLE' && this.settings.backend === 'AUTO' && !this.usingIframe) {
      this.streamFailStreak++;
      if (this.streamFailStreak >= 2 && this.forceIframeItem !== item.itemId) {
        this.forceIframeItem = item.itemId;
        this.fallbackHint = true;
        this.playItem(item, 0);
        return;
      }
    }
    this.consecutiveFails++;
    const lf = this.lastFail && this.lastFail.message ? String(this.lastFail.message).replace(/^ERROR:\s*(\[[^\]]*\]\s*)?([\w-]{11}:\s*)?/, '') : 'lỗi phát video';
    this.errDetail = lf.slice(0, 110); this.lastFail = null;
    resolver.log('PLAYFAIL ' + item.videoId + ' [' + code + '] ' + this.errDetail + ' — "' + String(item.title).slice(0, 60) + '" (nguồn ' + (this.srcIdx + 1) + '/' + (this.sources.length || 0) + (this.usingIframe ? ', iframe' : '') + ')');
    this.emitError(code, item.title);
    this.cmd({ type: 'stop' });
    this.state = S.ERROR;
    if (this.consecutiveFails >= 5) { this.halted = true; this.publish(); return; }
    this.publish();
    const token = this.playToken;
    setTimeout(() => {
      if (token === this.playToken && this.current && this.current.itemId === item.itemId && this.state === S.ERROR && !this.halted) this.startNext();
    }, 1500);
  }

  // ---------------------------------------------------------------- canh chừng (mỗi giây)
  tick() {
    if (this.usingIframe || !this.playerAttached) return;
    const item = this.current;
    if (!item) return;
    const now = Date.now();
    if (this.state === S.PLAYING) {
      if (this.pos !== this.lastPos) { this.lastPos = this.pos; this.lastPosChangeAt = now; }
      else if (now - this.lastPosChangeAt > 15000) {
        this.lastPosChangeAt = now;
        if (this.isOffline(item)) { this.fallbackFromOffline(item, 'đứng hình'); return; }
        if (this.stallRetries < 2) {
          this.stallRetries++;
          resolver.invalidate(item.videoId);
          this.playItem(item, this.pos);
        } else this.failCurrent(item, 'PLAYBACK_FAILED');
        return;
      }
      if (this.dur > 0 && this.pos * 100 / this.dur >= 70) {
        const next = this.queue[0];
        if (next && !next.local && !this.hasOffline(next) && this.prefetchedId !== next.videoId) {
          this.prefetchedId = next.videoId;
          resolver.resolve(next.videoId, this.settings.maxHeight).catch(() => {});
        }
      }
    }
  }

  // ---------------------------------------------------------------- snapshot / lưu trữ
  progress() {
    const ok = this.state === S.PLAYING || this.state === S.PAUSED;
    return [ok ? this.pos : 0, this.dur || (this.current ? (this.current.durationSec || 0) * 1000 : 0)];
  }

  searchJson() {
    const sv = this.search;
    const o = { version: sv.version, source: sv.source, query: sv.query, loading: sv.loading, page: sv.page, hasMore: sv.hasMore };
    if (sv.source === 'tv' && !sv.loading) {
      const queued = new Set(this.queue.map(i => i.videoId));
      o.results = sv.results.slice(0, 60).map(h => ({
        videoId: h.videoId, title: h.title, channel: h.channel, thumbnailUrl: thumb(h.videoId),
        durationSec: h.durationSec, alreadyQueued: queued.has(h.videoId)
      }));
    }
    return o;
  }

  snapshot() {
    const [pos, dur] = this.progress();
    return {
      version: 1, state: this.state, backend: this.usingIframe ? 'iframe' : 'stream',
      nowPlaying: this.current ? itemJson(this.current) : null,
      positionMs: pos, durationMs: dur,
      queue: this.queue.map(itemJson),
      nextUp: this.queue[0] ? itemJson(this.queue[0]) : null,
      volume: this.volume, tvSearch: this.searchJson(), karaoke: this.karaoke,
      duck: this.duck, fading: this.fading, fadedOut: this.fadedOut,
      favVer: this.favVersion, dlVer: this.dlVer, queueVersion: this.queueVersion,
      fallbackHint: this.fallbackHint && this.usingIframe, netWait: this.netWait, halted: this.halted,
      error: { seq: this.errorSeq, code: this.errCode, message: this.errMsg, detail: this.errDetail || '' },
      lastChange: { by: this.lastActor, agoMs: Date.now() - this.lastActorAt },
      settings: {
        backend: this.settings.backend, maxHeight: this.settings.maxHeight,
        tickerMode: this.settings.tickerMode, seedAutoplay: this.settings.seedAutoplay,
        duckLevel: this.settings.duckLevel, fadeInSec: this.settings.fadeInSec, fadeOutSec: this.settings.fadeOutSec
      }
    };
  }

  persist() {
    if (!this.settings.restoreQueue) return;
    try {
      const arr = [];
      const row = i => ({ ...itemJson(i), localPath: i.local || null });
      if (this.current && this.current.source === 'USER') arr.push(row(this.current));
      this.queue.forEach(i => arr.push(row(i)));
      this.store.set('queue', arr);
    } catch (e) { /* bỏ qua */ }
  }

  restore() {
    if (!this.settings.restoreQueue) return;
    try {
      const arr = this.store.get('queue', []);
      for (const o of arr) {
        if (!o || !ID_RE.test(o.videoId || '')) continue;
        const lp = typeof o.localPath === 'string' && o.localPath ? o.localPath : null;
        const it = newItem({ videoId: o.videoId, title: o.title || 'YouTube · ' + o.videoId, channel: o.channel, durationSec: o.durationSec, addedBy: o.addedBy, source: o.source || 'USER', local: lp });
        this.queue.push(it);
      }
    } catch (e) { this.queue = []; }
  }
}

module.exports = { Controller, S, itemJson };
