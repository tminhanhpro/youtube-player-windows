'use strict';
const crypto = require('crypto');
const { Readable } = require('stream');

const resolver = require('./resolver');
const CHUNK = 4 * 1024 * 1024; // YouTube bóp tốc độ nếu tải một mạch -> tải từng đoạn 4 MB (giống bản Android)

/**
 * Proxy luồng video: cửa sổ phát http://127.0.0.1:PORT/internal/s/<id>; proxy lấy từng đoạn từ googlevideo
 * (có Range, đúng User-Agent) nên không bị bóp tốc độ, không vướng CORS/Referer.
 */
class StreamProxy {
  constructor(getBase) {
    this.getBase = getBase;
    this.entries = new Map(); // id -> { url, size, headers, mime }
    this.byUrl = new Map();   // url -> id
  }

  /** Đăng ký một nguồn, trả về URL cục bộ. */
  local(src) {
    if (!src) return null;
    let id = this.byUrl.get(src.url);
    if (!id) {
      id = crypto.randomBytes(9).toString('base64url');
      this.entries.set(id, { url: src.url, size: src.size || 0, headers: src.headers || {}, mime: src.mime || 'video/mp4' });
      this.byUrl.set(src.url, id);
      if (this.entries.size > 60) {
        const old = this.entries.keys().next().value;
        this.byUrl.delete(this.entries.get(old).url);
        this.entries.delete(old);
      }
    }
    return this.getBase() + '/internal/s/' + id;
  }

  /** Biến lệnh 'load' của controller thành lệnh dùng URL cục bộ. */
  rewrite(cmd) {
    if (cmd && cmd.type === 'load' && cmd.mode === 'stream' && cmd.src) {
      return {
        ...cmd,
        src: {
          height: cmd.src.height,
          video: { url: this.local(cmd.src.video) },
          audio: cmd.src.audio ? { url: this.local(cmd.src.audio) } : null
        }
      };
    }
    return cmd;
  }

  /** Tạo request tải đoạn [start,end]. 'param' = cách yt-dlp dùng (&range=a-b trên URL), 'header' = Range header. */
  buildReq(e, start, end, mode) {
    const headers = {};
    const skip = ['host', 'accept-encoding', 'range', 'content-length', 'connection'];
    for (const k of Object.keys(e.headers || {})) if (!skip.includes(k.toLowerCase())) headers[k] = e.headers[k];
    if (mode === 'param') {
      const u = new URL(e.url); u.searchParams.set('range', start + '-' + end);
      return { url: u.toString(), headers };
    }
    headers.Range = 'bytes=' + start + '-' + end;
    return { url: e.url, headers };
  }

  modesFor(e) {
    let u; try { u = new URL(e.url); } catch (x) { return ['header']; }
    const g = /googlevideo\.com$/.test(u.hostname) || u.searchParams.has('clen');
    const order = g ? ['param', 'header'] : ['header'];
    if (e.mode && order.includes(e.mode)) return [e.mode, ...order.filter(m => m !== e.mode)];
    return order;
  }

  /**
   * Tải một đoạn, thử lần lượt các cách (googlevideo hay 403 với cách này nhưng được với cách kia).
   * Lỗi mạng thì thử lại 2 lần (10 giây/lần); lỗi HTTP thì chuyển cách khác ngay.
   */
  async fetchRange(e, start, end, outer) {
    const tried = [];
    for (const mode of this.modesFor(e)) {
      for (let i = 0; i < 2; i++) {
        if (outer && outer.aborted) throw new Error('aborted');
        const rq = this.buildReq(e, start, end, mode);
        const sig = outer ? AbortSignal.any([outer, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
        try {
          const r = await fetch(rq.url, { headers: rq.headers, signal: sig });
          const want = end - start + 1, cl = Number(r.headers.get('content-length') || 0);
          const okStatus = mode === 'param' ? r.status === 200 || r.status === 206 : r.status === 206 || (r.status === 200 && start === 0);
          if (okStatus && !(mode === 'param' && cl && cl > want)) {
            if (e.mode !== mode) { e.mode = mode; resolver.log('PROXY dùng cách ' + mode + (tried.length ? ' (sau khi ' + tried.join(', ') + ')' : '')); }
            return { res: r, mode };
          }
          tried.push(mode + ':' + r.status);
          try { r.body && r.body.cancel(); } catch (x) { /* ignore */ }
          break; // lỗi HTTP -> sang cách khác
        } catch (err) {
          if (outer && outer.aborted) throw err;
          tried.push(mode + ':' + (err && err.cause && err.cause.code || err && err.name || 'lỗi mạng'));
          await new Promise(res => setTimeout(res, 300));
        }
      }
    }
    resolver.log('PROXY FAIL bytes=' + start + '-' + end + ' ' + tried.join(' | '));
    throw new Error('proxy: ' + tried.join(' | '));
  }

  async probeSize(e, outer) {
    try {
      const c = Number(new URL(e.url).searchParams.get('clen') || 0);
      if (c > 0) return c;
    } catch (x) { /* ignore */ }
    const { res: r } = await this.fetchRange({ ...e, mode: 'header' }, 0, 1, outer);
    const cr = r.headers.get('content-range');
    try { r.body && r.body.cancel(); } catch (x) { /* ignore */ }
    const m = cr && /\/(\d+)$/.exec(cr);
    if (m) return Number(m[1]);
    const cl = Number(r.headers.get('content-length') || 0);
    if (r.status === 200 && cl > 0) return cl;
    throw new Error('Không biết dung lượng luồng (HTTP ' + r.status + ')');
  }

  /** Xử lý GET /internal/s/<id>. Trả true nếu đã xử lý. */
  async route(req, res, url) {
    if (!url.pathname.startsWith('/internal/s/')) return false;
    const e = this.entries.get(url.pathname.slice(12));
    if (!e) { res.writeHead(404); res.end(); return true; }
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    try {
      if (!e.size) e.size = await this.probeSize(e, ac.signal);
      const total = e.size;
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      let start = m && m[1] !== '' ? Number(m[1]) : 0;
      let end = m && m[2] !== '' ? Number(m[2]) : total - 1;
      if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, total - Number(m[2])); end = total - 1; }
      if (start >= total) { res.writeHead(416, { 'content-range': 'bytes */' + total }); res.end(); return true; }
      end = Math.min(end, start + CHUNK - 1, total - 1);
      const { res: up } = await this.fetchRange(e, start, end, ac.signal);
      res.writeHead(206, {
        'content-type': e.mime, 'accept-ranges': 'bytes', 'cache-control': 'no-store',
        'content-range': 'bytes ' + start + '-' + end + '/' + total, 'content-length': end - start + 1
      });
      const body = Readable.fromWeb(up.body);
      body.on('error', () => { try { res.destroy(); } catch (x) { /* ignore */ } });
      body.pipe(res);
    } catch (err) {
      if (!res.headersSent) { res.writeHead(502); res.end(); } else { try { res.destroy(); } catch (x) { /* ignore */ } }
    }
    return true;
  }
}

module.exports = { StreamProxy, CHUNK };
