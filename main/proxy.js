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

  headersFor(e, range) {
    const h = { Range: range };
    const src = e.headers || {};
    for (const k of Object.keys(src)) {
      const lk = k.toLowerCase();
      if (lk === 'user-agent' || lk === 'accept-language') h[k] = src[k];
    }
    return h;
  }

  /** fetch có thử lại (mạng chập chờn/kết nối đầu tiên chậm): tối đa 3 lần, mỗi lần 10 giây. */
  async fetchRetry(e, range, outer) {
    let last = null;
    for (let i = 0; i < 3; i++) {
      if (outer && outer.aborted) throw new Error('aborted');
      const sig = outer ? AbortSignal.any([outer, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
      try {
        const r = await fetch(e.url, { headers: this.headersFor(e, range), signal: sig });
        if (r.status === 206 || r.status === 200) return r;
        last = new Error('HTTP ' + r.status);
        try { r.body && r.body.cancel(); } catch (x) { /* ignore */ }
        if (r.status === 403 || r.status === 404 || r.status === 410) break; // link hỏng thật, thử lại cũng vô ích
      } catch (err) { last = err; if (outer && outer.aborted) throw err; }
      await new Promise(res => setTimeout(res, 300));
    }
    resolver.log('PROXY FAIL ' + range + ' ' + (last && (last.cause && last.cause.code || last.message)));
    throw last || new Error('proxy lỗi');
  }

  async probeSize(e, outer) {
    const r = await this.fetchRetry(e, 'bytes=0-1', outer);
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
      const up = await this.fetchRetry(e, 'bytes=' + start + '-' + end, ac.signal);
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
