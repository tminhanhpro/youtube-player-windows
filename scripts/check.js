'use strict';
// Kiểm thử nhanh phần nền (không cần Electron, không cần mạng): server + hàng đợi + thể loại + yêu thích.
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const { Store, Settings } = require('../main/store');
const { Controller } = require('../main/controller');
const { KaraokeServer } = require('../main/server');

const http = require('http');
const resolver = require('../main/resolver');
const { StreamProxy } = require('../main/proxy');

// --- GĐ2: proxy luồng (có Range) + máy trạng thái phát với trình phát giả ---
async function testPlayback(dir) {
  const data = Buffer.alloc(10 * 1024 * 1024); for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const up = http.createServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'content-length': data.length }); return res.end(data); }
    const a = Number(m[1]), b = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
    res.writeHead(206, { 'content-range': 'bytes ' + a + '-' + b + '/' + data.length, 'content-length': b - a + 1 });
    res.end(data.subarray(a, b + 1));
  });
  await new Promise(r => up.listen(0, '127.0.0.1', r));
  const upPort = up.address().port;
  const proxy = new StreamProxy(() => 'http://127.0.0.1:9');
  const local = proxy.local({ url: 'http://127.0.0.1:' + upPort + '/v', size: 0, headers: {}, mime: 'video/mp4' });
  const id = local.split('/').pop();
  const pxy = http.createServer((req, res) => proxy.route(req, res, new URL(req.url, 'http://x')));
  await new Promise(r => pxy.listen(0, '127.0.0.1', r));
  const get = (range) => fetch('http://127.0.0.1:' + pxy.address().port + '/internal/s/' + id, { headers: range ? { range } : {} });
  let r = await get('bytes=0-'); assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 0-4194303/' + data.length);   // bị cắt còn 4 MB
  let buf = Buffer.from(await r.arrayBuffer()); assert.ok(buf.equals(data.subarray(0, 4194304)));
  r = await get('bytes=5000000-5000099'); assert.equal(r.status, 206);
  buf = Buffer.from(await r.arrayBuffer()); assert.ok(buf.equals(data.subarray(5000000, 5000100)));
  r = await get('bytes=99999999-'); assert.equal(r.status, 416);
  r = await fetch('http://127.0.0.1:' + pxy.address().port + '/internal/s/khongco'); assert.equal(r.status, 404);
  const rw = proxy.rewrite({ type: 'load', mode: 'stream', src: { height: 720, video: { url: 'http://a/v', mime: 'video/mp4' }, audio: { url: 'http://a/a', mime: 'audio/mp4' } } });
  assert.ok(rw.src.video.url.includes('/internal/s/') && rw.src.audio.url.includes('/internal/s/'));
  pxy.close(); up.close();

  // máy trạng thái: trình phát giả
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp2-'))), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  let resolves = 0, failFor = null; const resolvedIds = [];
  resolver.resolve = async (vid) => {
    resolves++; resolvedIds.push(vid);
    if (vid === failFor) throw new resolver.UnavailableError('x');
    return { sources: [{ video: { url: 'http://x/' + vid }, audio: null, height: 720 }], expiresAt: Date.now() + 1e6, title: 'T', channel: 'C', durationSec: 100 };
  };
  const cmds = []; ctl.on('player', c => cmds.push(c));
  ctl.attachPlayer(true);
  ctl.add('aaaaaaaaaaa', 'A', '', 100, 'u', 'end', false);
  ctl.add('bbbbbbbbbbb', 'B', '', 100, 'u', 'end', false);
  ctl.add('ccccccccccc', 'C', '', 100, 'u', 'end', false);
  await new Promise(r => setTimeout(r, 50));
  let load = cmds.filter(c => c.type === 'load').pop();
  assert.equal(load.videoId, 'aaaaaaaaaaa'); assert.equal(ctl.state, 'RESOLVING');
  ctl.playerEvent('started', load.key); assert.equal(ctl.state, 'PLAYING');
  ctl.playerEvent('pos', load.key, 30000, 100000); assert.equal(ctl.progress()[0], 30000);
  ctl.pause(); assert.equal(ctl.state, 'PAUSED'); assert.equal(cmds.pop().type, 'pause');
  ctl.resume(); assert.equal(ctl.state, 'PLAYING');
  ctl.seekTo(null, 10000); assert.equal(cmds.pop().ms, 40000);
  ctl.playerEvent('ended', load.key);                       // sang bài B
  await new Promise(r => setTimeout(r, 50));
  load = cmds.filter(c => c.type === 'load').pop(); assert.equal(load.videoId, 'bbbbbbbbbbb');
  // lỗi luồng -> thử lại cùng nguồn (2 lần) -> giải link lại (1 lần) -> rồi báo lỗi và chuyển bài
  const loadsOf = () => cmds.filter(c => c.type === 'load').length;
  const bCount = () => resolvedIds.filter(v => v === 'bbbbbbbbbbb').length; const r0 = bCount(); let n = loadsOf();
  for (let i = 0; i < 2; i++) {
    ctl.playerEvent('error', load.key); await new Promise(r => setTimeout(r, 500));
    assert.equal(loadsOf(), n + 1); assert.equal(bCount(), r0); n++;                 // nạp lại cùng link, chưa giải link mới
  }
  ctl.playerEvent('error', load.key); await new Promise(r => setTimeout(r, 50));
  assert.equal(cmds.filter(c => c.type === 'load').pop().videoId, 'bbbbbbbbbbb'); assert.ok(bCount() > r0);
  load = cmds.filter(c => c.type === 'load').pop();
  ctl.playerEvent('error', load.key); await new Promise(r => setTimeout(r, 500));
  load = cmds.filter(c => c.type === 'load').pop();
  ctl.playerEvent('error', load.key); await new Promise(r => setTimeout(r, 500));
  load = cmds.filter(c => c.type === 'load').pop();
  ctl.playerEvent('error', load.key); assert.equal(ctl.state, 'ERROR');
  await new Promise(r => setTimeout(r, 1800));
  load = cmds.filter(c => c.type === 'load').pop(); assert.equal(load.videoId, 'ccccccccccc');
  // bài không khả dụng -> bỏ qua
  failFor = 'ddddddddddd'; ctl.add('ddddddddddd', 'D', '', 1, 'u', 'end', false);
  ctl.playerEvent('ended', load.key); await new Promise(r => setTimeout(r, 1900));
  assert.equal(ctl.state, 'IDLE');
  // iframe dự phòng
  settings.backend = 'IFRAME';
  ctl.add('eeeeeeeeeee', 'E', '', 1, 'u', 'end', false); await new Promise(r => setTimeout(r, 50));
  load = cmds.filter(c => c.type === 'load').pop(); assert.equal(load.mode, 'iframe');
  ctl.playerEvent('started', load.key); assert.equal(ctl.state, 'PLAYING');
  ctl.stop();
  console.log('Phát video: proxy + máy trạng thái đều đạt');
}

