'use strict';
// Bước 4: điện thoại remote. Chạy server thật + trang web remote thật trong Chromium:
// danh sách hiệu ứng, bấm để phát (đến đúng id), dừng hết, chống bấm dồn, file mất, danh sách trống.
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const { chromium } = require('playwright');
const { Store, Settings } = require('../main/store');
const { Controller } = require('../main/controller');
const { KaraokeServer } = require('../main/server');
const { Soundboard } = require('../main/sfx');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfxr-'));
  const store = new Store(dir), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  const srv = new KaraokeServer({ ctl, settings, store, webDir: path.join(__dirname, '..', 'web'), uiDir: path.join(__dirname, '..', 'renderer') });
  const port = await srv.listen(); ctl.start();
  const base = 'http://127.0.0.1:' + port;
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + settings.token, 'x-device': 'Test' };
  const j = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };

  const played = [], stops = [];
  ctl.on('sfx', id => played.push(id)); ctl.on('sfx-stop', () => stops.push(1));

  // chưa có hiệu ứng nào
  let r = await j('GET', '/api/sfx'); assert.equal(r.s, 200); assert.deepEqual(r.b.items, []);

  // thêm 3 hiệu ứng trên "máy tính"
  const mk = n => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return p; };
  const board = new Soundboard(store);
  const add = board.addFiles([mk('vo_tay.mp3'), mk('reo_ho.wav'), mk('moi_co_dau_chu_re_len_san_khau.mp3')]).added;
  board.update(add[0].id, { name: 'Vỗ tay', icon: '👏', vol: 80 });

  // API: danh sách không lộ đường dẫn file
  r = await j('GET', '/api/sfx'); assert.equal(r.b.items.length, 3);
  assert.deepEqual(Object.keys(r.b.items[0]).sort(), ['icon', 'id', 'missing', 'name', 'vol']);
  assert.ok(!JSON.stringify(r.b).includes(dir.replace(/\\/g, '\\\\')) && !JSON.stringify(r.b).includes('vo_tay.mp3'), 'không lộ đường dẫn');
  // phát: đúng id; id lạ / thiếu -> 404; GET/POST sai đường -> 404
  r = await j('POST', '/api/sfx/play', { id: add[0].id }); assert.equal(r.s, 200); assert.equal(r.b.ok, true); assert.deepEqual(played, [add[0].id]);
  r = await j('POST', '/api/sfx/play', { id: 'sKHONGCO123' }); assert.equal(r.s, 404); assert.equal(r.b.error.code, 'SFX_MISSING');
  r = await j('POST', '/api/sfx/play', {}); assert.equal(r.s, 404);
  r = await j('POST', '/api/sfx/xyz', {}); assert.equal(r.s, 404);
  r = await j('POST', '/api/sfx/stop', {}); assert.equal(r.s, 200); assert.equal(stops.length, 1);
  // cần token như các API khác
  const noTok = await fetch('http://127.0.0.1:' + port + '/api/sfx', { headers: { 'x-forwarded-for': '1.2.3.4' } }); assert.ok([200, 403].includes(noTok.status));
  // chống bấm dồn: 10/giây
  await new Promise(res => setTimeout(res, 1100)); // cho cửa sổ 1 giây của các lần bấm trước trôi hết
  played.length = 0; let dropped = 0;
  for (let i = 0; i < 15; i++) { const x = await j('POST', '/api/sfx/play', { id: add[1].id }); if (x.b.dropped) dropped++; }
  assert.equal(played.length, 10); assert.equal(dropped, 5);
  await new Promise(res => setTimeout(res, 1100));
  r = await j('POST', '/api/sfx/play', { id: add[1].id }); assert.equal(r.b.dropped, false, 'qua 1 giây thì phát lại được');

  // giao diện điện thoại thật
  const browser = await chromium.launch(), errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push(String(e)));
  await page.setExtraHTTPHeaders({ authorization: 'Bearer ' + settings.token });
  await page.goto(base + '/'); await page.waitForTimeout(800);
  played.length = 0;
  await page.click('#b-react'); await page.waitForTimeout(500);
  assert.equal(await page.locator('#r-sfxbox').isVisible(), true, 'có hiệu ứng thì hiện khung');
  assert.equal(await page.locator('.sfxbtn').count(), 3);
  assert.ok((await page.textContent('#r-sfx-title')).length > 3 && /Dừng hết|Stop all/.test(await page.textContent('#r-sfx-stop')))   // trình duyệt thử mặc định là tiếng Anh;
  assert.equal(await page.textContent('.sfxbtn >> nth=0'), '👏Vỗ tay');
  assert.ok(await page.locator('#r-grid .rbtn').count() > 30, 'bộ sưu tập cũ vẫn còn đủ');
  await page.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/sfx-phone.png' });
  // bấm nút 2 -> máy tính nhận đúng id
  await page.click('.sfxbtn >> nth=1'); await page.waitForTimeout(300);
  assert.deepEqual(played, [add[1].id]);
  // bấm dừng hết
  stops.length = 0; await page.click('#r-sfx-stop'); await page.waitForTimeout(300);
  assert.equal(stops.length, 1);
  // bộ sưu tập cũ vẫn gửi được
  await page.click('#r-grid .rbtn >> nth=0'); await page.waitForTimeout(200);
  // file bị xoá trên máy tính: bấm -> báo + danh sách tự làm mới (nút bị mờ)
  fs.unlinkSync(path.join(dir, 'reo_ho.wav'));
  await page.click('.sfxbtn >> nth=1'); await page.waitForTimeout(500);
  assert.ok(await page.locator('.sfxbtn.off').count() === 1, 'nút của file mất bị mờ sau khi làm mới');
  assert.ok(await page.locator('.sfxbtn.off').isDisabled());
  // đóng, đổi tên trên máy tính, mở lại: thấy tên mới
  await page.click('#r-close'); board.update(add[2].id, { name: 'Mời cô dâu chú rể' }); board.remove(add[0].id);
  await page.click('#b-react'); await page.waitForTimeout(500);
  assert.equal(await page.locator('.sfxbtn').count(), 2); assert.ok((await page.textContent('#r-sfx')).includes('Mời cô dâu chú rể'));
  await page.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/sfx-phone2.png' });
  // xoá hết: khung ẩn, bộ sưu tập cũ vẫn dùng được
  board.remove(add[1].id); board.remove(add[2].id);
  await page.click('#r-close'); await page.click('#b-react'); await page.waitForTimeout(500);
  assert.equal(await page.locator('#r-sfxbox').isVisible(), false, 'không có hiệu ứng thì ẩn khung');
  assert.ok(await page.locator('#r-grid .rbtn').first().isVisible());
  await browser.close(); srv.close();
  assert.deepEqual(errors, [], errors.join(' | '));
  console.log('sfx-remote-test: OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
