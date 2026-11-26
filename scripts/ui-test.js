'use strict';
// Mở dashboard.html trong Chromium với main-process giả để kiểm tra bố cục và thao tác.
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const MOCK = () => {
  const handlers = {}; const calls = [];
  window.__calls = calls;
  const mkItem = (i, t) => ({ itemId: 'i' + i, videoId: 'vid' + String(i).padStart(8, '0'), title: t, channel: 'Kênh ' + i, durationSec: 180 + i, addedBy: i % 2 ? 'Lan' : null, status: 'PENDING' });
  const results = Array.from({ length: 12 }, (_, i) => ({ videoId: 'res' + String(i).padStart(8, '0'), title: 'Bài hát số ' + i + ' rất dài để kiểm tra cắt chữ nhiều lần', channel: 'Ca sĩ ' + i, durationSec: 200 + i }));
  let cats = [{ name: 'Acoustic & Hòa Tấu', q: 'a', custom: false }, { name: 'Saxophone Jazz', q: 'b', custom: false }, { name: 'Chill & Lofi Beats', q: 'c', custom: false }];
  let favs = []; let karaoke = false; let state = 'PLAYING'; let screenMode = 'LIVE';
  const cfg = { backend: 'AUTO', maxHeight: 720, seedAutoplay: true, gridCols: 3, fullscreenSec: 5, qrHidden: false };
  const snap = () => ({ state, nowPlaying: mkItem(0, 'Bài đang phát'), positionMs: 65000, durationMs: 200000, karaoke, netWait: false, queue: [mkItem(1, 'Bài chờ một'), mkItem(2, 'Bài chờ hai')] });
  const push = () => (handlers.state || []).forEach(h => h({ snap: snap(), info: { ip: '192.168.1.5', port: 8080, qr: null, host: 'http://192.168.1.5:8080', remoteConnected: true, who: 'Lan', net: { text: 'Wi-Fi', icon: 'wifi' }, cfg }, ui: {} }));
  const emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
  window.__emit = emit; window.__setState = s => { state = s; push(); };
  window.ytp = {
    on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; },
    send: () => {},
    call: async (m, a) => {
      calls.push([m, a]);
      if (m === 'initial') return { cats, favs, search: { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null } };
      if (m === 'tvSearch') { setTimeout(() => emit('search', { version: 1, query: a[0], source: 'tv', results, hasMore: false, page: 0, loading: false, error: null }), 20); return; }
      if (m === 'favAdd') { favs = [a[0], ...favs]; return true; }
      if (m === 'setKaraoke') { karaoke = a[0]; push(); return; }
      if (m === 'addHit') return 1;
      if (m === 'favMove' || m === 'playHitNow' || m === 'favRemove') return true;
      if (m === 'getSettings') return cfg;
      if (m === 'setSetting') { cfg[a[0]] = a[1]; push(); return; }
      if (m === 'getScreen') return screenMode;
      if (m === 'setScreen') { screenMode = a[0]; return screenMode; }
      if (m === 'catAdd') { cats.push({ name: a[0], q: a[0], custom: true }); emit('cats', cats); return cats.length - 1; }
      return null;
    }
  };
  setTimeout(push, 50);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(MOCK);
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#cats .cat').count(), 3, 'có 3 thể loại');
  assert.equal(await page.locator('#grid .cardv').count(), 12, 'tự tìm thể loại đầu -> 12 kết quả');
  assert.equal(await page.locator('#qlist .q').count(), 2);
  assert.ok((await page.locator('#remote').textContent()).includes('Remote Đã Kết Nối'));
  await page.screenshot({ path: '/tmp/ui-1920.png' });
  // bố cục mới: danh mục nằm trong nút "Danh Mục"; kết quả : hàng đợi = 2 : 1; hàng đợi cạnh cột đang phát
  assert.equal(await page.locator('#catMenu').isHidden(), true, 'menu danh mục ban đầu đóng');
  assert.equal(await page.locator('.hint').count(), 0, 'đã bỏ chữ Enter/Shift');
  const rb = await page.locator('.results').boundingBox(), qb = await page.locator('.queue').boundingBox(), nb = await page.locator('.now').boundingBox();
  assert.ok(Math.abs(rb.width / qb.width - 2) < 0.2, 'kết quả : hàng đợi ≈ 2:1 (' + rb.width + ':' + qb.width + ')');
  assert.ok(qb.x + qb.width <= nb.x + 1 && nb.x - (qb.x + qb.width) < 40, 'hàng đợi sát cột đang phát');
  assert.equal(await page.locator('.left').count(), 0, 'đã bỏ cột trái');
  assert.equal(await page.locator('#qrPop').isHidden(), true, 'popup QR ban đầu đóng');
  await page.click('#qrBtn'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#qrPop').isVisible(), true, 'bấm QR thì hiện popup');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#qrPop').isHidden(), true);
  await page.click('#qrBtn'); await page.mouse.click(900, 700); assert.equal(await page.locator('#qrPop').isHidden(), true, 'bấm ra ngoài thì đóng');
  assert.equal(await page.locator('#gear').isVisible(), true, 'nút Cài đặt trên đầu trang');
  assert.ok((await page.locator('.results').boundingBox()).x < 120, 'kết quả sát lề trái');
  // mỗi bài trong hàng đợi có đủ nút: phát, lên, xuống, xoá
  assert.equal(await page.locator('#qlist .q').first().locator('.qa button').count(), 4);
  assert.equal(await page.locator('#qlist .q').first().locator('.qu').isDisabled(), true, 'bài đầu không dời lên được');
  assert.equal(await page.locator('#qlist .q').nth(1).locator('.qd').isDisabled(), true, 'bài cuối không dời xuống được');
  await page.locator('#qlist .q').first().locator('.qd').click(); await page.locator('#qlist .q').first().locator('.qx').click(); await page.locator('#qlist .q').first().locator('.qp').click();
  const qc = await page.evaluate(() => window.__calls.map(c => c[0]));
  for (const m of ['moveItem', 'remove', 'playNow']) assert.ok(qc.includes(m), 'đã gọi ' + m);
  await page.click('#catBtn'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#catMenu').isVisible(), true, 'bấm Danh Mục thì xổ xuống');
  assert.equal(await page.locator('#catMenu #addCat').isVisible(), true); assert.equal(await page.locator('#catMenu .cat').count(), 3);
  await page.screenshot({ path: '/tmp/ui-menu.png' });
  await page.locator('#catMenu .cat').nth(1).click(); await page.waitForTimeout(100);
  assert.equal(await page.locator('#catMenu').isHidden(), true, 'chọn danh mục thì tự đóng');
  assert.ok((await page.evaluate(() => window.__calls)).some(c => c[0] === 'tvSearch' && c[1][0] === 'b'));
  await page.click('#catBtn'); await page.keyboard.press('Escape'); assert.equal(await page.locator('#catMenu').isHidden(), true, 'Esc đóng menu');
  // hàng điều khiển mới
  const ids = ['b-back', 'b-play', 'b-next', 'b-fwd', 'b-replay', 'b-repeat'];
  const ys = await Promise.all(ids.map(i => page.locator('#' + i).boundingBox()));
  assert.ok(ys.every(b => Math.abs(b.y + b.height / 2 - (ys[0].y + ys[0].height / 2)) < 12), 'sáu nút cùng một hàng');
  const vd = await page.locator('#b-voldn').boundingBox(), vr = await page.locator('#volRange').boundingBox(), vu = await page.locator('#b-volup').boundingBox();
  assert.ok(vd.x < vr.x && vr.x < vu.x && vd.y > ys[0].y + ys[0].height, 'hàng âm lượng: nhỏ - thanh gạt - lớn, nằm dưới hàng nút');
  const bb = await page.locator('#bgVid').boundingBox(), sb = await page.locator('#scrOn').boundingBox();
  assert.ok(bb.y > vd.y && sb.y > bb.y, 'dưới âm lượng là video/hình chờ, dưới cùng là LED');
  await page.click('#b-replay'); await page.click('#b-repeat'); await page.click('#bgVid'); await page.click('#bgImg'); await page.click('#scrStandby'); await page.waitForTimeout(100);
  assert.ok(await page.locator('#scrStandby').evaluate(e => e.classList.contains('on')), 'MÀN HÌNH CHỜ sáng khi đang chọn');
  await page.click('#scrOff'); await page.waitForTimeout(100);
  assert.ok(await page.locator('#scrOff').evaluate(e => e.classList.contains('on')));
  await page.locator('#volRange').fill('35');
  const cs = await page.evaluate(() => window.__calls.map(c => c[0]));
  for (const m of ['seekTo', 'setRepeat', 'bgPick', 'setScreen', 'setVolume']) assert.ok(cs.includes(m), 'đã gọi ' + m);
  assert.deepEqual((await page.evaluate(() => window.__calls)).filter(c => c[0] === 'setVolume').pop()[1], [35]);
  await page.screenshot({ path: '/tmp/ui-1920b.png' });

  // thao tác: yêu thích bằng chuột phải, karaoke, cài đặt, dialog tạo thể loại, phóng to
  await page.locator('#grid .cardv').nth(1).click({ button: 'right' });
  await page.waitForTimeout(100);
  assert.ok(await page.locator('#grid .cardv').nth(1).evaluate(e => e.classList.contains('fav')), 'tim hiện lên');
  // Yêu thích: mỗi bài có phát / lên / xuống / xoá
  await page.click('#t-fav'); await page.waitForTimeout(200);
  assert.equal(await page.locator('#grid .cardv').count(), 1);
  assert.equal(await page.locator('#grid .cardv .qa button').count(), 4);
  assert.equal(await page.locator('#grid .cardv .qu').isDisabled(), true); assert.equal(await page.locator('#grid .cardv .qd').isDisabled(), true, 'chỉ 1 bài: không dời được');
  await page.locator('#grid .cardv .qp').click(); await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => window.__calls)).some(c => c[0] === 'playHitNow'));
  await page.locator('#grid .cardv .qx').click(); await page.waitForTimeout(150);
  assert.ok((await page.evaluate(() => window.__calls)).some(c => c[0] === 'favRemove'));
  await page.evaluate(() => window.ytp.call('tvSearch', ['a'])); await page.click('#catBtn'); await page.locator('#catMenu .cat').first().click(); await page.waitForTimeout(250);
  await page.click('#karaoke'); await page.waitForTimeout(150);
  assert.ok(await page.locator('#karaoke').evaluate(e => e.classList.contains('on')));
  await page.click('#gear'); await page.waitForTimeout(200);
  assert.equal(await page.locator('.dlist button').count(), 14);   // 10 mục cũ + 3 mục MC/fade + 1 mục tự hạ nhạc khi hiệu ứng riêng phát
  await page.screenshot({ path: '/tmp/ui-settings.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#modal').isHidden(), true);
  await page.click('#catBtn'); await page.click('#addCat'); await page.waitForSelector('.dlg input:focus'); await page.keyboard.type('Rap Việt'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  assert.equal(await page.locator('#cats .cat').count(), 4); assert.equal(await page.locator('#catMenu').isHidden(), true, 'bấm Tạo Thể Loại Mới thì đóng menu');
  await page.click('#fsBtn'); await page.waitForTimeout(200);
  assert.ok(await page.locator('#vbox').evaluate(e => e.classList.contains('full')), 'phóng to');
  const box = await page.locator('#vbox').boundingBox(); assert.ok(box.width >= 1900 && box.height >= 1070);
  await page.waitForTimeout(900); await page.keyboard.press('x'); await page.waitForTimeout(300);
  assert.ok(!(await page.locator('#vbox').evaluate(e => e.classList.contains('full'))), 'phím bất kỳ -> thu nhỏ');
  // bàn phím: mũi tên di chuyển tiêu điểm, Enter thêm bài
  await page.locator('#grid .cardv').first().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.kind), 'card');
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => window.__calls)).some(c => c[0] === 'addHit'));
  // hiệu ứng cổ vũ + tin nhắn chạy vẽ lên màn hình
  await page.evaluate(() => { window.__emit('reaction', 'heart'); window.__emit('message', { sender: 'Lan', text: 'Hát hay quá!' }); });
  await page.waitForTimeout(1200);
  const painted = await page.evaluate(() => [...document.querySelectorAll('#fxl canvas')].map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++; return n; }));
  assert.ok(painted.every(n => n > 20), 'cả hai lớp (hiệu ứng + tin nhắn) có hình: ' + painted);
  await page.screenshot({ path: '/tmp/ui-fx.png' });
  // 1 bài / hàng và cửa sổ nhỏ
  await page.evaluate(() => window.ytp.call('setSetting', ['gridCols', 1])); await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/ui-1col.png' });
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/ui-1280.png' });
  assert.deepEqual(errors, [], 'không có lỗi JS: ' + errors.join('|'));
  await browser.close();
  console.log('Giao diện: tất cả kiểm tra đều đạt');
})().catch(e => { console.error('UI THẤT BẠI:', e.message); process.exit(1); });