// --- GĐ4: màn hình ngoài (HDMI) với màn hình/cửa sổ giả ---
const { TvManager } = require('../main/tv');
function testTv() {
  const sent = [];
  let nextId = 1;
  const mkWin = (bounds) => {
    const w = { destroyed: false, bounds, handlers: {}, webContents: { id: nextId++, send: (ch, d) => sent.push([w.webContents.id, ch, d]) },
      isDestroyed: () => w.destroyed, getBounds: () => w.bounds, setBounds: b => { w.bounds = b; },
      destroy: () => { w.destroyed = true; (w.handlers.closed || []).forEach(h => h()); },
      on: (ev, cb) => { (w.handlers[ev] = w.handlers[ev] || []).push(cb); } };
    return w;
  };
  const laptop = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const tvDisp = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  let displays = [laptop];
  const dash = mkWin(laptop.bounds);
  const screen = {
    getAllDisplays: () => displays,
    getDisplayMatching: b => displays.find(d => b.x >= d.bounds.x && b.x < d.bounds.x + d.bounds.width) || displays[0]
  };
  const events = [];
  const ctl = { current: { itemId: 'k1' }, pos: 42000, state: 'PLAYING', userPaused: false, volume: 80, playerEvent: (...a) => events.push(a) };
  let mode = 'AUTO'; let made = 0;
  const tv = new TvManager({ screen, makeWindow: d => { made++; return mkWin(d.bounds); }, getDash: () => dash, ctl, getMode: () => mode });

  tv.sync(); assert.equal(made, 0, 'chưa cắm HDMI thì không mở cửa sổ TV');
  assert.equal(tv.masterId(), dash.webContents.id);
  tv.onCtlPlayer({ type: 'load', mode: 'stream', key: 'k1', videoId: 'v', src: { video: { url: 'u' } } });
  assert.equal(tv.onPlayerEvent(dash.webContents.id, { kind: 'pos', key: 'k1', a: 1000, b: 9000 }), true);

  displays = [laptop, tvDisp]; tv.sync(); assert.equal(made, 1, 'cắm HDMI -> mở cửa sổ TV');
  tv.sync(); assert.equal(made, 1, 'sync lặp không mở thêm');
  const tvWin = tv.tv; assert.deepEqual(tvWin.bounds, tvDisp.bounds, 'cửa sổ TV phủ đúng màn hình ngoài');
  assert.equal(tv.active(), false, 'chưa sẵn sàng thì laptop vẫn là chủ');
  assert.equal(tv.masterId(), dash.webContents.id);
  tv.onPlayerReady(tvWin.webContents.id);
  assert.equal(tv.active(), true); assert.equal(tv.masterId(), tvWin.webContents.id);
  const resent = sent.find(m => m[0] === tvWin.webContents.id && m[1] === 'player');
  assert.ok(resent && resent[2].startMs === 42000 && resent[2].key === 'k1', 'TV phát tiếp đúng vị trí');
  assert.ok(sent.some(m => m[0] === dash.webContents.id && m[1] === 'tv-state' && m[2].active === true), 'laptop được báo để tắt tiếng');
  // chỉ nhận báo cáo từ cửa sổ chủ (TV); laptop bị bỏ qua
  const n = events.length;
  assert.equal(tv.onPlayerEvent(dash.webContents.id, { kind: 'ended', key: 'k1' }), false); assert.equal(events.length, n);
  assert.equal(tv.onPlayerEvent(tvWin.webContents.id, { kind: 'pos', key: 'k1', a: 5000, b: 9000 }), true);
  assert.ok(sent.some(m => m[0] === dash.webContents.id && m[1] === 'player' && m[2].type === 'sync' && m[2].ms === 5000), 'khung laptop được đồng bộ');
  // lệnh phát gửi tới cả hai cửa sổ
  const before = sent.length; tv.broadcastPlayer({ type: 'pause' });
  assert.equal(sent.length, before + 2);
  // rút HDMI
  displays = [laptop]; tv.sync(); assert.equal(tv.tv, null); assert.equal(tv.active(), false);
  assert.equal(tv.masterId(), dash.webContents.id, 'laptop lại là chủ');
  assert.ok(sent.filter(m => m[1] === 'tv-state').pop()[2].active === false);
  // tắt xuất TV trong cài đặt dù có màn hình ngoài
  mode = 'OFF'; displays = [laptop, tvDisp]; tv.sync(); assert.equal(tv.tv, null);
  mode = 'AUTO'; tv.sync(); assert.ok(tv.tv);
  // cửa sổ TV tự đóng bất ngờ
  tv.tv.destroy(); assert.equal(tv.tv, null); assert.equal(tv.masterId(), dash.webContents.id);
  // kéo cửa sổ chính sang màn hình ngoài -> màn "ngoài" giờ là laptop
  dash.bounds = { x: 2000, y: 0, width: 1000, height: 800 }; tv.sync();
  assert.deepEqual(tv.tv.bounds, laptop.bounds);
  console.log('Xuất HDMI: logic màn hình ngoài đều đạt');
}

