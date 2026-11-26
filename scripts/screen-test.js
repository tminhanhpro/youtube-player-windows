'use strict';
// Lặp lại bài đang phát (máy trạng thái) + chế độ màn hình TV/LED: LIVE / STANDBY / BLACK (trình phát thật trong Chromium).
const assert = require('assert'), path = require('path'), fs = require('fs'), os = require('os');
const { Controller } = require('../main/controller');
const { Store, Settings } = require('../main/store');
const resolver = require('../main/resolver');

(async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-scr-'))), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  resolver.resolve = async vid => ({ sources: [{ video: { url: 'http://x/' + vid }, audio: null, height: 720 }], expiresAt: Date.now() + 1e6, title: 'T', channel: 'C', durationSec: 100 });
  const cmds = []; ctl.on('player', c => cmds.push(c));
  ctl.attachPlayer(true);
  ctl.add('aaaaaaaaaaa', 'A', '', 100, 'u', 'end', false);
  ctl.add('bbbbbbbbbbb', 'B', '', 100, 'u', 'end', false);
  await new Promise(r => setTimeout(r, 50));
  let load = cmds.filter(c => c.type === 'load').pop();
  ctl.playerEvent('started', load.key);
  assert.equal(ctl.snapshot().repeat, false, 'mặc định không lặp');
  // bật lặp: hết bài thì tua về 0 + phát tiếp, KHÔNG sang bài B
  ctl.setRepeat(true); assert.equal(ctl.snapshot().repeat, true);
  const n = cmds.filter(c => c.type === 'load').length; cmds.length = 0;
  ctl.playerEvent('ended', load.key); await new Promise(r => setTimeout(r, 50));
  assert.equal(cmds.filter(c => c.type === 'load').length, 0, 'không nạp bài mới khi đang lặp');
  assert.deepEqual(cmds.map(c => c.type), ['seek', 'resume']); assert.equal(cmds[0].ms, 0);
  assert.equal(ctl.current.videoId, 'aaaaaaaaaaa'); assert.equal(ctl.queue.length, 1, 'bài B vẫn đang chờ');
  // "Bài tiếp" vẫn sang bài B dù đang lặp; tắt lặp thì hết bài là sang bài kế
  ctl.skip(); await new Promise(r => setTimeout(r, 50));
  assert.equal(ctl.current.videoId, 'bbbbbbbbbbb');
  ctl.setRepeat(false); assert.equal(ctl.snapshot().repeat, false);

  let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Lặp lại: đạt (bỏ qua phần trình duyệt, chưa cài playwright)'); return; }
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
  const ov = () => page.evaluate(() => { const e = [...__box.children].find(c => c.style.zIndex === '2'); return { show: e.style.display !== 'none', bg: e.style.background, vid: !!e.querySelector('video'), note: e.textContent }; });
  let o = await ov(); assert.equal(o.show, false, 'mặc định không phủ');
  await page.evaluate(() => __p.command({ type: 'screen', mode: 'BLACK' }));
  o = await ov(); assert.ok(o.show && o.bg.includes('rgb(0, 0, 0)') && !o.vid, 'tắt màn hình: phủ đen');
  await page.evaluate(() => __p.command({ type: 'screen', mode: 'STANDBY', bg: null }));
  o = await ov(); assert.ok(o.show && o.note.includes('♪'), 'màn hình chờ mặc định: nền tím có nốt nhạc');
  await page.evaluate(u => __p.command({ type: 'screen', mode: 'STANDBY', bg: { type: 'image', url: u } }), png);
  o = await ov(); assert.ok(o.show && o.bg.includes('data:image/png'), 'màn hình chờ có hình chờ');
  await page.evaluate(() => __p.command({ type: 'screen', mode: 'STANDBY', bg: { type: 'video', url: 'data:video/mp4;base64,AAAA' } }));
  const v = await page.evaluate(() => { const e = [...__box.children].find(c => c.style.zIndex === '2').querySelector('video'); return e && { muted: e.muted, loop: e.loop }; });
  assert.deepEqual(v, { muted: true, loop: true }, 'video chờ tắt tiếng + lặp');
  await page.evaluate(() => __p.command({ type: 'screen', mode: 'LIVE' }));
  o = await ov(); assert.equal(o.show, false); assert.equal(o.vid, false, 'mở lại TV/LED: gỡ video chờ');
  assert.deepEqual(errors, [], errors.join('|'));
  await browser.close();
  console.log('Lặp lại + màn hình TV/LED (chờ / tắt / mở): đều đạt'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
