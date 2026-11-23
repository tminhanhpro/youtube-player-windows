'use strict';
// Kiểm tra trang chiếu TV (tv.html) trong Chromium với main-process giả.
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    const h = {}; window.__sent = [];
    window.__emit = (c, d) => (h[c] || []).forEach(f => f(d));
    window.ytp = { on: (c, f) => { (h[c] = h[c] || []).push(f); }, send: (c, d) => window.__sent.push([c, d]), call: async () => null };
  });
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'tv.html'));
  await page.waitForTimeout(200);
  assert.ok((await page.evaluate(() => window.__sent)).some(m => m[0] === 'player-ready'), 'báo sẵn sàng');
  await page.evaluate(() => window.__emit('state', { snap: { state: 'IDLE' } }));
  assert.ok((await page.locator('#idleText').textContent()).includes('Youtube Player'));
  assert.equal(await page.locator('#idle').evaluate(e => e.classList.contains('off')), false);
  await page.screenshot({ path: '/tmp/tv-idle.png' });
  await page.evaluate(() => window.__emit('state', { snap: { state: 'PLAYING' } }));
  assert.equal(await page.locator('#idle').evaluate(e => e.classList.contains('off')), true, 'đang phát thì ẩn màn chờ');
  await page.evaluate(() => window.__emit('volume', 55)); await page.waitForTimeout(100);
  assert.equal(await page.locator('#volbox').isVisible(), true);
  // khung video phủ toàn màn hình
  const b = await page.locator('#vbox').boundingBox(); assert.ok(b.width === 1920 && b.height === 1080);
  // lệnh phát: nạp video -> phần tử <video> hiện ra toàn khung
  await page.evaluate(() => window.__emit('player', { type: 'load', mode: 'stream', key: 'k', src: { video: { url: 'data:video/mp4;base64,AAAA' }, audio: null }, startMs: 0, volume: 70 }));
  await page.waitForTimeout(200);
  const vb = await page.locator('#vbox video').boundingBox(); assert.ok(vb.width === 1920 && vb.height === 1080, 'video phủ toàn màn');
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Trang TV: đạt');
})().catch(e => { console.error('TV THẤT BẠI:', e.message); process.exit(1); });
