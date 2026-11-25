'use strict';
// Hình nền / video nền khi phát nhạc không có hình: helper phía main + trình phát thật (Chromium).
const assert = require('assert'), path = require('path');
const lf = require('../main/localfiles');

// --- helper phân loại file nền
assert.strictEqual(lf.bgKindOf('C:\\a\\nen.JPG'), 'image');
assert.strictEqual(lf.bgKindOf('/x/nen.png'), 'image');
assert.strictEqual(lf.bgKindOf('/x/nen.mp4'), 'video');
assert.strictEqual(lf.bgKindOf('/x/bai.mp3'), null);
assert.strictEqual(lf.bgKindOf('/x/readme.txt'), null);
assert.strictEqual(lf.bgMimeOf('/x/nen.jpg'), 'image/jpeg');
assert.strictEqual(lf.bgMimeOf('/x/nen.webm'), 'video/webm');

(async () => {
  let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Nền khi phát nhạc: helper đạt (bỏ qua phần trình duyệt, chưa cài playwright)'); return; }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { window.ytp = { call: async () => null, on() {}, send() {} }; });
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'tv.html'));
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;inset:0'; document.body.appendChild(box);
    window.__p = window.createPlayer(box, () => {}); window.__box = box;
  });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const st = () => page.evaluate(() => {
    const cover = [...__box.children].find(c => c.style.flexDirection === 'column' || c.style.alignItems === 'center');
    const kids = [...cover.children];
    return { cover: cover.style.display, layer: kids[0].style.display, img: kids[0].style.backgroundImage, vid: !!cover.querySelector('video'), note: kids[2].style.display };
  });
  // 1) nhạc không hình, chưa có nền: nốt nhạc hiện, lớp nền ẩn
  await page.evaluate(() => __p.command({ type: 'load', mode: 'stream', key: 'a', title: 'Bài thử', src: { audioOnly: true, video: { url: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' }, audio: null }, startMs: 0, volume: 100, gain: 1 }));
  let s = await st(); assert.strictEqual(s.cover, 'flex'); assert.strictEqual(s.layer, 'none'); assert.notStrictEqual(s.note, 'none');
  // 2) đổi sang hình nền khi đang phát: lớp nền hiện, nốt nhạc ẩn
  await page.evaluate(u => __p.command({ type: 'bg', bg: { type: 'image', url: u } }), png);
  s = await st(); assert.strictEqual(s.layer, 'block'); assert.ok(s.img.includes('data:image/png'), 'phải có ảnh nền'); assert.strictEqual(s.note, 'none');
  // 3) video nền: tạo <video> tắt tiếng + lặp
  await page.evaluate(() => __p.command({ type: 'bg', bg: { type: 'video', url: 'data:video/mp4;base64,AAAA' } }));
  const v = await page.evaluate(() => { const e = __box.querySelector('div video'); return e && { muted: e.muted, loop: e.loop }; });
  assert.deepStrictEqual(v, { muted: true, loop: true });
  // 4) bỏ nền: về lại mặc định
  await page.evaluate(() => __p.command({ type: 'bg', bg: null }));
  s = await st(); assert.strictEqual(s.layer, 'none'); assert.strictEqual(s.vid, false); assert.notStrictEqual(s.note, 'none');
  // 5) bài mới kèm nền trong lệnh load
  await page.evaluate(u => __p.command({ type: 'load', mode: 'stream', key: 'b', title: 'Bài 2', bg: { type: 'image', url: u }, src: { audioOnly: true, video: { url: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' }, audio: null }, startMs: 0, volume: 100, gain: 1 }), png);
  s = await st(); assert.strictEqual(s.layer, 'block');
  assert.deepStrictEqual(errors, [], 'không được có lỗi trang: ' + errors.join(' | '));
  await browser.close();
  console.log('Nền khi phát nhạc: helper + trình phát (hình, video, bỏ nền, đổi giữa bài) đều đạt');
})().catch(e => { console.error(e); process.exit(1); });
