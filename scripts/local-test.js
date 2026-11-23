'use strict';
// Kiểm thử "Nhạc / video trong máy": thư viện + quét thư mục, hàng đợi/trạng thái với file thật, máy chủ file có Range,
// và phát thật một file WAV trong Chromium qua đúng đường mà app dùng (proxy -> trình phát).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { Store, Settings } = require('../main/store');
const { Controller, itemJson } = require('../main/controller');
const { StreamProxy } = require('../main/proxy');
const resolver = require('../main/resolver');
const L = require('../main/localfiles');

function wav(sec) {
  const sr = 8000, n = sr * sec, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-local-'));
  const mk = (rel, data) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data || wav(6)); return f; };
  const f1 = mk('Nhạc cưới/01_Đón_khách.wav'), f2 = mk('Nhạc cưới/10 Cắt bánh.WAV'), f3 = mk('Nhạc cưới/2 Mời rượu.wav'), f4 = mk('Nhạc cưới/Con/sâu.webm', Buffer.alloc(100));
  mk('Nhạc cưới/ghi chú.txt', 'x'); mk('Nhạc cưới/.ẩn/giấu.wav'); mk('Nhạc cưới/node_modules/x.wav'); mk('$RECYCLE.BIN/rác.wav');
  const single = mk('lẻ/Bài lẻ.mp4', Buffer.alloc(50));

  // --- định dạng, tên, mã ---
  assert.ok(L.isMedia('a.MP3') && L.isMedia('x.mkv') && !L.isMedia('a.wma') && !L.isMedia('a.avi') && !L.isMedia('a.txt') && !L.isMedia('noext'));
  assert.equal(L.kindOf('a.flac'), 'audio'); assert.equal(L.kindOf('a.mov'), 'video'); assert.equal(L.mimeOf('a.mp3'), 'audio/mpeg');
  assert.equal(L.titleOf('/x/01_Đón_khách__kỳ_diệu.wav'), '01 Đón khách kỳ diệu');
  assert.ok(/^[A-Za-z0-9_-]{11}$/.test(L.idFor(f1)) && L.idFor(f1)[0] === 'L' && L.idFor(f1) !== L.idFor(f2) && L.idFor(f1) === L.idFor(f1));

  // --- thư viện ---
  const mem = () => { const m = {}; return { get: (k, d) => (m[k] === undefined ? d : m[k]), set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };
  const lib = new L.LocalLibrary(mem());
  assert.equal(lib.addFolder('tuongdoi/khong'), false, 'đường dẫn tương đối bị từ chối');
  assert.equal(lib.addFolder(path.join(root, 'khong-co')), false);
  assert.equal(lib.addFolder(path.join(root, 'Nhạc cưới')), true); assert.equal(lib.addFolder(path.join(root, 'Nhạc cưới')), false, 'không thêm trùng');
  assert.equal(lib.addFiles([single, path.join(root, 'Nhạc cưới/ghi chú.txt'), 'rel.mp3', path.join(root, 'nope.mp3')]), 1, 'chỉ nhận file nhạc/video có thật');
  let items = await lib.list();
  assert.deepEqual(items.map(i => path.basename(i.path)), ['01_Đón_khách.wav', '2 Mời rượu.wav', '10 Cắt bánh.WAV', 'sâu.webm', 'Bài lẻ.mp4'], 'sắp xếp tự nhiên (2 trước 10), bỏ thư mục ẩn/node_modules, file lẻ ở cuối');
  assert.equal(items.find(i => i.path === single).single, true); assert.equal(items[0].kind, 'audio'); assert.equal(items[3].kind, 'video');
  assert.ok(lib.remove(single)); assert.equal((await lib.list()).length, 4);
  const dropped = await new L.LocalLibrary(mem()).resolveDropped([path.join(root, 'Nhạc cưới'), single, path.join(root, 'lẻ'), 'rel.mp3']);
  assert.equal(dropped.files.length, 5); assert.equal(dropped.folders, 2); assert.equal(dropped.singles, 1);

  // --- máy trạng thái với file thật ---
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-l2-'))), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  let resolves = 0; resolver.resolve = async () => { resolves++; throw new Error('local không được gọi yt-dlp'); };
  const cmds = []; ctl.on('player', c => cmds.push(c)); ctl.attachPlayer(true);
  assert.equal(ctl.addLocalFromTv(f1, false), 0, 'đang rảnh -> phát ngay');
  await sleep(30);
  let load = cmds.filter(c => c.type === 'load').pop();
  assert.equal(load.mode, 'stream'); assert.equal(load.src.local, f1); assert.equal(load.src.audioOnly, true); assert.equal(load.src.mime, 'audio/wav'); assert.equal(load.title, '01 Đón khách');
  ctl.playerEvent('started', load.key); assert.equal(ctl.state, 'PLAYING');
  assert.equal(ctl.addLocalFromTv(f2, false), 1); assert.equal(ctl.addLocalFromTv(f2, false), 2, 'trùng thì báo đã có'); assert.equal(ctl.addLocalFromTv(f3, true), 1);
  assert.deepEqual(ctl.queue.map(i => i.title), ['2 Mời rượu', '10 Cắt bánh'], 'ưu tiên lên đầu');
  const j = itemJson(ctl.queue[0]); assert.equal(j.local, true); assert.equal(j.thumbnailUrl, ''); assert.ok(!JSON.stringify(j).includes(root), 'không lộ đường dẫn ra điện thoại');
  await sleep(10); assert.equal(resolves, 0, 'không gọi yt-dlp cho file trong máy (kể cả tải trước)');
  // lưu / khôi phục hàng đợi
  const saved = store.get('queue', []); assert.equal(saved.length, 3); assert.equal(saved[0].localPath, f1);
  const ctl2 = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json')); ctl2.restore();
  assert.equal(ctl2.queue.length, 3); assert.equal(ctl2.queue[0].local, f1); assert.equal(ctl2.queue[2].title, '10 Cắt bánh');
  // phát ngay một bài đang trong hàng đợi / bài mới
  ctl.playLocalNow(f2); await sleep(30);
  load = cmds.filter(c => c.type === 'load').pop(); assert.equal(load.src.local, f2); assert.equal(ctl.queue.length, 1);
  // lỗi phát (codec lạ): báo lỗi ngay, KHÔNG thử lại, KHÔNG chuyển sang khung YouTube nhúng
  const loads0 = cmds.filter(c => c.type === 'load').length;
  ctl.playerEvent('error', load.key); await sleep(20);
  assert.equal(ctl.state, 'ERROR'); assert.ok(ctl.errDetail.includes('không phát được'), ctl.errDetail);
  assert.equal(cmds.filter(c => c.type === 'load' && c.mode === 'iframe').length, 0); assert.equal(cmds.filter(c => c.type === 'load').length, loads0);
  await sleep(1700); load = cmds.filter(c => c.type === 'load').pop(); assert.equal(load.src.local, f3, 'tự sang bài kế');
  // file bị xoá / ổ rút
  ctl.playerEvent('started', load.key); ctl.addLocalFromTv(path.join(root, 'Nhạc cưới/biến mất.wav'), false);
  fs.unlinkSync(f3); ctl.playerEvent('ended', load.key); await sleep(40);
  assert.equal(ctl.state, 'ERROR'); assert.ok(ctl.errDetail.includes('Không mở được file'), ctl.errDetail); assert.equal(ctl.errCode, 'UNAVAILABLE');
  ctl.stop(); ctl2.stop();

  // --- máy chủ file (Range) + proxy.rewrite ---
  const proxy = new StreamProxy(() => 'http://127.0.0.1:' + port);
  const srv = http.createServer((req, res) => proxy.route(req, res, new URL(req.url, 'http://x')));
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
  const rw = proxy.rewrite({ type: 'load', mode: 'stream', key: 'k', title: 'T', src: { local: f1, mime: 'audio/wav', audioOnly: true } });
  assert.ok(/\/internal\/f\//.test(rw.src.video.url) && rw.src.audioOnly === true && rw.src.audio === null && rw.src.local === undefined);
  assert.equal(proxy.rewrite({ type: 'load', mode: 'stream', key: 'k', src: { local: path.join(root, 'x.txt') } }).type, 'stop', 'không phục vụ file không phải nhạc/video');
  const data = fs.readFileSync(f1), get = (u, h) => fetch(u, { headers: h || {} });
  let r = await get(rw.src.video.url); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/wav'); assert.equal(r.headers.get('accept-ranges'), 'bytes'); assert.ok(Buffer.from(await r.arrayBuffer()).equals(data));
  r = await get(rw.src.video.url, { range: 'bytes=100-199' }); assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 100-199/' + data.length); assert.ok(Buffer.from(await r.arrayBuffer()).equals(data.subarray(100, 200)));
  r = await get(rw.src.video.url, { range: 'bytes=' + (data.length - 10) + '-' }); assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 10);
  r = await get(rw.src.video.url, { range: 'bytes=-20' }); assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 20);
  r = await get(rw.src.video.url, { range: 'bytes=99999999-' }); assert.equal(r.status, 416);
  r = await get('http://127.0.0.1:' + port + '/internal/f/khongco'); assert.equal(r.status, 404);
  fs.unlinkSync(f1); r = await get(rw.src.video.url); assert.equal(r.status, 404, 'file đã xoá');
  fs.writeFileSync(f1, wav(6));

  // --- phát thật trong Chromium: tv.html + player.js + file qua proxy ---
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { window.ytp = { call: async () => null, on() {}, send() {} }; });
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'tv.html'));
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;inset:0;z-index:99'; document.body.appendChild(box);
    window.__ev = []; window.__p = window.createPlayer(box, (k, key, a) => window.__ev.push([k, a])); window.__box = box; window.__v = box.querySelector('video');
  });
  const cmd = proxy.rewrite({ type: 'load', mode: 'stream', key: 'k1', title: 'Đón khách (thử)', src: { local: f1, mime: 'audio/wav', audioOnly: true }, startMs: 0, volume: 100, gain: 1, fadeInMs: 0 });
  await page.evaluate(c => window.__p.command(c), cmd);
  await page.waitForFunction(() => window.__ev.some(e => e[0] === 'started'), null, { timeout: 8000 });
  const cover = await page.evaluate(() => { const d = [...window.__box.children].find(x => x.textContent.includes('Đón khách')); return d && getComputedStyle(d).display; });
  assert.equal(cover, 'flex', 'nhạc không hình thì hiện nền nốt nhạc + tên bài');
  await page.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/lib-audio-cover.png' });
  await page.evaluate(() => window.__p.command({ type: 'seek', ms: 3000 })); await page.waitForTimeout(600);
  const t = await page.evaluate(() => window.__v.currentTime); assert.ok(t >= 2.9 && t < 4.5, 'tua qua Range hoạt động, thấy ' + t);
  await page.evaluate(() => window.__p.command({ type: 'seek', ms: 5800 }));
  await page.waitForFunction(() => window.__ev.some(e => e[0] === 'ended'), null, { timeout: 5000 });
  await page.evaluate(() => window.__p.command({ type: 'stop' }));
  const hidden = await page.evaluate(() => [...window.__box.children].filter(x => x.textContent.includes('Đón khách')).every(d => getComputedStyle(d).display === 'none'));
  assert.ok(hidden, 'dừng phát thì ẩn nền nốt nhạc');
  await browser.close(); srv.close();
  assert.equal(errors.length, 0, errors.join('\n'));
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Nhạc/video trong máy: thư viện + hàng đợi + máy chủ file + phát thật đều đạt');
  process.exit(0);
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
