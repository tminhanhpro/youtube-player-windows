'use strict';
const crypto = require('crypto');
const { Readable } = require('stream');

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

  async probeSize(e) {
    const r = await fetch(e.url, { headers: this.headersFor(e, 'bytes=0-1'), signal: AbortSignal.timeout(15000) });
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
      if (!e.size) e.size = await this.probeSize(e);
      const total = e.size;
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      let start = m && m[1] !== '' ? Number(m[1]) : 0;
      let end = m && m[2] !== '' ? Number(m[2]) : total - 1;
      if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, total - Number(m[2])); end = total - 1; }
      if (start >= total) { res.writeHead(416, { 'content-range': 'bytes */' + total }); res.end(); return true; }
      end = Math.min(end, start + CHUNK - 1, total - 1);
      const up = await fetch(e.url, { headers: this.headersFor(e, 'bytes=' + start + '-' + end), signal: ac.signal });
      if (up.status !== 206 && up.status !== 200) {
        res.writeHead(up.status === 403 ? 403 : 502); res.end(); return true;
      }
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
