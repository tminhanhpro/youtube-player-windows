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
  let favs = []; let karaoke = false; let state = 'PLAYING';
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
      if (m === 'getSettings') return cfg;
      if (m === 'setSetting') { cfg[a[0]] = a[1]; push(); return; }
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

  // thao tác: yêu thích bằng chuột phải, karaoke, cài đặt, dialog tạo thể loại, phóng to
  await page.locator('#grid .cardv').nth(1).click({ button: 'right' });
  await page.waitForTimeout(100);
  assert.ok(await page.locator('#grid .cardv').nth(1).evaluate(e => e.classList.contains('fav')), 'tim hiện lên');
  await page.click('#karaoke'); await page.waitForTimeout(150);
  assert.ok(await page.locator('#karaoke').evaluate(e => e.classList.contains('on')));
  await page.click('#gear'); await page.waitForTimeout(200);
  assert.equal(await page.locator('.dlist button').count(), 9);
  await page.screenshot({ path: '/tmp/ui-settings.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#modal').isHidden(), true);
  await page.click('#addCat'); await page.waitForSelector('.dlg input:focus'); await page.keyboard.type('Rap Việt'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  assert.equal(await page.locator('#cats .cat').count(), 4);
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
