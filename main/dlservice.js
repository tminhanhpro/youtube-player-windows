'use strict';
/**
 * Dịch vụ "Tải sẵn về máy" (phần 7, bước 4): gom thư viện đã tải + hàng đợi tải + cài đặt thành các lệnh cửa sổ gọi được.
 * Không phụ thuộc Electron (hộp chọn thư mục, đẩy sự kiện do main.js nối vào) nên kiểm thử được bằng node.
 * Sự kiện: 'update' (job), 'removed' (id), 'library' (trạng thái gọn: thư mục, số bài, x/y từng nhóm), 'idle'.
 */
const path = require('path');
const { EventEmitter } = require('events');
const { DownloadLibrary, defaultDir, uniqueIds, ID_OK } = require('./downloads');
const { DownloadQueue } = require('./downloader');

const MAX_BATCH = 2000;

class DownloadService extends EventEmitter {
  /**
   * o.settings: có dlDir / dlMode. o.musicDir: thư mục Nhạc của Windows. o.tools / o.spawn / o.kill / o.stallMs: thay được khi kiểm thử.
   * o.getFavs(): [{videoId,title}] · o.getDecks(): bộ bài · o.getQueueItems(): [{videoId,title,local}] (bài đang phát + hàng đợi).
   */
  constructor(o) {
    super();
    this.settings = o.settings;
    this.musicDir = o.musicDir || '';
    this.getFavs = o.getFavs || (() => []);
    this.getDecks = o.getDecks || (() => []);
    this.getQueueItems = o.getQueueItems || (() => []);
    this.library = new DownloadLibrary(() => this.dir());
    this.queue = new DownloadQueue({
      library: this.library, getDir: () => this.dir(), getMode: () => this.settings.dlMode,
      tools: o.tools, spawn: o.spawn, kill: o.kill, stallMs: o.stallMs
    });
    this.queue.on('update', j => this.emit('update', j));
    this.queue.on('removed', id => this.emit('removed', id));
    this.queue.on('done', () => this.emit('library', this.libraryInfo()));
    this.queue.on('idle', () => this.emit('idle'));
  }

  /** Thư mục tải đang dùng. */
  dir() { return this.settings.dlDir || defaultDir(this.musicDir); }

  /** Quét thư mục (lúc mở app, đổi thư mục, hoặc người dùng bấm quét lại). */
  async rescan() { const n = await this.library.scan(); this.emit('library', this.libraryInfo()); return n; }

  // ---------- đọc trạng thái ----------
  /** Phạm vi tải: Yêu thích, hàng đợi, từng bộ bài — mỗi nơi "đã tải x/y". */
  scopes() {
    const lib = this.library, favs = this.getFavs() || [];
    return {
      favs: lib.progress(favs.map(f => f && f.videoId)),
      queue: lib.progress(this._queueEntries().map(e => e.videoId)),
      decks: lib.decksProgress(this.getDecks() || []).map(d => ({ id: d.id, name: d.name, done: d.done, total: d.total }))
    };
  }
  libraryInfo() { return { dir: this.dir(), defaultDir: defaultDir(this.musicDir), custom: !!this.settings.dlDir, count: this.library.count, scopes: this.scopes() }; }
  /** Toàn bộ: hàng đợi (jobs, đếm, ffmpeg...) + thư viện. Cửa sổ gọi một lần khi mở hộp thoại. */
  state() { return { ...this.queue.snapshot(), ...this.libraryInfo() }; }

  // ---------- lệnh ----------
  /**
   * Bắt đầu tải. scope: { type: 'favs' } | { type: 'queue' } | { type: 'deck', id } | { type: 'ids', ids:[...] }.
   * Trả về { total, added, have, queued, bad } hoặc { error } khi phạm vi không có.
   */
  start(scope) {
    const items = this._items(scope);
    if (!items) return { error: 'Không tìm thấy phạm vi cần tải' };
    const r = this.queue.enqueue(items.slice(0, MAX_BATCH));
    return { total: items.length, added: r.added.length, have: r.have.length, queued: r.queued.length, bad: r.bad };
  }
  cancel(id) { return this.queue.cancel(id); }
  cancelAll() { return this.queue.cancelAll(); }
  clear(id) { return this.queue.clear(id); }
  clearFinished() { return this.queue.clearFinished(); }
  /** Dừng hết (lúc thoát app) để không bỏ lại yt-dlp chạy ngầm. */
  stop() { try { this.queue.cancelAll(); } catch (e) { /* ignore */ } }

  /** Đổi thư mục tải (đường dẫn tuyệt đối). Quét lại thư mục mới. Trả về false nếu đường dẫn không hợp lệ. */
  async setDir(p) {
    if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return false;
    const norm = path.resolve(p);
    this.settings.dlDir = norm === path.resolve(defaultDir(this.musicDir)) ? '' : norm;
    await this.rescan();
    return true;
  }
  async resetDir() { this.settings.dlDir = ''; await this.rescan(); return true; }
  /** 'video' (hình + tiếng) hoặc 'audio' (chỉ tiếng). Có hiệu lực từ bài tải kế tiếp. */
  setMode(m) {
    if (m !== 'video' && m !== 'audio') return false;
    this.settings.dlMode = m; this.emit('library', this.libraryInfo());
    return true;
  }

  // ---------- bên trong ----------
  _queueEntries() {
    return (this.getQueueItems() || []).filter(i => i && !i.local && ID_OK.test(String(i.videoId || '')));
  }
  _items(scope) {
    const t = scope && scope.type;
    if (t === 'favs') return dedupe((this.getFavs() || []).map(f => ({ videoId: f.videoId, title: f.title })));
    if (t === 'queue') return dedupe(this._queueEntries().map(i => ({ videoId: i.videoId, title: i.title })));
    if (t === 'deck') {
      const d = (this.getDecks() || []).find(x => x && x.id === scope.id);
      if (!d) return null;
      return dedupe((d.cards || []).filter(c => c && c.type === 'yt').map(c => ({ videoId: c.videoId, title: c.title })));
    }
    if (t === 'ids') return uniqueIds(Array.isArray(scope.ids) ? scope.ids.slice(0, MAX_BATCH) : []).map(videoId => ({ videoId }));
    return null;
  }
}

function dedupe(list) {
  const seen = new Set(), out = [];
  for (const it of list) { const id = String(it.videoId || ''); if (ID_OK.test(id) && !seen.has(id)) { seen.add(id); out.push({ videoId: id, title: it.title || '' }); } }
  return out;
}

module.exports = { DownloadService };
