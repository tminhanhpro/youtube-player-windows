'use strict';
// Giao diện "Nhạc Trong Máy": hộp thư viện, lọc không dấu, phát ngay / thêm hàng đợi, bỏ thư mục, kéo thả, hàng đợi hiện nốt nhạc.
const { chromium } = require('playwright');
const path = require('path'), assert = require('assert');
const SHOT = process.env.SHOT_DIR || '/tmp';

const MOCK = () => {
  const handlers = {}, calls = []; window.__calls = calls;
  const emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
  let folders = ['D:\\Nhạc cưới', 'E:\\Karaoke'];
  const items = [
    { path: 'D:\\Nhạc cưới\\01 Đón khách.mp3', name: '01 Đón khách', dir: 'Nhạc cưới', kind: 'audio', size: 4200000 },
    { path: 'D:\\Nhạc cưới\\02 Cắt bánh.mp3', name: '02 Cắt bánh', dir: 'Nhạc cưới', kind: 'audio', size: 3900000 },
    { path: 'E:\\Karaoke\\Phong cảnh.mp4', name: 'Phong cảnh', dir: 'Karaoke', kind: 'video', size: 250000000 },
    { path: 'C:\\Users\\a\\lẻ.m4a', name: 'Bài lẻ', dir: 'a', kind: 'audio', size: 900000, single: true }
  ];
  for (let i = 0; i < 400; i++) items.push({ path: 'E:\\Karaoke\\Bài ' + i + '.mp3', name: 'Bài số ' + i, dir: 'Karaoke', kind: 'audio', size: 3000000 });
  const snap = () => ({ state: 'PLAYING', nowPlaying: { itemId: 'i0', videoId: 'Lxxxxxxxxxx', title: '01 Đón khách', channel: 'Trong máy', local: true }, positionMs: 1000, durationMs: 200000, karaoke: false, netWait: false,
    queue: [{ itemId: 'i1', videoId: 'Lyyyyyyyyyy', title: '02 Cắt bánh', channel: 'Trong máy', durationSec: 0, addedBy: 'TV', local: true, thumbnailUrl: '' }, { itemId: 'i2', videoId: 'abcdefghijk', title: 'Bài YouTube', channel: 'K', durationSec: 100, addedBy: 'Lan' }] });
  const push = () => emit('state', { snap: snap(), info: { ip: '1.1.1.1', port: 8080, qr: null, host: '', remoteConnected: false, who: null, net: { text: 'Wi-Fi', icon: 'wifi' }, cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO' } }, ui: {} });
  window.__emit = emit;
  window.ytp = {
    on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; }, send: () => {},
    pathFor: f => 'D:\\Thả vào\\' + f.name,
    call: async (m, a) => {
      calls.push([m, a]);
      if (m === 'initial') return { cats: [], favs: [], search: { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null } };
      if (m === 'bannerInit') return { list: [], cur: null, colors: ['#ffffff'] };
      if (m === 'localList') return { folders, items };
      if (m === 'localRemove') { folders = folders.filter(f => f !== a[0]); return true; }
      if (m === 'localPickFolder') { folders.push('F:\\Mới'); return true; }
      if (m === 'localPickFiles') return 2;
      if (m === 'localAdd') return { played: 0, added: a[0].length, dup: 0, full: 0, bad: 0 };
      if (m === 'localPlayNow') return 0;
      if (m === 'localDrop') return { played: 1, added: 1, dup: 0, full: 0, bad: 0, found: 2, folders: 1, singles: 0 };
      return null;
    }
  };
  setTimeout(push, 50); setTimeout(push, 250); setTimeout(push, 600); // nhiều lần phòng khi script trang tải chậm hơn
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(MOCK);
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  await page.waitForTimeout(900);
  const called = m => page.evaluate(m => window.__calls.filter(c => c[0] === m), m);

  // hàng đợi: bài trong máy hiện nốt nhạc, bài YouTube vẫn có ảnh
  assert.equal(await page.locator('#qlist .q .lth').count(), 1); assert.equal(await page.locator('#qlist .q img').count(), 1);
  assert.ok((await page.locator('#qlist .q').first().textContent()).includes('Trong máy'));

  await page.click('#t-lib'); await page.waitForTimeout(400);
  assert.equal(await page.locator('.ldlg .lchip').count(), 2);
  assert.equal(await page.locator('.ldlg .lrow').count(), 300, 'chỉ vẽ 300 dòng đầu');
  assert.ok((await page.locator('.ldlg .bstat').textContent()).includes('404 bài'));
  assert.ok((await page.locator('.ldlg .bstat').textContent()).includes('hiện 300'));
  await page.screenshot({ path: SHOT + '/lib-dialog.png' });

  await page.fill('.ldlg .lfilter', 'don khach'); // không dấu vẫn tìm được "Đón khách"
  assert.equal(await page.locator('.ldlg .lrow').count(), 1);
  await page.click('.ldlg .lbtn.red'); await page.waitForTimeout(100);
  assert.deepEqual((await called('localPlayNow'))[0][1], ['D:\\Nhạc cưới\\01 Đón khách.mp3']);
  await page.fill('.ldlg .lfilter', 'karaoke'); assert.ok(await page.locator('.ldlg .lrow').count() > 100, 'lọc theo tên thư mục');
  await page.fill('.ldlg .lfilter', 'bai le'); assert.equal(await page.locator('.ldlg .lrow').count(), 1);
  assert.equal(await page.locator('.ldlg .lrow .lbtn[aria-label^="Bỏ file"]').count(), 1, 'file lẻ có nút bỏ');
  await page.fill('.ldlg .lfilter', 'canh'); // "Phong cảnh", "02 Cắt bánh" không khớp; chỉ Phong cảnh
  assert.equal(await page.locator('.ldlg .lrow').count(), 1);
  await page.fill('.ldlg .lfilter', '02'); await page.click('.ldlg .lrow .lbtn:not(.red)'); await page.waitForTimeout(100);
  assert.deepEqual((await called('localAdd'))[0][1], [['D:\\Nhạc cưới\\02 Cắt bánh.mp3'], false]);
  assert.ok((await page.locator('.ldlg .bstat').textContent()).includes('Đã thêm 1 bài'));
  await page.fill('.ldlg .lfilter', 'Nhạc cưới'); await page.click('text=/THÊM 2 BÀI ĐANG LỌC/'); await page.waitForTimeout(100);
  assert.equal((await called('localAdd'))[1][1][0].length, 2);
  await page.fill('.ldlg .lfilter', '');
  assert.ok((await page.locator('text=/THÊM TẤT CẢ VÀO HÀNG ĐỢI \\(200\\)/').count()) === 1, 'tối đa 200 bài một lần');
  // bỏ thư mục, thêm thư mục
  await page.locator('.ldlg .lchip button').first().click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('.ldlg .lchip').count(), 1);
  await page.click('text=+ Thêm thư mục…'); await page.waitForTimeout(200);
  assert.equal(await page.locator('.ldlg .lchip').count(), 2);
  await page.keyboard.press('m'); assert.equal((await called('setDuck')).length, 0, 'phím tắt không chạy khi hộp mở');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#modal').isHidden(), true);

  // kéo thả
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'Chào khách.mp3'));
    document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  assert.equal(await page.locator('#dropHint').isVisible(), true, 'hiện khung "Thả file vào đây"');
  await page.screenshot({ path: SHOT + '/lib-drophint.png' });
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'Chào khách.mp3'));
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); document.dispatchEvent(ev); return ev.defaultPrevented;
  });
  assert.ok(prevented, 'chặn hành vi mặc định (nếu không Electron sẽ mở file thay cho app)');
  await page.waitForTimeout(200);
  assert.deepEqual((await called('localDrop'))[0][1], [['D:\\Thả vào\\Chào khách.mp3']]);
  assert.ok((await page.locator('#toast').textContent()).includes('Đã thêm 2 bài từ máy'));
  assert.equal(await page.locator('#dropHint').isHidden(), true);

  console.log('lỗi JS:', errors.length ? errors.join('\n') : 'không');
  await browser.close();
  assert.equal(errors.length, 0);
  console.log('Nhạc Trong Máy: giao diện đạt');
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
