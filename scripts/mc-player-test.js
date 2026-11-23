const { chromium } = require('playwright');
const path = require('path'), assert = require('assert');
// WAV im lặng ~6 giây, mono 8 kHz, để <video> thật sự "playing"
function wav(sec) {
  const sr = 8000, n = sr * sec, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return 'data:audio/wav;base64,' + b.toString('base64');
}
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { window.ytp = { call: async () => null, on() {}, send() {} }; });
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'tv.html'));   // chỉ để có trang trống; tự tạo player bên dưới
  await page.waitForTimeout(150);
  const url = wav(8);
  const vol = () => page.evaluate(() => window.__v.volume);
  await page.evaluate(() => {
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;inset:0'; document.body.appendChild(box);
    window.__ev = []; window.__p = window.createPlayer(box, (k, key) => window.__ev.push(k));
    window.__v = box.querySelector('video');
  });
  // 1) bài mới: bắt đầu im lặng, vào dần 1 giây tới 100%
  await page.evaluate(u => window.__p.command({ type: 'load', mode: 'stream', key: 'k1', src: { video: { url: u }, audio: null }, startMs: 0, volume: 100, gain: 1, fadeInMs: 1000 }), url);
  await page.waitForFunction(() => window.__ev.includes('started'), null, { timeout: 5000 });
  const v0 = await vol(); assert.ok(v0 < 0.6, 'đầu bài còn nhỏ, thấy ' + v0);
  await page.waitForTimeout(1300); assert.ok((await vol()) > 0.99, 'sau fade in phải đủ to');
  // 2) MC nói: hạ còn 20%
  await page.evaluate(() => window.__p.command({ type: 'gain', target: 0.2, ms: 300 })); await page.waitForTimeout(450);
  let v = await vol(); assert.ok(Math.abs(v - 0.2) < 0.02, 'hạ còn 0.2, thấy ' + v);
  // 3) âm lượng chính 50% nhân với gain 0.2 = 0.1
  await page.evaluate(() => window.__p.command({ type: 'volume', v: 50 })); v = await vol(); assert.ok(Math.abs(v - 0.1) < 0.01, 'vol50 x gain0.2, thấy ' + v);
  // 4) thả MC: trở lại 0.5
  await page.evaluate(() => window.__p.command({ type: 'gain', target: 1, ms: 800 })); await page.waitForTimeout(950);
  v = await vol(); assert.ok(Math.abs(v - 0.5) < 0.02, 'trở lại 0.5, thấy ' + v);
  // 5) fade out về 0
  await page.evaluate(() => window.__p.command({ type: 'gain', target: 0, ms: 600 })); await page.waitForTimeout(750);
  assert.ok((await vol()) < 0.01, 'fade out về 0');
  // 6) nhích giữa chừng để thấy là mượt (không nhảy cóc): lấy mẫu khi hạ
  await page.evaluate(() => window.__p.command({ type: 'gain', target: 1, ms: 0, from: 1 })); 
  await page.evaluate(() => window.__p.command({ type: 'gain', target: 0, ms: 800 }));
  const samples = []; for (let i = 0; i < 8; i++) { await page.waitForTimeout(100); samples.push(await vol()); }
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] <= samples[i - 1] + 1e-6, 'giảm đều: ' + samples.join(','));
  assert.ok(samples.some(x => x > 0.05 && x < 0.95), 'có giá trị trung gian (mượt): ' + samples.join(','));
  // 7) bài nạp ở trạng thái tạm dừng + fade in: chưa tăng cho tới khi resume
  await page.evaluate(u => window.__p.command({ type: 'load', mode: 'stream', key: 'k2', src: { video: { url: u }, audio: null }, startMs: 0, volume: 100, gain: 1, fadeInMs: 800, paused: true }), url);
  await page.waitForFunction(() => window.__ev.filter(x => x === 'started').length >= 2, null, { timeout: 5000 });
  await page.waitForTimeout(1000); assert.ok((await vol()) < 0.01, 'đang tạm dừng thì chưa vào dần');
  await page.evaluate(() => window.__p.command({ type: 'resume' })); await page.waitForTimeout(1000);
  assert.ok((await vol()) > 0.98, 'bấm Phát thì vào dần đến đủ');
  // 8) đang chờ fade in mà MC bấm: bài chỉ đổi mức đích, không bật to
  await page.evaluate(u => window.__p.command({ type: 'load', mode: 'stream', key: 'k3', src: { video: { url: u }, audio: null }, startMs: 0, volume: 100, gain: 1, fadeInMs: 600 }), url);
  await page.evaluate(() => window.__p.command({ type: 'gain', target: 0.2, ms: 300 }));
  await page.waitForFunction(() => window.__ev.filter(x => x === 'started').length >= 3, null, { timeout: 5000 });
  await page.waitForTimeout(900); v = await vol(); assert.ok(Math.abs(v - 0.2) < 0.02, 'vào dần tới mức đã hạ 0.2, thấy ' + v);
  // 9) tắt tiếng thì luôn 0
  await page.evaluate(() => window.__p.setMuted(true)); assert.equal(await page.evaluate(() => window.__v.muted), true);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Trình phát (Chromium thật): gain / fade in / fade out / MC đều đạt');
})().catch(e => { console.error('THẤT BẠI:', e.message); process.exit(1); });
