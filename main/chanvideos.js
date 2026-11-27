'use strict';
// Lấy TẤT CẢ video của một kênh YouTube bằng yt-dlp (--flat-playlist trên tab "Video"): nhanh vì không mở từng video,
// và đổ dần từng lô về giao diện. Mới nhất ở trên đầu.
const { spawn } = require('child_process');
const { ID_RE } = require('./util');

const MAX_VIDEOS = 5000, BATCH_N = 30, BATCH_MS = 700, IDLE_MS = 60000;

/** Trang "Video" của kênh từ link kênh (https://www.youtube.com/channel/UC... hoặc /@tên). */
function videosUrl(channelUrl) {
  const u = String(channelUrl || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return /\/videos$/.test(u) ? u : u + '/videos';
}

/** Một dòng JSON của yt-dlp -> bài hát, hoặc null nếu không nhận (Shorts, đang/sắp phát trực tiếp, video bị xoá/riêng tư). */
function toHit(e, fallbackChannel) {
  if (!e || typeof e !== 'object' || !ID_RE.test(e.id || '')) return null;
  const title = String(e.title || '');
  if (/^\[(Private|Deleted) video\]$/i.test(title)) return null;
  if (e.live_status === 'is_upcoming' || e.live_status === 'is_live') return null;
  const dur = e.duration == null ? -1 : Math.round(Number(e.duration) || 0);
  if (dur >= 0 && dur <= 60) return null;   // giống tìm kiếm: bỏ Shorts/clip ngắn; không rõ thời lượng thì vẫn giữ
  return { videoId: e.id, title, channel: e.channel || e.uploader || fallbackChannel || '', durationSec: Math.max(0, dur) };
}

/**
 * Bắt đầu lấy danh sách. onBatch(listSoFar) được gọi định kỳ. Trả về { done, kill }:
 * done -> Promise<list> (bị kill giữa chừng thì trả phần đã có; lỗi mà chưa có bài nào thì reject).
 * opts.bin / opts.args: dùng cho kiểm thử (yt-dlp giả).
 */
function listChannelVideos(channelUrl, onBatch, opts) {
  opts = opts || {};
  const bin = opts.bin || require('./resolver').exe('yt-dlp') || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const args = (opts.args || []).concat(['-4', '--flat-playlist', '--lazy-playlist', '-j', '--playlist-end', String(MAX_VIDEOS),
    '--no-warnings', '--no-cache-dir', '--socket-timeout', '15', videosUrl(channelUrl)]);
  const list = [], seen = new Set();
  let p = null, killed = false, lastEmit = 0, sinceEmit = 0, idle = null, buf = '', err = '';
  const emit = force => {
    if (!list.length || !onBatch) return;
    if (force || sinceEmit >= BATCH_N || Date.now() - lastEmit >= BATCH_MS) { lastEmit = Date.now(); sinceEmit = 0; try { onBatch(list.slice()); } catch (e) { /* bỏ qua */ } }
  };
  const feed = line => {
    line = line.trim(); if (!line || line[0] !== '{') return;
    let e; try { e = JSON.parse(line); } catch (x) { return; }
    const h = toHit(e, opts.channelName);
    if (!h || seen.has(h.videoId)) return;
    seen.add(h.videoId); list.push(h); sinceEmit++;
    if (list.length >= MAX_VIDEOS) kill();
    else emit(false);
  };
  const kill = () => { killed = true; clearTimeout(idle); try { p && p.kill(); } catch (e) { /* ignore */ } };
  const done = new Promise((resolve, reject) => {
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => { killed = true; try { p.kill(); } catch (e) { /* ignore */ } }, IDLE_MS); };
    try { p = spawn(bin, args, { windowsHide: true }); } catch (e) { return reject(new Error('Không chạy được yt-dlp: ' + e.message)); }
    bump();
    p.stdout.on('data', d => { bump(); buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { feed(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    p.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    p.on('error', e => { clearTimeout(idle); reject(new Error('Không chạy được yt-dlp: ' + e.message)); });
    p.on('close', code => {
      clearTimeout(idle); feed(buf); buf = '';
      if (list.length || killed) { emit(true); return resolve(list); }
      reject(new Error((err.split('\n').filter(Boolean).pop() || 'yt-dlp lỗi ' + code).slice(0, 200)));
    });
  });
  return { done, kill };
}

module.exports = { listChannelVideos, videosUrl, toHit, MAX_VIDEOS };
