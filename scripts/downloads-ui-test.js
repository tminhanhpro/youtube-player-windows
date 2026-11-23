'use strict';
// Giao diện "Tải Sẵn Về Máy": hộp thoại, phạm vi x/y, bắt đầu/huỷ, tiến độ đẩy từ tiến trình chính, kiểu tải, cảnh báo thiếu ffmpeg, thư mục.
const { chromium } = require('playwright');
const path = require('path'), assert = require('assert');
const SHOT = process.env.SHOT_DIR || '/tmp';

const MOCK = () => {
  const handlers = {}, calls = []; window.__calls = calls;
  const emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
  const S = { dir: 'C:\\Users\\a\\Music\\Youtube Player', defaultDir: 'C:\\Users\\a\\Music\\Youtube Player', custom: false, count: 3, mode: 'video', ffmpeg: false, lite: true,
    scopes: { favs: { done: 1, total: 4 }, queue: { done: 2, total: 2 }, decks: [{ id: 'd1', name: 'Đám cưới 30/12', done: 0, total: 6 }, { id: 'd2', name: 'Sinh nhật', done: 5, total: 5 }] },
    jobs: [{ id: 'aaaaaaaaaaa', title: 'Bài đang tải rất dài rất dài rất dài rất dài rất dài rất dài rất dài rất dài', status: 'downloading', percent: 42.5, speed: 2400000, eta: 75, bytes: 4000000, total: 9000000, error: '', file: null, attempt: 0, lite: true, mode: 'video' },
      { id: 'bbbbbbbbbbb', title: 'Bài chờ', status: 'queued', percent: 0, speed: 0, eta: null, bytes: 0, total: 0, error: '', file: null, attempt: 0, lite: true, mode: 'video' },
      { id: 'ccccccccccc', title: 'Bài lỗi', status: 'error', percent: 10, speed: 0, eta: null, bytes: 0, total: 0, error: 'Video không khả dụng', file: null, attempt: 1, lite: true, mode: 'video' }] };
  const info = () => ({ dir: S.dir, defaultDir: S.defaultDir, custom: S.custom, count: S.count, scopes: S.scopes });
  const snap = () => ({ state: 'IDLE', nowPlaying: null, positionMs: 0, durationMs: 0, karaoke: false, netWait: false, queue: [] });
  const push = () => emit('state', { snap: snap(), info: { ip: '1.1.1.1', port: 8080, qr: null, host: '', remoteConnected: false, who: null, net: { text: 'Wi-Fi', icon: 'wifi' }, cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO' } }, ui: {} });
  window.__emit = emit; window.__S = S; window.__info = info;
  window.ytp = {
    on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => { handlers[ch] = (handlers[ch] || []).filter(h => h !== cb); }; }, send: () => {},
    pathFor: f => 'D:\\Thả vào\\' + f.name,
    call: async (m, a) => {
      calls.push([m, a]);
      if (m === 'initial') return { cats: [], favs: [], search: { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null } };
      if (m === 'bannerInit') return { list: [], cur: null, colors: ['#ffffff'] };
      if (m === 'sfxList') return [];
      if (m === 'dlState') return JSON.parse(JSON.stringify({ ...S, counts: {}, running: true }));
      if (m === 'dlStart') return a[0].type === 'deck' ? { total: 6, added: 6, have: 0, queued: 0, bad: 0 } : { total: 4, added: 3, have: 1, queued: 0, bad: 0 };
      if (m === 'dlSetMode') { S.mode = a[0]; return true; }
      if (m === 'dlPickDir') { S.dir = 'D:\\Nhạc tải'; S.custom = true; emit('dl-library', info()); return true; }
      if (m === 'dlResetDir') { S.dir = S.defaultDir; S.custom = false; emit('dl-library', info()); return true; }
      if (m === 'dlRescan') return 7;
      if (m === 'dlOpenFolder') return true;
      return null;
    }
  };
  setTimeout(push, 50); setTimeout(push, 250); setTimeout(push, 600);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(MOCK);
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  await page.waitForTimeout(900);
  const called = m => page.evaluate(m => window.__calls.filter(c => c[0] === m), m);
  const txt = s => page.locator(s).first().textContent();

  assert.equal(await page.locator('#dlBtn').isVisible(), true, 'nút có ở cột trái');
  assert.ok((await txt('#dlBtn')).includes('Tải Sẵn Về Máy'));
  const box = await page.locator('#dlBtn').boundingBox(); assert.ok(box.y + box.height < 1080, 'nút nằm trong màn hình 1080');

  await page.click('#dlBtn'); await page.waitForTimeout(300);
  assert.equal(await page.locator('.ddlg').count(), 1);
  assert.ok((await txt('.dlpath')).includes('Youtube Player'));
  assert.equal(await page.locator('.dlrow').count(), 4, 'Yêu thích + hàng đợi + 2 bộ bài');
  const rowText = i => page.locator('.dlrow').nth(i).textContent();
  assert.ok((await rowText(0)).includes('đã tải 1/4') && (await rowText(0)).includes('Tải phần còn thiếu'));
  assert.ok((await rowText(1)).includes('đã tải 2/2') && (await rowText(1)).includes('Đã đủ'));
  assert.equal(await page.locator('.dlrow').nth(1).locator('.lbtn').isDisabled(), true, 'đủ rồi thì không bấm tải nữa');
  assert.ok((await rowText(2)).includes('Bộ bài: Đám cưới 30/12') && (await rowText(2)).includes('Tải về'));
  assert.equal(await page.locator('.dlrow').nth(3).locator('.dlcnt.full').count(), 1);
  // cảnh báo thiếu ffmpeg khi kiểu hình + tiếng
  assert.equal(await page.locator('.dlwarn').isVisible(), true); assert.ok((await txt('.dlwarn')).includes('ffmpeg'));
  assert.equal(await page.locator('.dlmode .dbtn.on').getAttribute('data-m'), 'video');
  // tiến độ
  assert.equal(await page.locator('.djrow').count(), 3);
  assert.ok((await txt('.djrow.downloading .djst')).includes('Đang tải') && (await txt('.djrow.downloading .djst')).includes('2.3 MB/s'));
  assert.equal(await page.locator('.djrow.downloading .djbar i').evaluate(e => e.style.width), '42.5%');
  assert.ok((await txt('.djrow.error .djst')).includes('Video không khả dụng'));
  await page.screenshot({ path: SHOT + '/dl-dialog.png' });

  // bắt đầu tải một bộ bài
  await page.locator('.dlrow').nth(2).locator('.lbtn').click(); await page.waitForTimeout(100);
  assert.deepEqual((await called('dlStart'))[0][1], [{ type: 'deck', id: 'd1' }]);
  assert.ok((await txt('.bstat')).includes('đã thêm 6 bài vào hàng tải'));
  await page.locator('.dlrow').nth(0).locator('.lbtn').click(); await page.waitForTimeout(100);
  assert.deepEqual((await called('dlStart'))[1][1], [{ type: 'favs' }]);
  assert.ok((await txt('.bstat')).includes('1 bài đã có sẵn'));

  // tiến độ đẩy từ tiến trình chính: cập nhật tại chỗ, không nhân đôi dòng
  await page.evaluate(() => window.__emit('dl-update', { id: 'aaaaaaaaaaa', title: 'Bài A', status: 'downloading', percent: 80, speed: 500000, eta: 10, bytes: 7000000, total: 9000000, error: '', file: null, attempt: 1, lite: true, mode: 'video' }));
  assert.equal(await page.locator('.djrow').count(), 3);
  assert.equal(await page.locator('.djrow[data-id="aaaaaaaaaaa"] .djbar i').evaluate(e => e.style.width), '80%');
  assert.ok((await txt('.djrow[data-id="aaaaaaaaaaa"] .djst')).includes('Thử lại lần 2'));
  await page.evaluate(() => window.__emit('dl-update', { id: 'ddddddddddd', title: 'Bài mới', status: 'queued', percent: 0, speed: 0, eta: null, bytes: 0, total: 0, error: '', file: null, attempt: 0, lite: true, mode: 'video' }));
  assert.equal(await page.locator('.djrow').count(), 4);
  await page.evaluate(() => window.__emit('dl-update', { id: 'aaaaaaaaaaa', title: 'Bài A', status: 'done', percent: 100, speed: 0, eta: null, bytes: 9000000, total: 9000000, error: '', file: 'x.mp4', attempt: 0, lite: true, mode: 'video' }));
  assert.ok((await txt('.djrow[data-id="aaaaaaaaaaa"] .djst')).includes('Đã tải xong') && (await txt('.djrow[data-id="aaaaaaaaaaa"] .djst')).includes('chất lượng thấp'));
  // thư viện đổi (tải xong một bài) -> x/y cập nhật
  await page.evaluate(() => { window.__S.scopes.favs.done = 2; window.__S.count = 4; window.__emit('dl-library', window.__info()); });
  assert.ok((await rowText(0)).includes('đã tải 2/4'));
  // huỷ / xoá dòng
  await page.locator('.djrow[data-id="bbbbbbbbbbb"] button').click(); await page.waitForTimeout(80);
  assert.deepEqual((await called('dlCancel'))[0][1], ['bbbbbbbbbbb']);
  await page.locator('.djrow[data-id="ccccccccccc"] button').click(); await page.waitForTimeout(80);
  assert.deepEqual((await called('dlClear'))[0][1], ['ccccccccccc']);
  await page.evaluate(() => window.__emit('dl-removed', 'ccccccccccc'));
  assert.equal(await page.locator('.djrow[data-id="ccccccccccc"]').count(), 0);
  await page.click('[data-r="cancelAll"]'); assert.equal((await called('dlCancelAll')).length, 1);
  await page.click('[data-r="clearDone"]'); assert.equal((await called('dlClearFinished')).length, 1);

  // kiểu tải: chỉ tiếng -> hết cảnh báo ffmpeg
  await page.click('[data-m="audio"]'); await page.waitForTimeout(100);
  assert.deepEqual((await called('dlSetMode'))[0][1], ['audio']);
  assert.equal(await page.locator('.dlwarn').isHidden(), true);
  assert.equal(await page.locator('.dlmode .dbtn.on').getAttribute('data-m'), 'audio');
  await page.click('[data-m="video"]'); assert.equal(await page.locator('.dlwarn').isVisible(), true);

  // thư mục
  assert.equal(await page.locator('[data-r="reset"]').isHidden(), true, 'đang dùng mặc định thì ẩn nút Mặc định');
  await page.click('[data-r="pick"]'); await page.waitForTimeout(150);
  assert.ok((await txt('.dlpath')).includes('Nhạc tải')); assert.equal(await page.locator('[data-r="reset"]').isVisible(), true);
  await page.click('[data-r="reset"]'); await page.waitForTimeout(150);
  assert.ok((await txt('.dlpath')).includes('Youtube Player'));
  await page.click('[data-r="scan"]'); await page.waitForTimeout(100); assert.ok((await txt('.bstat')).includes('7 bài'));
  await page.click('[data-r="open"]'); assert.equal((await called('dlOpenFolder')).length, 1);

  // phím tắt không chạy khi hộp mở; kéo thả bị chặn có báo
  await page.keyboard.press('m'); assert.equal((await called('setDuck')).length, 0);
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.mp3')); document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(150);
  assert.equal((await called('localDrop')).length, 0, 'đang mở hộp tải thì file thả vào không vào hàng đợi');
  assert.ok((await txt('#toast')).includes('Tải Sẵn Về Máy'));

  // đóng: không còn nghe sự kiện, mở lại vẫn đúng
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#modal').isHidden(), true);
  await page.evaluate(() => window.__emit('dl-update', { id: 'zzzzzzzzzzz', title: 'Z', status: 'queued', percent: 0 }));
  await page.click('#dlBtn'); await page.waitForTimeout(300);
  assert.equal(await page.locator('.djrow[data-id="zzzzzzzzzzz"]').count(), 0, 'sự kiện sau khi đóng không làm hỏng hộp mở lại');
  assert.equal(await page.locator('.dlrow').count(), 4);
  await page.click('.ddlg .dbtns .dbtn'); assert.equal(await page.locator('#modal').isHidden(), true);

  console.log('lỗi JS:', errors.length ? errors.join('\n') : 'không');
  await browser.close();
  assert.equal(errors.length, 0);
  console.log('Tải Sẵn Về Máy: giao diện đạt');
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
