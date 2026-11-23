'use strict';
// Mở dashboard.html và tv.html trong Chromium với main-process giả: soạn chữ, lưu mẫu, hiện/ẩn, phím W, cửa sổ TV.
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const SHOT = process.env.SHOT_DIR || '/tmp';

const MOCK = () => {
  const handlers = {}; const calls = [];
  window.__calls = calls;
  let list = [{ text: 'Chúc mừng đám cưới\nLan & Minh', color: '#ffd54f', size: 4, pos: 'center', hideSec: 0 }, { text: 'Happy Birthday', color: '#ff80ab', size: 4, pos: 'center', hideSec: 0 }];
  let cur = null, seq = 0;
  const emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
  const snap = () => ({ state: 'PLAYING', nowPlaying: { itemId: 'i0', videoId: 'vid00000000', title: 'Bài đang phát', channel: 'Kênh' }, positionMs: 65000, durationMs: 200000, karaoke: false, netWait: false, queue: [] });
  const push = () => emit('state', { snap: snap(), info: { ip: '192.168.1.5', port: 8080, qr: null, host: '', remoteConnected: true, who: null, net: { text: 'Wi-Fi', icon: 'wifi' }, cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO' } }, ui: {} });
  window.__emit = emit;
  window.ytp = {
    on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; },
    send: () => {},
    call: async (m, a) => {
      calls.push([m, a]);
      if (m === 'initial') return { cats: [], favs: [], search: { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null } };
      if (m === 'bannerInit') return { list, cur, colors: ['#ffffff', '#ffd54f', '#ff80ab', '#ff5252', '#69f0ae', '#40c4ff', '#b388ff', '#ffab40'] };
      if (m === 'bannerSave') { list = a[0].filter(t => t.text.trim()); return list; }
      if (m === 'bannerShow') { if (!String(a[0].text).trim()) return null; cur = { ...a[0], seq: ++seq }; emit('banner', cur); return cur; }
      if (m === 'bannerHide') { const had = !!cur; cur = null; emit('banner', null); return had; }
      return null;
    }
  };
  setTimeout(push, 50); setTimeout(push, 250); setTimeout(push, 600); // nhiều lần phòng khi script trang tải chậm hơn
};
const TV_MOCK = () => {
  const handlers = {};
  window.__emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
  window.ytp = { on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; }, send: () => {}, call: async () => null };
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(MOCK);
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  await page.waitForTimeout(900);
  const called = m => page.evaluate(m => window.__calls.filter(c => c[0] === m), m);

  // nút ở cột trái + phím W khi chưa có gì hiện: hiện lại mẫu đầu tiên
  assert.equal(await page.locator('#bnrBtn').count(), 1);
  await page.keyboard.press('w'); await page.waitForTimeout(900);
  assert.equal((await called('bannerShow')).length, 1, 'W hiện mẫu gần nhất');
  assert.ok(await page.locator('#vbox .wb.on').count() === 1, 'chữ hiện trong khung phát');
  assert.ok((await page.locator('#bnrLbl').textContent()).includes('Đang hiện'));
  await page.screenshot({ path: SHOT + '/bnr-dash-live.png' });
  await page.keyboard.press('w'); await page.waitForTimeout(900);
  assert.equal(await page.locator('#vbox .wb.on').count(), 0, 'W lần nữa thì ẩn');
  assert.equal(await page.locator('#vbox .wb:not([hidden])').count(), 0);

  // hộp soạn chữ
  await page.click('#bnrBtn'); await page.waitForTimeout(500);
  assert.equal(await page.locator('.bdlg .bitem').count(), 2);
  assert.equal(await page.locator('.bdlg textarea').inputValue(), 'Chúc mừng đám cưới\nLan & Minh');
  assert.ok(await page.locator('.bdlg .bprev .wb.on').count() === 1, 'có xem trước');
  await page.keyboard.press('m'); // gõ phím tắt khi hộp mở phải không kích hoạt MC; chữ vào ô nhập
  assert.equal((await called('setDuck')).length, 0);
  await page.fill('.bdlg textarea', 'Mừng thôi nôi bé An');
  await page.click('.bdlg .sw:nth-child(6)');           // xanh dương
  await page.click('.bdlg [data-r="sizes"] .opt:nth-child(5)'); // cực lớn
  await page.click('.bdlg [data-r="pos"] .opt:nth-child(3)');    // dưới
  await page.click('.bdlg [data-r="hide"] .opt:nth-child(2)');   // 10 giây
  await page.waitForTimeout(700);
  await page.screenshot({ path: SHOT + '/bnr-dialog.png' });
  await page.click('text=LƯU MẪU'); await page.waitForTimeout(200);
  assert.equal((await called('bannerSave')).length, 1);
  let saved = (await called('bannerSave'))[0][1][0];
  assert.equal(saved[0].text, 'Mừng thôi nôi bé An'); assert.equal(saved[0].color, '#40c4ff'); assert.equal(saved[0].size, 5); assert.equal(saved[0].pos, 'bottom'); assert.equal(saved[0].hideSec, 10);
  assert.equal(await page.locator('.bdlg .bitem').count(), 2, 'lưu đè mẫu đang chọn, không thêm mới');
  await page.click('text=+ Mẫu mới'); await page.fill('.bdlg textarea', 'Kính chào quý khách'); await page.click('text=LƯU MẪU'); await page.waitForTimeout(200);
  assert.equal(await page.locator('.bdlg .bitem').count(), 3, 'mẫu mới được thêm');
  await page.fill('.bdlg textarea', 'a\nb\nc\nd\ne'); assert.equal((await page.locator('.bdlg textarea').inputValue()).split('\n').length, 3, 'tối đa 3 dòng');
  await page.fill('.bdlg textarea', 'Chúc mừng đám cưới');
  await page.click('text=HIỆN LÊN MÀN HÌNH'); await page.waitForTimeout(900);
  assert.equal((await called('bannerShow')).length, 2);
  assert.ok((await page.locator('.bstat').textContent()).includes('ĐANG HIỆN'));
  assert.equal(await page.getByRole('button', { name: 'ẨN CHỮ' }).isDisabled(), false);
  await page.getByRole('button', { name: 'ẨN CHỮ' }).click(); await page.waitForTimeout(300);
  assert.ok((await page.locator('.bstat').textContent()).includes('Chưa hiện'));
  // xoá mẫu: 2 lần bấm
  await page.locator('.bdlg .bitem').nth(1).click();
  await page.click('text=XOÁ MẪU'); assert.equal(await page.locator('.bdlg .bitem').count(), 3, 'bấm lần đầu chỉ xin xác nhận');
  await page.click('text=BẤM LẠI ĐỂ XOÁ'); await page.waitForTimeout(200);
  assert.equal(await page.locator('.bdlg .bitem').count(), 2);
  // hiện rỗng bị từ chối, Esc đóng hộp
  await page.click('text=+ Mẫu mới'); await page.click('text=HIỆN LÊN MÀN HÌNH'); await page.waitForTimeout(200);
  assert.equal(await page.locator('#toast').isHidden(), false, 'có toast nhắc gõ chữ (sau hộp thoại)');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#modal').isHidden(), true);

  // cửa sổ TV
  const tv = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  tv.on('pageerror', e => errors.push('TV ' + e));
  await tv.addInitScript(TV_MOCK);
  await tv.goto('file://' + path.join(__dirname, '..', 'renderer', 'tv.html'));
  await tv.evaluate(() => window.__emit('banner', { text: 'Chúc mừng đám cưới\nLan & Minh', color: '#ffd54f', size: 4, pos: 'center', hideSec: 0, seq: 1 }));
  await tv.waitForTimeout(900);
  assert.equal(await tv.locator('#fx .wb.on').count(), 1);
  await tv.screenshot({ path: SHOT + '/bnr-tv-center.png' });
  const fs = await tv.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.wb-band')).fontSize));
  assert.ok(fs > 125 && fs < 145, 'cỡ chữ theo chiều cao màn hình: ' + fs);
  await tv.evaluate(() => window.__emit('banner', { text: 'Kính chào quý khách đến dự lễ thành hôn của chúng tôi, xin trân trọng cảm ơn sự hiện diện của mọi người', color: '#ffffff', size: 5, pos: 'bottom', hideSec: 0, seq: 2 }));
  await tv.waitForTimeout(900);
  const h = await tv.evaluate(() => document.querySelector('.wb-band').offsetHeight);
  assert.ok(h <= 1080 * 0.7 + 2, 'chữ dài tự thu nhỏ cho vừa khung: ' + h);
  await tv.screenshot({ path: SHOT + '/bnr-tv-bottom-long.png' });
  await tv.evaluate(() => window.__emit('banner', null)); await tv.waitForTimeout(900);
  assert.equal(await tv.locator('#fx .wb:not([hidden])').count(), 0);
  await tv.setViewportSize({ width: 1280, height: 720 });
  await tv.evaluate(() => window.__emit('banner', { text: 'Happy Birthday', color: '#ff80ab', size: 3, pos: 'top', hideSec: 0, seq: 3 })); await tv.waitForTimeout(800);
  await tv.screenshot({ path: SHOT + '/bnr-tv-top-720.png' });

  console.log('lỗi JS:', errors.length ? errors.join('\n') : 'không');
  await browser.close();
  assert.equal(errors.length, 0);
  console.log('Chữ chào mừng: giao diện đạt');
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
