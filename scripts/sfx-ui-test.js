'use strict';
// Mở dashboard.html trong Chromium với main-process giả: cửa sổ quản lý hiệu ứng âm thanh (thêm, kéo thả file, đổi tên, biểu tượng,
// âm lượng, nghe thử, xoá 2 bước, sắp xếp bằng nút và kéo thả, dừng hết, file mất).
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const SHOT = process.env.SHOT_DIR || '/tmp';

const MOCK = () => {
  const handlers = {}; const calls = [];
  window.__calls = calls;
  const emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
  let n = 0;
  let list = [
    { id: 'sAAAA1', name: 'Vỗ tay', icon: '👏', file: 'C:\\sfx\\vo_tay.mp3', vol: 100 },
    { id: 'sBBBB2', name: 'Reo hò', icon: '🎉', file: 'C:\\sfx\\reo_ho.mp3', vol: 70 },
    { id: 'sCCCC3', name: 'Mời cô dâu chú rể', icon: '🔊', file: 'C:\\sfx\\moi.mp3', vol: 55, missing: true },
    { id: 'sDDDD4', name: 'Trống', icon: '🥁', file: 'C:\\sfx\\trong.mp3', vol: 90 }
  ];
  const copy = () => list.map(x => ({ ...x }));
  const push = () => emit('sfx-list', copy());
  const snap = () => ({ state: 'PLAYING', nowPlaying: { itemId: 'i0', videoId: 'vid00000000', title: 'Bài đang phát', channel: 'Kênh' }, positionMs: 65000, durationMs: 200000, karaoke: false, netWait: false, queue: [] });
  const state = () => emit('state', { snap: snap(), info: { ip: '192.168.1.5', port: 8080, qr: null, host: '', remoteConnected: true, who: null, net: { text: 'Wi-Fi', icon: 'wifi' }, cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO' } }, ui: {} });
  window.__emit = emit; window.__duck = false;
  window.__list = () => copy();
  window.__setPaths = p => { window.__paths = p; };
  window.ytp = {
    on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; },
    send: () => {},
    pathFor: f => f.name ? 'C:\\drop\\' + f.name : '',
    call: async (m, a) => {
      calls.push([m, a]);
      if (m === 'initial') return { cats: [], favs: [], search: { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null } };
      if (m === 'bannerInit') return { list: [], cur: null, colors: [] };
      if (m === 'sfxList') return copy();
      if (m === 'sfxPickFiles') { list.push({ id: 'sNEW' + (++n) + 'xx', name: 'Mới', icon: '🔊', file: 'C:\\sfx\\moi' + n + '.mp3', vol: 100 }); push(); return { added: [{}], skipped: 1, full: false }; }
      if (m === 'sfxAdd') { list.push({ id: 'sDRP' + (++n) + 'xx', name: 'Thả vào', icon: '🔊', file: a[0][0], vol: 100 }); push(); return { added: [{}], skipped: a[0].length - 1, full: false }; }
      if (m === 'sfxUpdate') { const i = list.findIndex(x => x.id === a[0]); if (i < 0) return null; const p = a[1]; if (p.name !== undefined) list[i].name = String(p.name).trim() || list[i].name; if (p.icon !== undefined) list[i].icon = p.icon || '🔊'; if (p.vol !== undefined) list[i].vol = p.vol; push(); return { ...list[i] }; }
      if (m === 'sfxRemove') { const k = list.length; list = list.filter(x => x.id !== a[0]); push(); return list.length < k; }
      if (m === 'sfxMove') { const i = list.findIndex(x => x.id === a[0]); const [it] = list.splice(i, 1); list.splice(a[1], 0, it); push(); return true; }
      if (m === 'sfxPreview') { const it = list.find(x => x.id === a[0]); return it && !it.missing ? { key: 'k' + Math.random(), id: it.id, name: it.name, url: 'about:blank', vol: it.vol } : null; }
      if (m === 'sfxStopAll') return true;
      if (m === 'sfxPlay') { const it = list.find(x => x.id === a[0]); return !!(it && !it.missing); }
      if (m === 'getSettings') return { sfxDuck: window.__duck, duckLevel: 20, backend: 'AUTO', maxHeight: 720, gridCols: 3, fullscreenSec: 0, tvOutput: 'AUTO', fadeInSec: 2, fadeOutSec: 4, seedAutoplay: false, qrHidden: false, tickerMode: 'x' };
      if (m === 'setSetting') { if (a[0] === 'sfxDuck') window.__duck = !!a[1]; return; }
      if (m === 'localDrop') return { added: 1, played: false, dup: 0, full: false, bad: 0, found: 1, folders: 0, singles: 1 };
      return null;
    }
  };
  setTimeout(state, 50); setTimeout(state, 250);
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(MOCK);
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  await page.waitForTimeout(700);
  const called = m => page.evaluate(m => window.__calls.filter(c => c[0] === m), m);
  const names = () => page.$$eval('.srow .sname', els => els.map(e => e.value));
  const stat = () => page.textContent('.sdlg .bstat');

  // mở hộp thoại
  assert.equal(await page.locator('#sfxBtn').count(), 1, 'có nút ở cột trái');
  await page.click('#sfxBtn'); await page.waitForTimeout(400);
  assert.equal(await page.locator('.sdlg').count(), 1);
  assert.deepEqual(await names(), ['Vỗ tay', 'Reo hò', 'Mời cô dâu chú rể', 'Trống']);
  assert.ok((await stat()).includes('4 / 40'), 'đếm số nút');
  assert.ok((await stat()).includes('1 file không còn'), 'báo file mất');
  assert.equal(await page.locator('.srow.miss').count(), 1);
  assert.ok(await page.locator('.srow.miss [data-k="play"]').isDisabled(), 'file mất thì không nghe thử được');
  assert.ok(await page.locator('.srow:first-child [data-k="up"]').isDisabled(), 'hàng đầu không có ▲');
  assert.ok(await page.locator('.srow:last-of-type [data-k="down"]').isDisabled(), 'hàng cuối không có ▼');
  assert.deepEqual(await page.$$eval('.srow .snum', els => els.map(e => e.textContent)), ['1', '2', '3', '4'], 'số phím tắt cạnh mỗi hàng');
  assert.ok((await page.textContent('[data-r="duck"]')).includes('TẮT'), 'mặc định tự hạ nhạc TẮT');
  await page.click('[data-r="duck"]'); await page.waitForTimeout(150);
  assert.deepEqual((await called('setSetting')).pop(), ['setSetting', ['sfxDuck', true]]);
  assert.ok((await page.textContent('[data-r="duck"]')).includes('BẬT') && await page.locator('[data-r="duck"].on').count() === 1);
  await page.click('[data-r="duck"]'); await page.waitForTimeout(150);
  assert.deepEqual((await called('setSetting')).pop(), ['setSetting', ['sfxDuck', false]]);
  assert.ok((await page.textContent('[data-r="duck"]')).includes('TẮT'));
  await page.screenshot({ path: SHOT + '/sfx-dlg.png' });

  // đổi tên (Enter chốt), tên rỗng thì giữ tên cũ
  await page.fill('.srow:nth-of-type(1) .sname', 'Vỗ tay thật to'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  assert.deepEqual((await called('sfxUpdate')).pop(), ['sfxUpdate', ['sAAAA1', { name: 'Vỗ tay thật to' }]]);
  await page.fill('.srow:nth-of-type(2) .sname', '   '); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  assert.equal(await page.inputValue('.srow:nth-of-type(2) .sname'), 'Reo hò', 'tên rỗng: hiện lại tên cũ');

  // âm lượng: kéo thì chỉ đổi số, thả mới lưu + nghe thử
  const before = (await called('sfxPreview')).length;
  await page.$eval('.srow:nth-of-type(1) .svol', el => { el.value = 35; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.textContent('.srow:nth-of-type(1) .svl'), '35%');
  assert.equal((await called('sfxUpdate')).filter(c => c[1][1].vol !== undefined).length, 0, 'đang kéo chưa lưu');
  await page.$eval('.srow:nth-of-type(1) .svol', el => el.dispatchEvent(new Event('change', { bubbles: true }))); await page.waitForTimeout(200);
  assert.deepEqual((await called('sfxUpdate')).pop(), ['sfxUpdate', ['sAAAA1', { vol: 35 }]]);
  assert.equal((await called('sfxPreview')).length, before + 1, 'thả thanh trượt thì nghe thử');
  await page.click('.srow:nth-of-type(4) [data-k="play"]'); await page.waitForTimeout(100);
  assert.equal((await called('sfxPreview')).pop()[1][0], 'sDDDD4', 'nút ▶ nghe thử đúng hiệu ứng');

  // biểu tượng: chọn trong bảng emoji, và gõ emoji riêng
  await page.click('.srow:nth-of-type(2) .sicon'); await page.waitForTimeout(100);
  assert.equal(await page.locator('.spick').count(), 1);
  await page.click('.spick button >> nth=3'); await page.waitForTimeout(150); // 🥳
  assert.deepEqual((await called('sfxUpdate')).pop(), ['sfxUpdate', ['sBBBB2', { icon: '🥳' }]]);
  assert.equal(await page.locator('.spick').count(), 0, 'chọn xong thì đóng bảng');
  assert.equal(await page.textContent('.srow:nth-of-type(2) .sicon'), '🥳');
  await page.click('.srow:nth-of-type(2) .sicon'); await page.fill('.spick input', '🍕'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  assert.equal(await page.textContent('.srow:nth-of-type(2) .sicon'), '🍕');

  // sắp xếp bằng nút ▼ / ▲ (con trỏ ở lại đúng nút)
  await page.click('.srow:nth-of-type(1) [data-k="down"]'); await page.waitForTimeout(200);
  assert.deepEqual((await names()).slice(0, 2), ['Reo hò', 'Vỗ tay thật to']);
  assert.deepEqual((await called('sfxMove')).pop(), ['sfxMove', ['sAAAA1', 1]]);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.k), 'down', 'giữ con trỏ sau khi đổi chỗ');
  await page.click('.srow:nth-of-type(2) [data-k="up"]'); await page.waitForTimeout(200);
  assert.deepEqual((await names()).slice(0, 2), ['Vỗ tay thật to', 'Reo hò']);

  // sắp xếp bằng kéo thả ≡ : kéo hàng 1 xuống dưới hàng 3
  const drag = async (from, to, below) => {
    await page.evaluate(([f, t, below]) => {
      const rows = [...document.querySelectorAll('.srow')], a = rows[f], b = rows[t];
      const dt = new DataTransfer();
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const rc = b.getBoundingClientRect(), y = below ? rc.bottom - 3 : rc.top + 3;
      b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
      b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
      a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, [from, to, below]);
    await page.waitForTimeout(200);
  };
  await drag(0, 2, true);   // [Vỗ tay, Reo hò, Mời, Trống] -> [Reo hò, Mời, Vỗ tay, Trống]
  assert.deepEqual((await names()).map(x => x.slice(0, 3)), ['Reo', 'Mời', 'Vỗ ', 'Trố']);
  assert.deepEqual((await called('sfxMove')).pop(), ['sfxMove', ['sAAAA1', 2]]);
  await drag(3, 0, false);  // kéo "Trống" lên trước hàng đầu
  assert.equal((await names())[0], 'Trống');
  assert.deepEqual((await called('sfxMove')).pop(), ['sfxMove', ['sDDDD4', 0]]);
  await drag(1, 1, true);   // thả lên chính nó: không đổi gì
  assert.equal((await called('sfxMove')).length, 4, 'thả lên chính nó thì không gọi di chuyển');

  // xoá 2 bước: lần 1 chỉ hỏi lại, lần 2 mới xoá; tự huỷ sau 3 giây
  const nrows = (await names()).length;
  await page.click('.srow:nth-of-type(2) [data-k="del"]'); await page.waitForTimeout(100);
  assert.equal(await page.textContent('.srow:nth-of-type(2) [data-k="del"]'), 'Xoá?');
  assert.equal((await called('sfxRemove')).length, 0, 'bấm một lần chưa xoá');
  await page.waitForTimeout(3300);
  assert.equal(await page.textContent('.srow:nth-of-type(2) [data-k="del"]'), '✕', 'tự huỷ yêu cầu xoá sau 3 giây');
  await page.click('.srow:nth-of-type(2) [data-k="del"]'); await page.click('.srow:nth-of-type(2) [data-k="del"]'); await page.waitForTimeout(200);
  assert.equal((await called('sfxRemove')).length, 1); assert.equal((await names()).length, nrows - 1);
  assert.ok((await stat()).includes('Đã xoá'), 'báo đã xoá');

  // thêm file bằng nút; thông báo có số file bị bỏ
  await page.click('[data-r="add"]'); await page.waitForTimeout(250);
  assert.equal((await names()).length, nrows);
  assert.ok((await stat()).includes('Đã thêm 1') && (await stat()).includes('1 file bị bỏ qua'));

  // kéo thả file vào cửa sổ khi đang mở bảng: thành hiệu ứng, KHÔNG vào hàng đợi
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'tieng_cuoi.mp3', { type: 'audio/mpeg' }));
    document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    window.__hint = document.getElementById('dropHint').textContent;
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => window.__hint)).includes('hiệu ứng'), 'gợi ý kéo thả nói đúng việc sẽ làm');
  assert.equal((await called('sfxAdd')).length, 1); assert.equal((await called('localDrop')).length, 0, 'không đưa vào hàng đợi nhạc');
  assert.equal((await names()).length, nrows + 1);

  // dừng hết
  await page.click('[data-r="stop"]'); await page.waitForTimeout(100);
  assert.equal((await called('sfxStopAll')).length, 1);

  // Esc đóng; phím tắt toàn cục (W, M...) không chạy khi đang mở bảng
  await page.fill('.srow:nth-of-type(1) .sname', 'Đang gõ dở'); // chưa Enter
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  assert.equal(await page.locator('.sdlg').count(), 0, 'Esc đóng bảng');
  assert.equal((await called('sfxUpdate')).pop()[1][1].name, 'Đang gõ dở', 'Esc chốt luôn tên đang gõ dở');

  // mở lại: danh sách giữ nguyên thứ tự và tên; khi KHÔNG mở bảng thì thả file vẫn vào hàng đợi như cũ
  await page.click('#sfxBtn'); await page.waitForTimeout(300);
  assert.equal((await names())[0], 'Đang gõ dở');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'bai.mp3', { type: 'audio/mpeg' }));
    document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    window.__hint2 = document.getElementById('dropHint').textContent;
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(200);
  assert.equal((await called('localDrop')).length, 1, 'bảng đóng thì thả file vào hàng đợi như cũ');
  assert.ok((await page.evaluate(() => window.__hint2)).includes('nhạc / video'));

  // ---- phím 1–9 (bảng đã đóng)
  const plays = async () => (await called('sfxPlay')).map(c => c[1][0]);
  const list = await page.evaluate(() => window.__list());
  const p0 = (await plays()).length;
  await page.keyboard.press('1'); await page.waitForTimeout(200);
  let pl = await plays(); assert.equal(pl.length, p0 + 1); assert.equal(pl.pop(), list[0].id, 'phím 1 = hiệu ứng đầu tiên');
  assert.ok((await page.textContent('#toast')).startsWith('1 · '), 'hiện tên hiệu ứng vừa phát');
  await page.waitForTimeout(250);
  await page.keyboard.press('2'); await page.waitForTimeout(200);
  assert.equal((await plays()).pop(), list[1].id, 'phím 2 = hiệu ứng thứ hai');
  await page.keyboard.press('9'); await page.waitForTimeout(150);
  assert.ok((await page.textContent('#toast')).includes('Chưa có hiệu ứng số 9'), 'chưa có thì báo');
  assert.equal((await plays()).length, p0 + 2, 'không gọi phát khi chưa có');
  const mi = list.findIndex(x => x.missing);
  assert.ok(mi >= 0 && mi < 9, 'bài test còn một hiệu ứng mất file để thử');
  await page.keyboard.press(String(mi + 1)); await page.waitForTimeout(300); assert.ok((await page.textContent('#toast')).includes('Không phát được'), 'file mất thì báo');
  // giữ phím (lặp), Shift+số, Ctrl+số, đang gõ trong ô tìm kiếm: không phát
  const p1 = (await plays()).length;
  await page.keyboard.down('1'); await page.keyboard.down('1'); await page.keyboard.down('1'); await page.keyboard.up('1'); await page.waitForTimeout(200);
  assert.equal((await plays()).length, p1 + 1, 'giữ phím chỉ tính một lần');
  await page.keyboard.press('Shift+1'); await page.keyboard.press('Control+1'); await page.waitForTimeout(200);
  assert.equal((await plays()).length, p1 + 1, 'Shift/Ctrl + số không phát');
  await page.focus('#q'); await page.keyboard.type('123'); await page.waitForTimeout(150);
  assert.equal((await plays()).length, p1 + 1, 'đang gõ tìm kiếm: số là chữ, không phát');
  assert.equal(await page.inputValue('#q'), '123'); await page.fill('#q', ''); await page.evaluate(() => document.activeElement.blur());
  // đang phóng lớn video: phím số vẫn phát và KHÔNG thoát phóng lớn
  await page.keyboard.press('f'); await page.waitForTimeout(300);
  assert.equal(await page.locator('#vbox.full').count(), 1, 'đã phóng lớn');
  await page.waitForTimeout(250);
  await page.keyboard.press('2'); await page.waitForTimeout(250);
  assert.equal((await plays()).length, p1 + 2, 'phóng lớn vẫn phát được hiệu ứng');
  assert.equal(await page.locator('#vbox.full').count(), 1, 'phím số không làm thoát phóng lớn');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // Cài đặt chung cũng có công tắc
  await page.click('#gear'); await page.waitForTimeout(300);
  assert.ok((await page.textContent('.dlist')).includes('Tự hạ nhạc khi hiệu ứng riêng phát: TẮT'));
  await page.click('.dlist button:has-text("Tự hạ nhạc khi hiệu ứng riêng")'); await page.waitForTimeout(400);
  assert.deepEqual((await called('setSetting')).pop(), ['setSetting', ['sfxDuck', true]]);
  assert.ok((await page.textContent('.dlist')).includes('Tự hạ nhạc khi hiệu ứng riêng phát: BẬT'));

  await browser.close();
  assert.deepEqual(errors, [], 'không có lỗi script: ' + errors.join(' | '));
  console.log('sfx-ui-test: OK');
})().catch(e => { console.error(e); process.exit(1); });
