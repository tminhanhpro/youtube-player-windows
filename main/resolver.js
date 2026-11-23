'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { oembed } = require('./search');

class UnavailableError extends Error {}

/** Thư mục chứa yt-dlp.exe / deno.exe: resources/bin khi đã đóng gói, ./bin khi chạy thử. */
function binDir() {
  const cands = [];
  if (process.resourcesPath) cands.push(path.join(process.resourcesPath, 'bin'));
  cands.push(path.join(__dirname, '..', 'bin'));
  for (const d of cands) { try { if (fs.existsSync(d)) return d; } catch (e) { /* ignore */ } }
  return null;
}

function exe(name) {
  const d = binDir();
  const f = process.platform === 'win32' ? name + '.exe' : name;
  if (d && fs.existsSync(path.join(d, f))) return path.join(d, f);
  return null;
}

function runYtDlp(url) {
  return new Promise((resolve, reject) => {
    const bin = exe('yt-dlp') || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    const args = ['-J', '--no-playlist', '--no-warnings', '--skip-download', '--no-cache-dir', '--socket-timeout', '15'];
    const deno = exe('deno');
    const env = { ...process.env };
    if (deno) {
      args.push('--js-runtimes', 'deno:' + deno);
      env.PATH = path.dirname(deno) + path.delimiter + (env.PATH || '');
    }
    args.push(url);
    let out = '', err = '';
    const p = spawn(bin, args, { env, windowsHide: true });
    const timer = setTimeout(() => { try { p.kill(); } catch (e) { /* ignore */ } reject(new Error('yt-dlp timeout')); }, 40000);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; if (err.length > 8000) err = err.slice(-8000); });
    p.on('error', e => { clearTimeout(timer); reject(new Error('Không chạy được yt-dlp: ' + e.message)); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !out.trim()) {
        const msg = (err.split('\n').filter(Boolean).pop() || 'yt-dlp lỗi ' + code).slice(0, 300);
        if (/Video unavailable|Private video|removed|not available|copyright|members-only|age/i.test(err)) {
          return reject(new UnavailableError(msg));
        }
        return reject(new Error(msg));
      }
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('yt-dlp trả dữ liệu hỏng')); }
    });
  });
}

const cache = new Map(); // "id|maxH" -> Resolved
const inflight = new Map();

function cached(id, maxH) {
  const k = id + '|' + maxH;
  const r = cache.get(k);
  if (!r) return null;
  if (Date.now() > r.expiresAt - 60000) { cache.delete(k); return null; }
  return r;
}

function invalidate(id) {
  for (const k of [...cache.keys()]) if (k.startsWith(id + '|')) cache.delete(k);
}

const fmtSrc = f => ({
  url: f.url, size: f.filesize || f.filesize_approx || 0, headers: f.http_headers || {},
  mime: (f.vcodec && f.vcodec !== 'none' ? 'video/' : 'audio/') + (f.ext === 'm4a' || f.ext === 'mp4' ? 'mp4' : (f.ext || 'mp4'))
});
const H = f => f.height || 0;

function build(info, maxH) {
  const formats = (info.formats || []).filter(f => f.url && /^https?/.test(f.protocol || '') && !f.url.includes('.m3u8'));
  const muxed = formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.ext === 'mp4');
  const videoOnly = formats.filter(f => f.vcodec && f.vcodec.startsWith('avc1') && (!f.acodec || f.acodec === 'none') && f.ext === 'mp4');
  const audios = formats.filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  const audio = audios.filter(f => f.ext === 'm4a').sort((a, b) => (b.abr || 0) - (a.abr || 0))[0] ||
    audios.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
  const bestMuxed = muxed.filter(f => H(f) <= maxH).sort((a, b) => H(b) - H(a))[0] ||
    muxed.sort((a, b) => H(a) - H(b))[0];
  const bestVideo = videoOnly.filter(f => H(f) <= maxH).sort((a, b) => H(b) - H(a))[0];

  const sources = [];
  if (bestVideo && audio && (!bestMuxed || H(bestVideo) > H(bestMuxed))) {
    sources.push({ video: fmtSrc(bestVideo), audio: fmtSrc(audio), height: H(bestVideo) });
  }
  if (bestMuxed) sources.push({ video: fmtSrc(bestMuxed), audio: null, height: H(bestMuxed) });
  if (!sources.length) throw new UnavailableError('No playable stream');
  const m = /[?&]expire=(\d+)/.exec(sources[0].video.url);
  const expiresAt = m ? Number(m[1]) * 1000 : Date.now() + 5 * 60000;
  return {
    sources, expiresAt,
    title: info.title || '', channel: info.uploader || info.channel || '',
    durationSec: Math.round(info.duration || 0)
  };
}

async function resolve(id, maxH) {
  const c = cached(id, maxH);
  if (c) return c;
  const k = id + '|' + maxH;
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    const info = await runYtDlp('https://www.youtube.com/watch?v=' + id);
    const r = build(info, maxH);
    cache.set(k, r);
    return r;
  })();
  inflight.set(k, p);
  try { return await p; } finally { inflight.delete(k); }
}

/** Tiêu đề/kênh/thời lượng (dùng cho "dán link"). null nếu lỗi. */
async function meta(id) {
  try {
    const r = await resolve(id, 720);
    return { title: r.title, channel: r.channel, durationSec: r.durationSec };
  } catch (e) {
    const o = await oembed(id);
    return o ? { title: o.title, channel: o.channel, durationSec: 0 } : null;
  }
}

async function channelUrl(id) {
  try {
    const info = await runYtDlp('https://www.youtube.com/watch?v=' + id);
    return info.channel_url || info.uploader_url || null;
  } catch (e) { return null; }
}

module.exports = { resolve, cached, invalidate, meta, channelUrl, UnavailableError, binDir, exe };
