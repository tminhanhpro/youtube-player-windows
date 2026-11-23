'use strict';
// Bước 6: nhãn "Đã tải" trên hàng đợi, Yêu thích, kết quả tìm kiếm (máy tính + điện thoại).
// Phần 1: dữ liệu (dlVer trong trạng thái, /api/downloaded, bài hỏng bị bỏ thì số phiên bản tăng, không lộ đường dẫn).
// Phần 2: trang điện thoại thật trong Chromium. Phần 3: cửa sổ máy tính với main-process giả.
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const { chromium } = require('playwright');
const { Store, Settings } = require('../main/store');
const { Controller } = require('../main/controller');
const { KaraokeServer } = require('../main/server');
const { DownloadLibrary } = require('../main/downloads');
const resolver = require('../main/resolver');

const A = 'AAAAAAAAAAA', B = 'BBBBBBBBBBB', C = 'CCCCCCCCCCC';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-badge-'));
  const mk = (n) => { const f = path.join(root, n); fs.writeFileSync(f, Buffer.alloc(4096, 1)); return f; };
  mk('Bài A [' + A + '].mp4');
  const lib = new DownloadLibrary(() => root); await lib.scan();

  resolver.resolve = async id => ({ sources: [{ height: 720, video: { url: 'http://x/' + id }, audio: null }], title: 'T ' + id, channel: 'K', durationSec: 200 });
  resolver.cached = () => null;

  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-badge2-'))), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'), lib);
  const srv = new KaraokeServer({ ctl, settings, store, downloadedIds: () => lib.ids(), webDir: path.join(__dirname, '..', 'web'), uiDir: path.join(__dirname, '..', 'renderer') });
  const port = await srv.listen(); ctl.start();
  const base = 'http://127.0.0.1:' + port;
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + settings.token, 'x-device': 'Test' };
  const j = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };

  // ---- phần 1: dữ liệu
  assert.deepEqual(lib.ids(), [A]);
  let r = await j('GET', '/api/downloaded'); assert.equal(r.s, 200); assert.deepEqual(r.b.ids, [A]); assert.equal(r.b.ver, ctl.dlVer);
  assert.ok(!JSON.stringify(r.b).includes(root.replace(/\\/g, '\\\\')) && !JSON.stringify(r.b).includes('.mp4'), 'không lộ đường dẫn file');
  const v0 = ctl.snapshot().dlVer; assert.equal(v0, ctl.dlVer);
  ctl.noteDownloadsChanged(); assert.equal(ctl.snapshot().dlVer, v0 + 1, 'đổi thư viện thì số phiên bản tăng');
  const vBefore = ctl.dlVer; lib.forget(A); ctl.noteDownloadsChanged(); assert.deepEqual((await j('GET', '/api/downloaded')).b.ids, []); assert.ok(ctl.dlVer > vBefore);
  await lib.scan(); ctl.noteDownloadsChanged(); assert.deepEqual((await j('GET', '/api/downloaded')).b.ids, [A], 'quét lại thì bài hiện lại');

  // ---- phần 2: trang điện thoại
  const browser = await chromium.launch(), errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push(String(e)));
  await page.setExtraHTTPHeaders({ authorization: 'Bearer ' + settings.token });
  // hàng đợi: A (đã tải) + B (chưa); Yêu thích: A và C
  ctl.add(A, 'Bài A', 'K', 200, 'Lan', 'end', true); ctl.add(B, 'Bài B', 'K', 200, 'Lan', 'end', true);
  await j('POST', '/api/favs/import', { items: [{ videoId: A, title: 'Bài A', channel: 'K' }, { videoId: C, title: 'Bài C', channel: 'K' }] });
  await page.goto(base + '/'); await page.waitForTimeout(1200);
  const badge = vid => page.locator('.thumb[data-vid="' + vid + '"]:visible').first();   // chỉ xét thẻ đang hiện (tab khác bị ẩn)
  const shown = async vid => { const l = badge(vid).locator('.dlb'); return (await l.count()) ? await l.first().isVisible() : false; };
  await page.click('#tab-queue'); await page.waitForTimeout(300);
  assert.equal(await shown(A), true, 'hàng đợi/đang phát: bài A có nhãn Đã tải');
  assert.equal(await shown(B), false, 'bài B chưa tải thì không có nhãn');
  assert.ok((await badge(A).locator('.dlb').first().textContent()).includes('Đã tải') || (await badge(A).locator('.dlb').first().textContent()).includes('Saved'));
  await page.click('#tab-favs'); await page.waitForTimeout(500);
  assert.equal(await shown(A), true, 'Yêu thích: A có nhãn'); assert.equal(await shown(C), false, 'Yêu thích: C không có nhãn');

  // tải xong thêm bài C trong lúc điện thoại đang mở: nhãn hiện ra mà không cần tải lại trang
  mk('Bài C [' + C + '].m4a'); await lib.scan(); ctl.noteDownloadsChanged();
  await page.waitForTimeout(3500);
  assert.equal(await shown(C), true, 'bài vừa tải xong hiện nhãn ngay trên điện thoại');
  // xoá file / bài hỏng: nhãn biến mất
  lib.forget(C); ctl.noteDownloadsChanged(); await page.waitForTimeout(3500);
  assert.equal(await shown(C), false, 'bài bị bỏ thì mất nhãn');
  console.log('lỗi JS điện thoại:', errors.length ? errors.join('\n') : 'không');
  await browser.close(); srv.close && srv.close();
  assert.equal(errors.length, 0);

  // ---- phần 3: cửa sổ máy tính (main-process giả)
  const b2 = await chromium.launch(), p2 = await b2.newPage({ viewport: { width: 1920, height: 1080 } }), e2 = [];
  p2.on('pageerror', e => e2.push(String(e)));
  await p2.addInitScript(() => {
    const handlers = {}; window.__calls = [];
    window.__ids = ['vidAAAAAAA1'];
    const it = (i, v, t) => ({ itemId: 'i' + i, videoId: v, title: t, channel: 'K', durationSec: 200, addedBy: 'Lan', status: 'PENDING' });
    window.__dlVer = 1;
    const snap = () => ({ state: 'IDLE', nowPlaying: null, positionMs: 0, durationMs: 0, karaoke: false, netWait: false, dlVer: window.__dlVer, queue: [it(1, 'vidAAAAAAA1', 'Bài đã tải'), it(2, 'vidBBBBBBB2', 'Bài chưa tải')] });
    const push = () => (handlers.state || []).forEach(h => h({ snap: snap(), info: { ip: '1.1.1.1', port: 8080, qr: null, host: '', remoteConnected: false, who: null, net: { text: 'Wi-Fi', icon: 'wifi' }, cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO' } }, ui: {} }));
    window.__push = push;
    const res = [{ videoId: 'vidAAAAAAA1', title: 'Kết quả A', channel: 'K', durationSec: 100 }, { videoId: 'vidCCCCCCC3', title: 'Kết quả C', channel: 'K', durationSec: 100 }];
    window.ytp = {
      on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; }, send: () => {},
      call: async (m, a) => {
        window.__calls.push([m, a]);
        if (m === 'initial') return { cats: [], favs: [], search: { version: 1, query: 'x', source: 'tv', results: res, hasMore: false, page: 0, loading: false, error: null } };
        if (m === 'dlIds') return window.__ids.slice();
        if (m === 'bannerInit') return { list: [], cur: null, colors: ['#ffffff'] };
        if (m === 'sfxList') return [];
        return null;
      }
    };
    setTimeout(push, 50); setTimeout(push, 250); setTimeout(push, 600);   // giao diện đăng ký lắng nghe sau khi đọc dữ liệu đầu, nên đẩy vài lần như các test khác
  });
  await p2.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html')); await p2.waitForTimeout(900);
  const q = p2.locator('#qlist .q');
  assert.equal(await q.count(), 2);
  assert.ok((await q.nth(0).locator('.a').textContent()).includes('⬇ Đã tải sẵn'), 'hàng đợi: bài đã tải có "⬇ Đã tải sẵn"');
  assert.ok(!(await q.nth(1).locator('.a').textContent()).includes('Đã tải sẵn'));
  assert.equal(await p2.locator('.cardv[data-vid="vidAAAAAAA1"] .dlb').isVisible(), true, 'thẻ kết quả: bài đã tải có nhãn');
  assert.equal(await p2.locator('.cardv[data-vid="vidCCCCCCC3"] .dlb').isVisible(), false);
  assert.equal((await p2.evaluate(() => window.__calls.filter(c => c[0] === 'dlIds').length)), 1, 'chỉ hỏi danh sách một lần khi số phiên bản chưa đổi');
  await p2.evaluate(() => window.__push()); await p2.waitForTimeout(200);
  assert.equal((await p2.evaluate(() => window.__calls.filter(c => c[0] === 'dlIds').length)), 1, 'trạng thái đẩy lại nhiều lần vẫn không hỏi thêm');
  // tải xong bài C: số phiên bản tăng -> nhãn hiện trên thẻ có sẵn, không dựng lại lưới
  await p2.evaluate(() => { window.__ids.push('vidCCCCCCC3'); window.__ids.push('vidBBBBBBB2'); window.__dlVer++; window.__push(); });
  await p2.waitForTimeout(300);
  assert.equal(await p2.locator('.cardv[data-vid="vidCCCCCCC3"] .dlb').isVisible(), true, 'bài mới tải xong hiện nhãn');
  assert.ok((await q.nth(1).locator('.a').textContent()).includes('⬇ Đã tải sẵn'), 'hàng đợi cập nhật theo');
  await p2.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/dl-badges-desktop.png' });
  console.log('lỗi JS máy tính:', e2.length ? e2.join('\n') : 'không');
  await b2.close(); assert.equal(e2.length, 0);
  console.log('Nhãn "Đã tải": đạt'); process.exit(0);
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
