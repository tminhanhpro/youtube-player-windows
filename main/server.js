'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ApiError, constEq, parseVideoId, clean, norm, thumb } = require('./util');
const chanSearch = require('./chansearch');
const { Cats, Favs } = require('./data');
const resolver = require('./resolver');
const { itemJson } = require('./controller');

const REACT_IDS = require('./react-ids');
const { Soundboard } = require('./sfx');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const REMOTE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://i.ytimg.com data:; " +
  "connect-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

function isLoopback(ip) { return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'; }

class KaraokeServer {
  /**
   * @param {object} o { ctl, settings, store, webDir, uiDir }
   * extraRoutes: hàm (req,res,url) => boolean cho các đường nội bộ (proxy video...) — chỉ nhận từ localhost.
   */
  constructor(o) {
    Object.assign(this, o);
    this.lastRemoteSeen = 0;
    this.failures = new Map();
    this.idem = new Map();
    this.reactTimes = [];
    this.sfxTimes = [];
    this.deckTimes = [];
    this.deckNextAt = 0;
    this.lastMsgAt = 0;
    this.port = 0;
    this.extraRoutes = o.extraRoutes || null;
  }

  async listen() {
    for (let p = 8080; p <= 8099; p++) {
      try {
        await new Promise((resolve, reject) => {
          const srv = http.createServer((req, res) => this.handle(req, res));
          srv.once('error', reject);
          srv.listen(p, '0.0.0.0', () => { srv.removeListener('error', reject); this.srv = srv; resolve(); });
        });
        this.port = p;
        return p;
      } catch (e) { if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e; }
    }
    throw new Error('Không còn cổng trống trong 8080..8099');
  }

  close() { try { this.srv.close(); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------------- tiện ích
  sendJson(res, status, obj, extra) {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, ...(extra || {}) });
    res.end(body);
  }
  sendErr(res, status, code, msg) {
    this.sendJson(res, status, { error: { code, message: msg } }, status === 429 ? { 'retry-after': '30' } : null);
  }
  sendFile(res, file, extra) {
    let st;
    try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch (e) { throw new ApiError(404, 'NOT_FOUND', 'Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, ...(extra || {}) });
    fs.createReadStream(file).pipe(res);
  }
  safeJoin(dir, rel) {
    const f = path.normalize(path.join(dir, rel));
    if (!f.startsWith(path.normalize(dir + path.sep))) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return f;
  }
  cookieToken(req) {
    const c = req.headers.cookie;
    if (!c) return null;
    for (const p of c.split(';')) { const t = p.trim(); if (t.startsWith('kt=')) return t.slice(3); }
    return null;
  }
  tokenOf(req, url) {
    const q = url.searchParams.get('token');
    if (q) return q;
    const a = req.headers.authorization;
    if (a && a.startsWith('Bearer ')) return a.slice(7).trim();
    return this.cookieToken(req);
  }
  blocked(ip) {
    const l = this.failures.get(ip);
    if (!l) return false;
    const now = Date.now();
    while (l.length && now - l[0] > 60000) l.shift();
    return l.length >= 10;
  }
  noteFailure(ip) {
    if (!this.failures.has(ip)) this.failures.set(ip, []);
    this.failures.get(ip).push(Date.now());
  }
  readBody(req) {
    return new Promise((resolve, reject) => {
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (!ct.startsWith('application/json')) return reject(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json'));
      const len = Number(req.headers['content-length'] || 0);
      if (len > 8192) return reject(new ApiError(413, 'BODY_TOO_LARGE', 'Body too large'));
      let buf = '';
      req.setEncoding('utf8');
      req.on('data', d => { buf += d; if (buf.length > 8192) { reject(new ApiError(413, 'BODY_TOO_LARGE', 'Body too large')); req.destroy(); } });
      req.on('end', () => {
        try { resolve(buf.trim() ? JSON.parse(buf) : {}); } catch (e) { reject(new ApiError(400, 'INVALID_BODY', 'Bad JSON')); }
      });
      req.on('error', () => reject(new ApiError(400, 'INVALID_BODY', 'Bad body')));
    });
  }

  // ---------------------------------------------------------------- vào/ra
  async handle(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      await this.route(req, res, url);
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch (x) { /* ignore */ } return; }
      if (e instanceof ApiError) this.sendErr(res, e.status, e.code, e.message);
      else this.sendErr(res, 500, 'INTERNAL', String(e && e.message || 'error'));
    }
  }

  async route(req, res, url) {
    const uri = url.pathname;
    const method = req.method;
    const ip = req.socket.remoteAddress || '?';
    const local = isLoopback(ip);

    // Cửa sổ của chính app (localhost): giao diện + đường nội bộ, không cần token
    if (local && (uri.startsWith('/ui/') || uri.startsWith('/internal/'))) {
      if (uri.startsWith('/ui/')) return this.sendFile(res, this.safeJoin(this.uiDir, uri.slice(4)), { 'cache-control': 'no-store' });
      if (this.extraRoutes && await this.extraRoutes(req, res, url)) return;
      throw new ApiError(404, 'NOT_FOUND', 'Not found');
    }

    const secHeaders = {
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY', 'content-security-policy': REMOTE_CSP
    };
    for (const [k, v] of Object.entries(secHeaders)) res.setHeader(k, v);

    if (uri.startsWith('/static/')) return this.sendFile(res, this.safeJoin(this.webDir, uri.slice(8)));
    if (uri === '/manifest.webmanifest') return this.sendFile(res, path.join(this.webDir, 'manifest.webmanifest'));
    if (uri === '/favicon.ico') return this.sendFile(res, path.join(this.webDir, 'icon.png'));

    if (this.blocked(ip)) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts');
    const ok = constEq(this.tokenOf(req, url), this.settings.token);
    if (!ok && !local) {
      this.noteFailure(ip);
      if (uri === '/') {
        const page = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>" +
          "<body style='font:20px sans-serif;padding:24px'><h2>Youtube Player</h2>" +
          '<p>Hãy quét mã QR trên máy tính để kết nối.<br>Scan the QR code on the computer.</p></body>';
        res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(page);
      }
      throw new ApiError(403, 'UNAUTHORIZED', 'Unauthorized');
    }

    if (uri === '/' && method === 'GET') {
      const f = path.join(this.webDir, 'index.html');
      res.setHeader('set-cookie', 'kt=' + this.settings.token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000');
      return this.sendFile(res, f);
    }
    if (!uri.startsWith('/api/')) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    await this.api(req, res, url, method, uri);
  }

  // ---------------------------------------------------------------- API
  reply(res, item) {
    const o = { state: this.ctl.snapshot() };
    if (item) o.item = itemJson(item);
    this.sendJson(res, 200, o);
  }
  catsReply(res) { this.sendJson(res, 200, { cats: Cats.toJson(Cats.load(this.store)) }); }
  favsReply(res) { this.sendJson(res, 200, { favs: Favs.load(this.store), ver: this.ctl.favVersion }); }

  async api(req, res, url, method, uri) {
    const ctl = this.ctl, settings = this.settings, store = this.store;
    const write = method === 'POST' || method === 'DELETE';
    if (write) {
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + req.headers.host) throw new ApiError(403, 'BAD_ORIGIN', 'Bad origin');
    }
    let dev = null;
    if (req.headers['x-device']) { try { dev = decodeURIComponent(req.headers['x-device']).slice(0, 40); } catch (e) { dev = null; } }
    if (req.headers['x-remote-heartbeat'] || uri === '/api/state') this.lastRemoteSeen = Date.now();

    const parts = uri.slice(5).split('/').filter(Boolean);
    const p0 = parts[0] || '', p1 = parts[1], p2 = parts[2];
    const q = url.searchParams;

    if (method === 'GET' && p0 === 'state') return this.reply(res);
    if (method === 'GET' && p0 === 'search') return this.search(res, q);

    if (method === 'GET' && p0 === 'channel-url') {
      const id = parseVideoId(q.get('videoId') || '');
      if (!id) throw new ApiError(400, 'INVALID_URL', 'Bad video id');
      return this.sendJson(res, 200, { url: (await resolver.channelUrl(id)) || null });
    }

    if (method === 'POST' && p0 === 'resolve-url') {
      const b = await this.readBody(req);
      const id = parseVideoId(b.url || '');
      if (!id) throw new ApiError(400, 'INVALID_URL', 'Paste a valid YouTube video link');
      const m = await resolver.meta(id);
      return this.sendJson(res, 200, {
        videoId: id, title: m && m.title ? m.title : 'YouTube · ' + id, channel: m ? m.channel : '',
        thumbnailUrl: thumb(id), durationSec: m ? m.durationSec : 0
      });
    }

    if (method === 'POST' && p0 === 'queue' && !p1) {
      const b = await this.readBody(req);
      const key = req.headers['idempotency-key'];
      if (key) {
        const prev = this.idem.get(key);
        if (prev && Date.now() - prev.t < 60000) return this.sendJson(res, 200, prev.body);
      }
      const raw = b.videoId || b.url || '';
      const id = parseVideoId(raw);
      if (!id) throw new ApiError(400, 'INVALID_URL', 'Paste a valid YouTube video link');
      ctl.noteActor(dev);
      const item = ctl.add(id, b.title != null ? String(b.title) : null, b.channel != null ? String(b.channel) : null,
        Number(b.durationSec) | 0, b.addedBy || dev || '', b.position || 'end', !!b.force);
      const out = { state: ctl.snapshot(), item: itemJson(item) };
      if (key) {
        this.idem.set(key, { t: Date.now(), body: out });
        const now = Date.now();
        for (const [k, v] of this.idem) if (now - v.t > 60000) this.idem.delete(k);
      }
      return this.sendJson(res, 200, out);
    }

    if (method === 'POST' && p0 === 'queue' && p1 === 'reorder') {
      const b = await this.readBody(req);
      ctl.noteActor(dev); ctl.reorder(String(b.itemId), Number(b.newIndex) | 0);
      return this.reply(res);
    }
    if (method === 'DELETE' && p0 === 'queue' && p1) { ctl.noteActor(dev); ctl.remove(p1); return this.reply(res); }
    if (method === 'POST' && p0 === 'queue' && p1 && p2 === 'prioritize') {
      await this.readBody(req); ctl.noteActor(dev); ctl.prioritize(p1); return this.reply(res);
    }
    if (method === 'POST' && p0 === 'queue' && p1 && p2 === 'play') {
      await this.readBody(req); ctl.noteActor(dev); ctl.playNow(p1); return this.reply(res);
    }

    if (method === 'POST' && p0 === 'player') {
      const b = await this.readBody(req);
      let vol = null, fade = null;
      ctl.noteActor(dev);
      switch (p1) {
        case 'skip': ctl.skip(); break;
        case 'pause': ctl.pause(); break;
        case 'resume': ctl.resume(); break;
        case 'restart': ctl.restart(); break;
        case 'seek': ctl.seekTo(b.positionMs != null ? Number(b.positionMs) : null, Number(b.deltaMs) || 0); break;
        case 'volume':
          vol = b.level != null ? ctl.setVolumeAbs(Number(b.level))
            : ctl.changeVolume(Math.max(-100, Math.min(100, Number(b.delta) | 0)));
          break;
        case 'duck': ctl.setDuck(b.on == null ? !ctl.duck : !!b.on, !!b.momentary); break;
        case 'fadeout': fade = ctl.fadeOut(); break;
        default: throw new ApiError(404, 'NOT_FOUND', 'Not found');
      }
      const o = { state: ctl.snapshot() };
      if (vol != null) o.level = vol;
      if (fade != null) o.fade = fade;
      return this.sendJson(res, 200, o);
    }

    // bảng hiệu ứng âm thanh riêng: điện thoại xem danh sách (không lộ đường dẫn file trên máy) và bấm để phát trên TV
    if (p0 === 'sfx') {
      const board = this.board || (this.board = new Soundboard(store));
      if (method === 'GET' && !p1) {
        return this.sendJson(res, 200, { items: board.list().map(s => ({ id: s.id, name: s.name, icon: s.icon, vol: s.vol, missing: !!s.missing })) });
      }
      if (method === 'POST' && p1 === 'play') {
        const b = await this.readBody(req);
        const sfx = board.get(String(b.id == null ? '' : b.id).slice(0, 40));
        if (!sfx) throw new ApiError(404, 'SFX_MISSING', 'Sound not found');
        const now = Date.now();
        while (this.sfxTimes.length && now - this.sfxTimes[0] > 1000) this.sfxTimes.shift();
        const pass = this.sfxTimes.length < 10;           // chống bấm dồn: tối đa 10 hiệu ứng mỗi giây từ mọi điện thoại
        if (pass) { this.sfxTimes.push(now); ctl.noteActor(dev); ctl.sfx(sfx.id); }
        return this.sendJson(res, 200, { ok: true, dropped: !pass });
      }
      if (method === 'POST' && p1 === 'stop') { await this.readBody(req); ctl.noteActor(dev); ctl.sfxStop(); return this.sendJson(res, 200, { ok: true }); }
      throw new ApiError(404, 'NOT_FOUND', 'Not found');
    }

    // kịch bản (bộ bài): điện thoại xem danh sách bộ bài / lá bài và bấm để chạy trên máy tính.
    // Chỉ trả những gì điện thoại cần (tên, biểu tượng, loại, mất file, đã chạy): không lộ đường dẫn file, id hiệu ứng, videoId hay nội dung chữ.
    if (p0 === 'decks') {
      const dk = this.decksApi;
      if (!dk) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const idOf = v => String(v == null ? '' : v).slice(0, 40);
      const cardView = (c, played) => ({ id: c.id, label: c.label, icon: c.icon, type: c.type, missing: !!c.missing, played: played.has(c.id) });
      const deckDetail = d => {
        const lv = dk.liveOf(d.id) || { played: [], last: null, next: null };
        const played = new Set(lv.played);
        return { id: d.id, name: d.name, icon: d.icon, missingCount: d.missingCount, cards: d.cards.map(c => cardView(c, played)), last: lv.last, next: lv.next };
      };
      // chống bấm dồn: tối đa 5 lần chạy mỗi giây từ mọi điện thoại; riêng "kế tiếp" cách nhau ít nhất 0,5 giây (bấm đúp không nhảy cóc một lá)
      const allow = (isNext) => {
        const now = Date.now();
        while (this.deckTimes.length && now - this.deckTimes[0] > 1000) this.deckTimes.shift();
        if (this.deckTimes.length >= 5 || (isNext && now - this.deckNextAt < 500)) return false;
        this.deckTimes.push(now); if (isNext) this.deckNextAt = now;
        return true;
      };
      const dropped = () => ({ ok: false, dropped: true, reason: 'BUSY', msg: 'Bấm quá nhanh, thử lại', label: '', marked: false });
      const reply = r => ({ ok: !!r.ok, reason: r.reason || null, msg: r.msg || '', label: r.label || '', marked: !!r.marked, dropped: false });
      if (method === 'GET' && !p1) {
        const lv = dk.live ? dk.live() : null;
        return this.sendJson(res, 200, {
          items: dk.list().map(d => ({ id: d.id, name: d.name, icon: d.icon, count: d.cards.length, missingCount: d.missingCount })),
          active: lv && lv.deckId ? lv.deckId : null
        });
      }
      const deck = p1 ? dk.get(idOf(p1)) : null;
      if (p1 && !deck) throw new ApiError(404, 'DECK_MISSING', 'Deck not found');
      if (method === 'GET' && !p2) return this.sendJson(res, 200, deckDetail(deck));
      if (method === 'POST' && p2 === 'play') {
        const b = await this.readBody(req);
        const cardId = idOf(b.cardId);
        if (!deck.cards.some(c => c.id === cardId)) throw new ApiError(404, 'CARD_MISSING', 'Card not found');
        if (!allow(false)) return this.sendJson(res, 200, dropped());
        ctl.noteActor(dev);
        return this.sendJson(res, 200, reply(dk.play(deck.id, cardId)));
      }
      if (method === 'POST' && p2 === 'next') {
        await this.readBody(req);
        if (!allow(true)) return this.sendJson(res, 200, dropped());
        ctl.noteActor(dev);
        const r = dk.next(deck.id);
        return this.sendJson(res, 200, { ...reply(r), cardId: r.cardId || null, skipped: (r.skipped || []).slice(0, 5), left: r.left | 0, done: !!r.done });
      }
      if (method === 'POST' && p2 === 'reset') {
        await this.readBody(req); ctl.noteActor(dev);
        return this.sendJson(res, 200, { ok: !!dk.reset(deck.id) });
      }
      throw new ApiError(404, 'NOT_FOUND', 'Not found');
    }

    if (method === 'POST' && p0 === 'react') {
      const b = await this.readBody(req);
      const id = String(b.id || '');
      if (!REACT_IDS.has(id)) throw new ApiError(400, 'INVALID_REACTION', 'Unknown reaction');
      const now = Date.now();
      while (this.reactTimes.length && now - this.reactTimes[0] > 1000) this.reactTimes.shift();
      let pass = true;
      if (this.reactTimes.length >= 12) pass = false; else this.reactTimes.push(now);
      if (pass) ctl.react(id);
      return this.sendJson(res, 200, { ok: true, dropped: !pass });
    }

    if (method === 'POST' && p0 === 'message') {
      const b = await this.readBody(req);
      const text = clean(b.text, 80);
      if (!text) throw new ApiError(400, 'EMPTY_MESSAGE', 'Empty message');
      const now = Date.now();
      const pass = now - this.lastMsgAt >= 1500;
      if (pass) { this.lastMsgAt = now; ctl.message(clean(dev || '', 24), text); }
      return this.sendJson(res, 200, { ok: true, dropped: !pass });
    }

    if (method === 'GET' && p0 === 'cats') return this.catsReply(res);

    if (method === 'POST' && p0 === 'cats') {
      const b = await this.readBody(req);
      const op = p1 || 'add';
      ctl.noteActor(dev);
      const list = Cats.load(store);
      const idx = b.index != null ? Number(b.index) | 0 : -1;
      const target = () => {
        const c = list[idx];
        if (!c) throw new ApiError(404, 'CAT_NOT_FOUND', 'Category not found');
        if (b.oldName != null && c.name !== String(b.oldName)) throw new ApiError(409, 'CAT_CHANGED', 'Category list changed');
        return c;
      };
      if (op === 'add' || op === 'update') {
        const name = clean(b.name, 40);
        if (!name) throw new ApiError(400, 'EMPTY_NAME', 'Name required');
        const qq = clean(b.q, 100) || name;
        if (op === 'add') {
          if (list.length >= 60) throw new ApiError(400, 'TOO_MANY', 'Too many categories');
          if (list.some(c => c.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'DUPLICATE', 'Already exists');
          list.push({ name, q: qq, custom: true });
        } else {
          const c = target();
          if (list.some(x => x !== c && x.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, 'DUPLICATE', 'Already exists');
          list[idx] = { name, q: qq, custom: c.custom };
        }
      } else if (op === 'delete') { target(); list.splice(idx, 1); }
      else if (op === 'move') {
        const c = target();
        const to = Math.max(0, Math.min(list.length - 1, b.to != null ? Number(b.to) | 0 : idx));
        list.splice(idx, 1); list.splice(to, 0, c);
      } else if (op === 'reset') {
        const have = list.map(c => c.name);
        Cats.defaults().filter(c => !have.includes(c.name)).reverse().forEach(c => list.unshift(c));
      } else throw new ApiError(404, 'NOT_FOUND', 'Not found');
      Cats.save(store, list);
      ctl.catsChanged();
      return this.catsReply(res);
    }

    // bài YouTube đã tải sẵn về máy: điện thoại lấy danh sách mã để hiện nhãn "Đã tải" (chỉ mã, không lộ đường dẫn file)
    if (method === 'GET' && p0 === 'downloaded') {
      const ids = typeof this.downloadedIds === 'function' ? this.downloadedIds() : [];
      return this.sendJson(res, 200, { ids, ver: ctl.dlVer });
    }

    if (method === 'GET' && p0 === 'favs') return this.favsReply(res);

    if (method === 'POST' && p0 === 'favs') {
      const b = await this.readBody(req);
      const op = p1 || 'add';
      const list = Favs.load(store);
      const hit = o => {
        const id = parseVideoId(o && o.videoId || '');
        if (!id) return null;
        return { videoId: id, title: clean(o.title, 200), channel: clean(o.channel, 100), durationSec: Math.max(0, Number(o.durationSec) | 0) };
      };
      if (op === 'add') {
        const h = hit(b);
        if (!h) throw new ApiError(400, 'INVALID_URL', 'Bad video id');
        if (!list.some(x => x.videoId === h.videoId)) list.splice(Math.max(0, Math.min(list.length, Number(b.index) | 0)), 0, h);
      } else if (op === 'remove') {
        const id = String(b.videoId || '');
        for (let i = list.length - 1; i >= 0; i--) if (list[i].videoId === id) list.splice(i, 1);
      } else if (op === 'import') {
        const arr = Array.isArray(b.items) ? b.items.slice(0, 300) : [];
        for (const o of arr) { const h = hit(o); if (h && !list.some(x => x.videoId === h.videoId)) list.push(h); }
      } else throw new ApiError(404, 'NOT_FOUND', 'Not found');
      while (list.length > 300) list.pop();
      Favs.save(store, list);
      ctl.noteFavsChangedByRemote();
      return this.favsReply(res);
    }

    if (method === 'POST' && p0 === 'karaoke') {
      const b = await this.readBody(req);
      ctl.setKaraoke(!!b.on);
      return this.reply(res);
    }

    if (method === 'POST' && p0 === 'settings') {
      const b = await this.readBody(req);
      if (b.maxHeight != null) { ctl.noteActor(dev); ctl.setMaxHeight(Number(b.maxHeight) || 720); }
      return this.reply(res);
    }

    if (method === 'POST' && p0 === 'pairing' && p1 === 'reset') {
      await this.readBody(req);
      settings.token = require('./util').newToken();
      this.ctl.emit('token');
      return this.sendJson(res, 200, { token: settings.token, ok: true }, {
        'set-cookie': 'kt=' + settings.token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000'
      });
    }
    throw new ApiError(404, 'NOT_FOUND', 'Not found');
  }

  async searchByChannel(q, chan, page) {
    if (page > 0) return { hits: [], hasMore: false };
    const hits = await chanSearch.searchByChannel(p => this.ctl.runSearch(q, p, 'remote'), chan);
    return { hits, hasMore: false };
  }

  async search(res, q) {
    const ctl = this.ctl;
    const text = (q.get('q') || '').trim();
    if (!text || text.length > 200) throw new ApiError(400, 'INVALID_QUERY', 'Query must be 1-200 chars');
    const page = Math.max(0, Math.min(2000, parseInt(q.get('page') || '0', 10) || 0));
    const chan = (q.get('channel') || '').trim().slice(0, 100);
    if (page === 0) ctl.searchBegin(text, 'remote'); else ctl.searchLoadingMore();
    let r;
    try {
      r = chan ? await this.searchByChannel(text, chan, page) : await ctl.runSearch(text, page, 'remote');
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 120);
      ctl.searchFail(text, 'remote', msg);
      throw new ApiError(502, 'UPSTREAM_FAILED', 'Search failed: ' + msg);
    }
    ctl.searchDone(text, 'remote', page, r.hits, r.hasMore);
    const queued = ctl.pendingVideoIds();
    this.sendJson(res, 200, {
      results: r.hits.map(h => ({
        videoId: h.videoId, title: h.title, channel: h.channel, thumbnailUrl: thumb(h.videoId),
        durationSec: h.durationSec, alreadyQueued: queued.has(h.videoId)
      })),
      page, hasMore: r.hasMore
    });
  }
}

module.exports = { KaraokeServer };
