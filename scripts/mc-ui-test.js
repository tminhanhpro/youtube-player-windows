'use strict';
// Kiểm tra giao diện MC nói + fade: (A) màn hình máy tính với main-process giả, (B) remote điện thoại nối server thật.
const { chromium } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs'), assert = require('assert');
const { Store, Settings } = require('../main/store');
const { Controller } = require('../main/controller');
const { KaraokeServer } = require('../main/server');
const resolver = require('../main/resolver');

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ---------------------------------------------------------------- A. màn hình máy tính
  {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => errors.push('dash: ' + e));
    await page.addInitScript(() => {
      const h = {}; window.__calls = [];
      window.__emit = (c, d) => (h[c] || []).forEach(f => f(d));
      window.ytp = {
        on: (c, f) => { (h[c] = h[c] || []).push(f); }, send() {},
        call: async (m, a) => { window.__calls.push([m, a]); if (m === 'initial') return { cats: [], favs: [], search: { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null } }; if (m === 'fadeOut') return 'start'; return null; }
      };
    });
    await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html'));
    await page.waitForTimeout(200);
    const push = (extra) => page.evaluate(x => window.__emit('state', {
      snap: Object.assign({ state: 'PLAYING', nowPlaying: { title: 'Bài thử', channel: 'Kênh' }, positionMs: 30000, durationMs: 200000, queue: [], karaoke: false, duck: false, fading: false }, x),
      info: { remoteConnected: true, who: 'Phone', net: { text: 'Wi-Fi', icon: 'wifi' }, port: 8080, qr: null, host: 'http://1.2.3.4:8080', cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO', fadeOutSec: 4 } }
    }), extra);
    const calls = () => page.evaluate(() => window.__calls.filter(c => c[0] === 'setDuck' || c[0] === 'fadeOut').map(c => c[0] + JSON.stringify(c[1] || [])));
    const reset = () => page.evaluate(() => { window.__calls.length = 0; });
    await push({});
    assert.equal(await page.locator('#b-mc').evaluate(e => e.classList.contains('on')), false);
    await page.screenshot({ path: '/tmp/dash-normal.png' });
    await push({ duck: true });
    assert.equal(await page.locator('#b-mc').evaluate(e => e.classList.contains('on')), true, 'nút MC sáng khi đang hạ nhạc');
    assert.ok((await page.locator('#badge').textContent()).includes('MC NÓI'));
    await page.screenshot({ path: '/tmp/dash-duck.png' });
    await push({ duck: false });
    // bấm nút = bật/tắt
    await reset(); await page.click('#b-mc'); assert.deepEqual(await calls(), ['setDuck[true,false]']);
    await push({ duck: true }); await reset(); await page.click('#b-mc'); assert.deepEqual(await calls(), ['setDuck[false,false]']);
    await push({ duck: false });
    // phím M bấm nhanh -> bật & giữ (chốt)
    await reset(); await page.keyboard.down('m'); await page.keyboard.up('m');
    assert.deepEqual(await calls(), ['setDuck[true,true]', 'setDuck[true,false]'], 'bấm nhanh = chốt bật');
    // phím M giữ lâu -> thả ra là trả nhạc
    await reset(); await page.keyboard.down('m'); await page.waitForTimeout(600); await page.keyboard.up('m');
    assert.deepEqual(await calls(), ['setDuck[true,true]', 'setDuck[false,false]'], 'giữ rồi thả = trả nhạc');
    // đang chốt bật, bấm M = tắt, thả phím không làm gì thêm
    await push({ duck: true }); await reset(); await page.keyboard.down('m'); await page.keyboard.up('m');
    assert.deepEqual(await calls(), ['setDuck[false,false]']);
    await push({ duck: false });
    // gõ chữ m trong ô tìm kiếm không kích hoạt MC
    await reset(); await page.click('#q'); await page.keyboard.type('mo'); assert.deepEqual(await calls(), []);
    await page.keyboard.press('Escape'); await page.locator('#q').evaluate(e => e.blur());
    // fade out
    await reset(); await page.click('#b-fade'); assert.deepEqual(await calls(), ['fadeOut[]']);
    await reset(); await page.keyboard.press('o'); assert.deepEqual(await calls(), ['fadeOut[]']);
    await push({ fading: true }); assert.equal(await page.locator('#b-fade').evaluate(e => e.classList.contains('on')), true);
    assert.ok((await page.locator('#fadeLbl').textContent()).includes('huỷ'));
    // cài đặt có 3 mục mới
    await page.evaluate(() => { const o = window.ytp.call; window.ytp.call = async (m, a) => m === 'getSettings' ? { backend: 'AUTO', maxHeight: 720, seedAutoplay: true, gridCols: 3, fullscreenSec: 5, tvOutput: 'AUTO', duckLevel: 20, fadeInSec: 2, fadeOutSec: 4 } : o(m, a); });
    await page.click('#gear'); await page.waitForTimeout(200);
    const dlg = await page.locator('.dlg').textContent();
    assert.ok(dlg.includes('Nhạc hạ còn khi MC nói: 20%') && dlg.includes('Nhạc vào dần đầu mỗi bài: 2 giây') && dlg.includes('Thời gian fade out khi bấm nút: 4 giây'), 'mục cài đặt mới');
    await page.screenshot({ path: '/tmp/dash-settings.png' });
    await page.close();
  }

  // ---------------------------------------------------------------- B. remote điện thoại + server thật
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp4-'))), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  resolver.resolve = async (vid) => ({ sources: [{ video: { url: 'http://x/' + vid }, audio: null, height: 720 }], expiresAt: Date.now() + 1e6, title: 'T', channel: 'C', durationSec: 100 });
  const cmds = []; ctl.on('player', c => cmds.push(c));
  ctl.attachPlayer(true);
  const srv = new KaraokeServer({ ctl, settings, store, webDir: path.join(__dirname, '..', 'web'), uiDir: path.join(__dirname, '..', 'renderer') });
  const port = await srv.listen(); ctl.start();
  ctl.add('aaaaaaaaaaa', 'Bài A', 'Kênh', 100, 'u', 'end', false);
  await new Promise(r => setTimeout(r, 80));
  ctl.playerEvent('started', cmds.filter(c => c.type === 'load').pop().key);

  for (const ui of ['new', 'classic']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('phone ' + ui + ': ' + e));
    await page.addInitScript(u => { try { localStorage.setItem('k_ui', u); localStorage.setItem('k_lang', 'vi'); } catch (e) {} }, ui);
    await page.goto('http://127.0.0.1:' + port + '/?token=' + settings.token);
    await page.waitForSelector('#b-mc', { state: 'visible' }); await page.waitForTimeout(1500);
    const box = await page.locator('#b-mc').boundingBox(); assert.ok(box && box.width > 40 && box.height > 30, ui + ': nút MC hiện đủ lớn ' + JSON.stringify(box));
    const fbox = await page.locator('#b-fade').boundingBox(); assert.ok(fbox && fbox.width > 40, ui + ': nút Tắt dần hiện');
    for (const id of ['b-play', 'b-next', 'b-replay', 'b-mic', 'b-vdown', 'b-vup', 'b-react', 'b-add']) {
      const bb = await page.locator('#' + id).boundingBox(); assert.ok(bb && bb.width > 30 && bb.height > 30, ui + ': nút cũ ' + id + ' vẫn hiện đủ lớn ' + JSON.stringify(bb));
    }
    const vh = 844; assert.ok(box.y + box.height <= vh && fbox.y + fbox.height <= vh, ui + ': nằm trong màn hình');
    await page.screenshot({ path: '/tmp/phone-' + ui + '.png' });
    // bấm nhanh = chốt bật
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(400);
    assert.equal(ctl.duck, true, ui + ': bấm nhanh chốt bật'); assert.equal(ctl.duckWd, null, ui + ': chốt thì bỏ hẹn giờ');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#b-mc').evaluate(e => e.classList.contains('on')), true, ui + ': nút sáng');
    await page.screenshot({ path: '/tmp/phone-' + ui + '-on.png' });
    await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(400);
    assert.equal(ctl.duck, false, ui + ': bấm lần nữa thì tắt');
    // giữ = nhạc nhỏ khi giữ, thả ra thì trả nhạc
    await page.mouse.down(); await page.waitForTimeout(700);
    assert.equal(ctl.duck, true, ui + ': đang giữ'); assert.ok(ctl.duckWd, ui + ': giữ có hẹn giờ an toàn');
    await page.mouse.up(); await page.waitForTimeout(400);
    assert.equal(ctl.duck, false, ui + ': thả ra thì nhạc trở lại');
    // Tắt dần
    await page.locator('#b-fade').click(); await page.waitForTimeout(300);
    assert.equal(ctl.fading, true, ui + ': bắt đầu tắt dần');
    assert.ok((await page.locator('#pill').textContent()).includes('Đang tắt dần'));
    await page.locator('#b-fade').click(); await page.waitForTimeout(300);
    assert.equal(ctl.fading, false, ui + ': bấm lại huỷ'); assert.equal(ctl.state, 'PLAYING');
    await ctx.close();
  }
  ctl.stop(); srv.close(); store.flush();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Giao diện MC + Tắt dần (máy tính + điện thoại): đạt');
  process.exit(0);
})().catch(e => { console.error('THẤT BẠI:', e.message); process.exit(1); });
