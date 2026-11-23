'use strict';
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const dns = require('dns');
const resolver = require('./resolver');

const CHUNK = 4 * 1024 * 1024; // YouTube bóp tốc độ nếu tải một mạch -> tải từng đoạn 4 MB (giống bản Android)

// Mỗi luồng có kết nối riêng, GIỮ SỐNG lâu: link googlevideo gắn với IP lúc lấy link, nếu mạng có nhiều đường ra
// internet thì mỗi kết nối mới có thể ra bằng IP khác và bị 403. Bị 403 thì mở kết nối mới (có thể ra đúng IP).
function newAgent(isHttps) {
  const o = { keepAlive: true, keepAliveMsecs: 30000, maxSockets: 2, maxFreeSockets: 2, timeout: 120000 };
  return isHttps ? new https.Agent(o) : new http.Agent(o);
}

/** GET có agent riêng, IPv4 (khớp yt-dlp -4), có thể ép kết nối tới một IP máy chủ cụ thể (pickIp). Đi theo chuyển hướng. */
async function request(url, headers, agent, signal, hops, pickIp) {
  hops = hops || 0;
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  let ip = null;
  if (pickIp && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) { try { ip = await pickIp(u.hostname); } catch (x) { ip = null; } }
  const lookup = ip ? (h, o, cb) => (o && o.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)) : undefined;
  const ag = agent && (agent instanceof https.Agent) === isHttps ? agent : undefined; // khác giao thức -> agent mặc định
  return new Promise((resolve, reject) => {
    const fail = e => { e.edgeIp = ip; e.edgeHost = u.hostname; reject(e); };
    const req = lib.request(u, { method: 'GET', headers, agent: ag, family: 4, signal, lookup }, res => {
      const st = res.statusCode, loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(st) && loc) {
        res.resume();
        if (hops >= 4) return fail(Object.assign(new Error('quá nhiều chuyển hướng'), { code: 'REDIRECTS' }));
        let next; try { next = new URL(loc, u).toString(); } catch (x) { return fail(new Error('Location hỏng')); }
        return request(next, headers, agent, signal, hops + 1, pickIp).then(r => { r.viaRedirect = new URL(next).hostname; resolve(r); }, reject);
      }
      res.edgeIp = ip; res.edgeHost = u.hostname;
      resolve(res);
    });
    req.setTimeout(10000, () => req.destroy(new Error('ETIMEDOUT')));
    req.on('error', fail);
    req.end();
  });
}

class StreamProxy {
  constructor(getBase) {
    this.getBase = getBase;
    this.entries = new Map(); // id -> { url, size, headers, mime }
    this.byUrl = new Map();   // url -> id
    this.edge = new Map();    // hostname -> { t, ips[], bad: Map(ip -> hết hạn) }
    this.pickIp = host => this.pickEdge(host);
  }