(async () => {
  testTv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-'));
  const store = new Store(dir), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  const srv = new KaraokeServer({ ctl, settings, store, webDir: path.join(__dirname, '..', 'web'), uiDir: path.join(__dirname, '..', 'renderer') });
  const port = await srv.listen();
  ctl.start();
  const base = 'http://127.0.0.1:' + port;
  const tok = settings.token;
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok, 'x-device': 'Test' };
  const j = async (m, p, b, h) => { const r = await fetch(base + p, { method: m, headers: { ...H, ...(h || {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };

  let r = await j('GET', '/api/state'); assert.equal(r.s, 200); assert.equal(r.b.state.state, 'IDLE');
  r = await j('POST', '/api/queue', { videoId: 'dQw4w9WgXcQ', title: 'Bai 1', channel: 'A', durationSec: 200 }); assert.equal(r.s, 200);
  r = await j('POST', '/api/queue', { url: 'https://youtu.be/9bZkp7q19f0', title: 'Bai 2' }); assert.equal(r.s, 200);
  r = await j('POST', '/api/queue', { url: 'https://youtu.be/9bZkp7q19f0', title: 'Bai 2' }); assert.equal(r.s, 409);
  r = await j('POST', '/api/queue', { url: 'https://evil.com/watch?v=dQw4w9WgXcQ' }); assert.equal(r.s, 400);
  r = await j('GET', '/api/state'); assert.equal(r.b.state.nowPlaying.title, 'Bai 1'); assert.equal(r.b.state.queue.length, 1);
  r = await j('POST', '/api/queue/' + r.b.state.queue[0].itemId + '/prioritize', {}); assert.equal(r.s, 200);
  r = await j('POST', '/api/player/volume', { level: 40 }); assert.equal(r.b.level, 40);
  r = await j('POST', '/api/react', { id: 'heart' }); assert.equal(r.b.ok, true);
  r = await j('POST', '/api/react', { id: 'nope' }); assert.equal(r.s, 400);
  r = await j('POST', '/api/message', { text: 'xin chào' }); assert.equal(r.b.ok, true);
  r = await j('GET', '/api/cats'); assert.equal(r.b.cats.length, 5);
  r = await j('POST', '/api/cats/add', { name: 'Rap', q: 'rap viet' }); assert.equal(r.b.cats.length, 6);
  r = await j('POST', '/api/cats/delete', { index: 0, oldName: 'Acoustic & Hòa Tấu' }); assert.equal(r.b.cats.length, 5);
  r = await j('POST', '/api/favs/add', { videoId: 'dQw4w9WgXcQ', title: 'F' }); assert.equal(r.b.favs.length, 1);
  r = await j('POST', '/api/karaoke', { on: true }); assert.equal(r.b.state.karaoke, true);
  r = await j('POST', '/api/settings', { maxHeight: 480 }); assert.equal(r.b.state.settings.maxHeight, 480);
  // chưa có token -> chặn (khi gọi từ localhost vẫn được phép vì là cửa sổ của app)
  const noTok = await fetch(base + '/', {}); assert.equal(noTok.status, 200);
  const page = await fetch(base + '/static/app.js'); assert.equal(page.status, 200);
  const trav = await fetch(base + '/static/..%2f..%2fpackage.json'); assert.notEqual(trav.status, 200);
  const ui = await fetch(base + '/ui/dashboard.html'); assert.equal(ui.status, 200);
  // phát: không có cửa sổ phát -> bài vẫn ở RESOLVING
  assert.ok(['RESOLVING', 'ERROR'].includes(ctl.state));
  ctl.stop(); srv.close(); store.flush();
  await testPlayback(dir);
  console.log('Tất cả kiểm tra nền đều đạt');
  process.exit(0);
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