  /** Chọn ngẫu nhiên một IP của máy chủ googlevideo, tránh IP vừa bị từ chối (403/lỗi) trong 10 phút gần đây. */
  async pickEdge(host) {
    let c = this.edge.get(host);
    if (!c || Date.now() - c.t > 300000) {
      let ips = [];
      try { ips = await dns.promises.resolve4(host); } catch (x) { /* ignore */ }
      if (!ips.length) { try { ips = (await dns.promises.lookup(host, { all: true, family: 4 })).map(r => r.address); } catch (x) { /* ignore */ } }
      c = { t: Date.now(), ips, bad: c ? c.bad : new Map() };
      this.edge.set(host, c);
    }
    const now = Date.now();
    const good = c.ips.filter(ip => !(c.bad.get(ip) > now));
    const list = good.length ? good : c.ips;
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  markBad(host, ip) { const c = this.edge.get(host); if (c && ip) c.bad.set(ip, Date.now() + 600000); }
  markOk(host, ip) { const c = this.edge.get(host); if (c && ip) c.bad.delete(ip); }

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

  renewAgent(e) {
    const old = e.agent; e.agent = null;
    if (old) setTimeout(() => { try { old.destroy(); } catch (x) { /* ignore */ } }, 15000);
  }

  /**
   * Tải một đoạn. Thử cách 'param' (&range=) và 'header' (Range); nếu bị từ chối hoặc lỗi mạng thì MỞ KẾT NỐI MỚI
   * rồi thử lại (tối đa 4 vòng). Trả { res: IncomingMessage, mode }.
   */
  async fetchRange(e, start, end, outer) {
    const tried = [];
    let isHttps = false; try { isHttps = new URL(e.url).protocol === 'https:'; } catch (x) { /* ignore */ }
    let firstHost = ''; try { firstHost = new URL(e.url).hostname; } catch (x) { /* ignore */ }
    for (let round = 0; round < 10; round++) {
      const modes = this.modesFor(e);
      // Cố định MỘT máy chủ (IP) cho cả vòng này để kết quả 403 quy đúng cho máy chủ đó
      const roundIp = firstHost && !/^\d+\.\d+\.\d+\.\d+$/.test(firstHost) ? await this.pickEdge(firstHost) : null;
      const pick = h => (h === firstHost && roundIp ? roundIp : this.pickEdge(h));
      for (const mode of (round === 0 ? modes : [e.mode || modes[0]])) {
        if (outer && outer.aborted) throw new Error('aborted');
        if (!e.agent) e.agent = newAgent(isHttps);
        const rq = this.buildReq(e, start, end, mode);
        const sig = outer ? AbortSignal.any([outer, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
        try {
          const r = await request(rq.url, rq.headers, e.agent, sig, 0, pick);
          const want = end - start + 1, cl = Number(r.headers['content-length'] || 0);
          const st = r.statusCode;
          const okStatus = mode === 'param' ? (st === 200 || st === 206) : (st === 206 || (st === 200 && start === 0));
          if (okStatus && !(mode === 'param' && cl && cl > want)) {
            this.markOk(r.edgeHost, r.edgeIp);
            if (e.mode !== mode || round > 0 || !e.edgeLogged) {
              e.edgeLogged = true;
              e.mode = mode;
              resolver.log('PROXY dùng cách ' + mode + (round ? ' sau ' + round + ' lần mở kết nối mới' : '') + (tried.length ? ' (' + tried.slice(0, 4).join(', ') + (tried.length > 4 ? ', …' : '') + ')' : '') + (r.viaRedirect ? ' qua chuyển hướng ' + r.viaRedirect : '') + ' · máy chủ ' + (r.edgeIp || '?'));
            }
            return { res: r, mode };
          }
          tried.push(mode + ':' + st + '@' + (r.edgeIp || '?'));
          this.markBad(r.edgeHost, r.edgeIp);
          r.resume();
        } catch (err) {
          if (outer && outer.aborted) throw err;
          tried.push(mode + ':' + (err && err.code || err && err.message || 'lỗi mạng') + '@' + ((err && err.edgeIp) || '?'));
          this.markBad(err && err.edgeHost, err && err.edgeIp);
        }
      }
      this.renewAgent(e); // kết nối mới có thể ra internet bằng IP khác
      await new Promise(res => setTimeout(res, 150));
    }
    let ip = '?'; try { ip = new URL(e.url).searchParams.get('ip') || '?'; } catch (x) { /* ignore */ }
    resolver.log('PROXY FAIL bytes=' + start + '-' + end + ' (link cấp cho IP ' + ip + ') ' + tried.slice(0, 6).join(' | ') + (tried.length > 6 ? ' | … (' + tried.length + ' lần)' : ''));
    throw new Error('proxy: ' + tried.join(' | '));
  }

  async probeSize(e, outer) {
    try {
      const c = Number(new URL(e.url).searchParams.get('clen') || 0);
      if (c > 0) return c;
    } catch (x) { /* ignore */ }
    const { res: r } = await this.fetchRange({ ...e, mode: 'header' }, 0, 1, outer);
    r.resume();
    const cr = r.headers['content-range'];
    const m = cr && /\/(\d+)$/.exec(cr);
    if (m) return Number(m[1]);
    const cl = Number(r.headers['content-length'] || 0);
    if (r.statusCode === 200 && cl > 0) return cl;
    throw new Error('Không biết dung lượng luồng (HTTP ' + r.statusCode + ')');
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
      up.on('error', () => { try { res.destroy(); } catch (x) { /* ignore */ } });
      res.on('close', () => { try { up.destroy(); } catch (x) { /* ignore */ } });
      up.pipe(res);
    } catch (err) {
      if (!res.headersSent) { res.writeHead(502); res.end(); } else { try { res.destroy(); } catch (x) { /* ignore */ } }
    }
    return true;
  }
}

module.exports = { StreamProxy, CHUNK };
