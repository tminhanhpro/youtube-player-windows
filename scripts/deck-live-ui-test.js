'use strict';
// Mở dashboard.html trong Chromium: chế độ dùng khi diễn ra buổi tiệc (bước 5 của GĐ9).
// Phần trình duyệt là giao diện thật; phía "tiến trình chính" dùng đúng Decks + runNext/runAndMark thật (chỉ giả việc phát nhạc/chữ),
// nên kiểm được cả đường đi: phím Space → lá kế tiếp → dấu "đã chạy" → vẽ lại lưới.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { Decks } = require('../main/decks');
const { runAndMark, runNext } = require('../main/deckrun');
const SHOT = process.env.SHOT_DIR || '/tmp';

const mem = () => { const m = {}; return { get: (k, d) => (m[k] === undefined ? d : m[k]), set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };

// ---------------------------------------------------------------- "tiến trình chính" giả nhưng logic thật
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-live-ui-'));
const MP3 = path.join(tmp, 'nhac_vao.mp3'); fs.writeFileSync(MP3, 'x');
const GONE_SFX = 'sGONE0001';
const decks = new Decks(mem(), { sfxHas: id => id !== GONE_SFX });
const log = [], calls = [];
const queued = new Set();
const env = {
  sfx: id => { if (id === GONE_SFX) return 'missing'; log.push('sfx ' + id); return 'ok'; }, localOk: () => true,
  local: { now: f => { log.push('local.now ' + path.basename(f)); return 0; }, queue: f => (queued.has(f) ? 2 : (queued.add(f), log.push('local.q'), 1)) },
  yt: { now: c => { log.push('yt.now ' + c.videoId); return 0; }, queue: c => (queued.has(c.videoId) ? 2 : (queued.add(c.videoId), log.push('yt.q ' + c.videoId), 1)) },
  banner: b => { log.push('banner ' + b.text); return true; }
};
const mk = (name, cards) => { const d = decks.create(name).deck.id; for (const c of cards) decks.addCard(d, c); return d; };
const banner = (label, text) => ({ type: 'banner', label, banner: { text: text || label } });
const A = mk('Đám cưới 20/12', [
  { type: 'empty', label: 'Đón khách' }, banner('Chào mừng'), { type: 'local', label: 'Nhạc vào', file: MP3, mode: 'now' },
  { type: 'yt', label: 'Mời rượu', videoId: 'abcdefghijk', title: 'Bài mời rượu', mode: 'queue' }, { type: 'sfx', label: 'Vỗ tay', sfxId: 'sOK000001' },
  { type: 'sfx', label: 'Hiệu ứng mất', sfxId: GONE_SFX }, banner('Cắt bánh')
]);
const B = mk('Sinh nhật', [banner('Hát chúc mừng'), banner('Thổi nến')]);
const C = mk('Bộ dài', Array.from({ length: 60 }, (_, i) => banner('Lá ' + (i + 1))));

let page = null;
const emit = (ch, d) => page.evaluate(([c, x]) => window.__emit(c, x), [ch, d]);
const livePush = () => emit('decks-live', decks.getLive());
const ctl = async (m, a) => {
  calls.push([m, a]);
  switch (m) {
    case 'initial': return { cats: [], favs: [], search: { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null } };
    case 'getSettings': return { sfxDuck: false, duckLevel: 20, backend: 'AUTO', maxHeight: 720, gridCols: 3, fullscreenSec: 0, tvOutput: 'AUTO', fadeInSec: 2, fadeOutSec: 4, seedAutoplay: false, qrHidden: false, tickerMode: 'x' };
    case 'decksList': return decks.list();
    case 'decksTemplates': return Decks.templates();
    case 'deckLive': return decks.getLive();
    case 'deckSetActive': { const ok = decks.setActive(a[0]); if (ok) await livePush(); return ok; }
    case 'deckRunNext': { const r = runNext(decks, a[0], env); if (r.marked) await livePush(); return r; }
    case 'deckRunCard': { const r = runAndMark(decks, a[0], a[1], env); if (r.marked) await livePush(); return r; }
    case 'deckResetPlayed': { const ok = decks.resetPlayed(a[0]); if (ok) await livePush(); return ok; }
    case 'sfxPlay': return true;
    case 'setDuck': case 'fadeOut': return 'start';
    default: return null;
  }
};

const MOCK = () => {
  const handlers = {};
  window.__emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
  const state = () => window.__emit('state', { snap: { state: 'IDLE', nowPlaying: null, positionMs: 0, durationMs: 0, karaoke: false, netWait: false, queue: [] }, info: { ip: '192.168.1.5', port: 8080, qr: null, host: '', remoteConnected: true, who: null, net: { text: 'Wi-Fi', icon: 'wifi' }, cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO' } }, ui: {} });
  window.ytp = {
    on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; },
    send: () => {}, pathFor: () => '',
    call: (m, a) => window.__ctl(m, a || [])
  };
  setTimeout(state, 50); setTimeout(state, 250);
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => { errors.push(String(e)); console.log('PAGEERR', String(e)); });
  await page.exposeFunction('__ctl', ctl);
  await page.addInitScript(MOCK);
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  await page.waitForTimeout(700);
  const wait = ms => page.waitForTimeout(ms || 200);
  const called = m => calls.filter(c => c[0] === m);
  const visible = sel => page.locator(sel).isVisible();
  const stat = () => page.textContent('.kdlg .bstat');
  const prog = () => page.textContent('.klive .lvprog');
  const nextText = () => page.textContent('.klive .lvnext');
  const tile = label => page.locator('.lvcard', { has: page.locator('.lvcn', { hasText: new RegExp('^' + label + '$') }) });
  const cls = async label => (await tile(label).getAttribute('class')).split(/\s+/);
  const tiles = () => page.$$eval('.lvcard .lvcn', els => els.map(e => e.textContent));
  const open = async () => { await page.click('#t-deck'); await wait(400); };
  const closeDlg = async () => { await page.keyboard.press('Escape'); await wait(); };

  // ---- 1) chưa chọn bộ dùng: mở ra là màn hình quản lý như cũ
  await open();
  assert.equal(await visible('.kmanage'), true); assert.equal(await visible('.klive'), false);
  assert.equal(await page.locator('.krow .kact').count(), 0, 'chưa có bộ nào đang dùng');
  assert.equal(await page.textContent('[data-k="duse"]'), '▶ Dùng bộ này');
  await page.click('.krow[data-id="' + C + '"] .kname'); await wait();
  assert.equal(await page.locator('.krow.sel [data-k="duse"], [data-k="duse"]').first().isDisabled(), false);
  await page.click('.krow[data-id="' + A + '"] .kname'); await wait();

  // ---- 2) vào chế độ dùng
  await page.click('[data-k="duse"]'); await wait(300);
  assert.equal(await visible('.klive'), true); assert.equal(await visible('.kmanage'), false, 'màn hình quản lý ẩn đi');
  assert.equal(await page.textContent('.lvtitle'), 'Đám cưới 20/12');
  assert.equal(await prog(), '0 / 7 lá đã chạy');
  assert.deepEqual(await tiles(), ['Đón khách', 'Chào mừng', 'Nhạc vào', 'Mời rượu', 'Vỗ tay', 'Hiệu ứng mất', 'Cắt bánh'], 'lưới đúng thứ tự lá bài');
  assert.ok((await nextText()).includes('Chào mừng') && (await nextText()).includes('KẾ TIẾP'), 'lá kế tiếp bỏ qua ô trống: ' + await nextText());
  assert.ok((await cls('Chào mừng')).includes('next')); assert.ok((await cls('Đón khách')).includes('none')); assert.ok((await cls('Hiệu ứng mất')).includes('miss'));
  assert.equal(await page.textContent('.lvcard.none .lvck'), 'Chưa gán nội dung'); assert.equal(await page.textContent('.lvcard.miss .lvck'), 'Bị mất');
  assert.equal(await tile('Mời rượu').locator('.lvck').textContent(), 'YouTube · vào hàng đợi'); assert.equal(await tile('Nhạc vào').locator('.lvck').textContent(), 'Nhạc trong máy · phát ngay');
  assert.equal(await page.evaluate(() => document.activeElement.className.includes('kdlg')), true, 'focus ở cửa sổ, không ở nút nào: Space dùng được ngay');
  assert.ok((await stat()).includes('Space hoặc Enter'), 'có dòng hướng dẫn phím');
  await page.screenshot({ path: SHOT + '/deck-live.png' });

  // ---- 3) Space / Enter chạy lá kế tiếp
  await page.keyboard.press('Space'); await wait();
  assert.deepEqual(log.slice(-1), ['banner Chào mừng']);
  assert.equal(await prog(), '1 / 7 lá đã chạy'); assert.ok((await cls('Chào mừng')).includes('done')); assert.ok((await cls('Chào mừng')).includes('last'));
  assert.ok((await stat()).includes('Đã hiện chữ: Chào mừng') && (await stat()).includes('bỏ qua 1 lá') && (await stat()).includes('Đón khách'), await stat());
  assert.equal(await page.getAttribute('.bstat', 'class'), 'bstat lv-ok');
  assert.ok((await cls('Nhạc vào')).includes('next') && (await nextText()).includes('Nhạc vào'));
  await page.keyboard.press('Enter'); await wait();
  assert.deepEqual(log.slice(-1), ['local.now nhac_vao.mp3']); assert.equal(await prog(), '2 / 7 lá đã chạy');
  assert.ok((await stat()).includes('Đang phát: Nhạc vào') && !(await stat()).includes('bỏ qua'), 'không nhắc lại ô trống ở đầu bộ: ' + await stat());

  // ---- 4) bấm thẳng một lá (nhảy cóc): lá kế tiếp là lá sau nó; chuột không giữ focus nên Space vẫn là "kế tiếp"
  const nRunCard = called('deckRunCard').length, nRunNext = called('deckRunNext').length;
  await tile('Vỗ tay').click(); await wait();
  assert.equal(called('deckRunCard').length, nRunCard + 1); assert.deepEqual(log.slice(-1), ['sfx sOK000001']); assert.ok((await cls('Vỗ tay')).includes('done'));
  assert.equal(await page.evaluate(() => /lvcard|lvnext/.test(document.activeElement.className)), false, 'bấm chuột không để focus lại trên nút');
  assert.ok((await cls('Cắt bánh')).includes('next'), 'sau lá vừa bấm là Cắt bánh (bỏ qua lá mất)');
  await page.keyboard.press('Space'); await wait();
  assert.equal(called('deckRunNext').length, nRunNext + 1, 'Space chạy lá kế tiếp, không chạy lại lá vừa bấm');
  assert.deepEqual(log.slice(-1), ['banner Cắt bánh']); assert.ok((await stat()).includes('bỏ qua 1 lá') && (await stat()).includes('Hiệu ứng mất'), await stat());
  // hết bộ thì quay lại lá chưa chạy từ đầu (Mời rượu)
  assert.ok((await cls('Mời rượu')).includes('next'));
  await page.keyboard.press('Space'); await wait();
  assert.deepEqual(log.slice(-1), ['yt.q abcdefghijk']); assert.ok((await stat()).includes('Đã thêm vào hàng đợi: Mời rượu'));
  assert.equal(await prog(), '5 / 7 lá đã chạy');
  // còn ô trống + lá mất: nút kế tiếp tắt, báo rõ, Space báo lỗi màu đỏ và không chạy gì
  assert.equal(await page.locator('.lvnext').isDisabled(), true); assert.ok((await nextText()).includes('Còn 2 lá chưa dùng được'), await nextText());
  const logN = log.length;
  await page.keyboard.press('Space'); await wait();
  assert.equal(log.length, logN); assert.equal(await page.getAttribute('.bstat', 'class'), 'bstat lv-bad'); assert.ok((await stat()).includes('ô trống hoặc bị mất file'), await stat());
  // bấm lá mất / ô trống: báo lỗi, không đánh dấu
  await tile('Hiệu ứng mất').click(); await wait(); assert.ok((await stat()).includes('Không tìm thấy hiệu ứng'), await stat()); assert.ok(!(await cls('Hiệu ứng mất')).includes('done'));
  await tile('Đón khách').click(); await wait(); assert.ok((await stat()).includes('chưa có nội dung')); assert.equal(await prog(), '5 / 7 lá đã chạy');
  // bấm lại lá đã chạy (nhạc đang phát ngay → chạy lại), không nhân đôi dấu
  await tile('Nhạc vào').click(); await wait(); assert.deepEqual(log.slice(-1), ['local.now nhac_vao.mp3']); assert.equal(await prog(), '5 / 7 lá đã chạy');
  // bấm lại lá vào hàng đợi đã có: báo "đã có" (màu vàng) nhưng vẫn coi là xong
  await tile('Mời rượu').click(); await wait(); assert.ok((await stat()).includes('đã có trong hàng đợi')); assert.equal(await page.getAttribute('.bstat', 'class'), 'bstat lv-info');

  // ---- 5) phím 1–9, M, O vẫn dùng được khi cửa sổ che màn hình chính
  await emit('sfx-list', [{ id: 'sOK000001', name: 'Vỗ tay', icon: '👏', missing: false }]);
  await page.keyboard.press('1'); await wait(); assert.equal(called('sfxPlay').length, 1, 'phím 1 phát hiệu ứng số 1');
  await page.keyboard.down('m'); await wait(60); await page.keyboard.up('m'); await wait();
  assert.ok(called('setDuck').length >= 1, 'phím M hạ nhạc cho MC');
  await page.keyboard.press('o'); await wait(); assert.equal(called('fadeOut').length, 1, 'phím O tắt dần');
  assert.equal(await page.locator('.toast').isVisible(), true, 'thông báo phím nổi lên trên cửa sổ');

  // ---- 6) đặt lại (bấm 2 lần)
  await page.click('[data-k="lvreset"]'); await wait(100);
  assert.equal(await page.textContent('[data-k="lvreset"]'), 'Đặt lại?'); assert.equal(await prog(), '5 / 7 lá đã chạy', 'bấm một lần chưa xoá');
  await page.click('[data-k="lvreset"]'); await wait();
  assert.equal(await prog(), '0 / 7 lá đã chạy'); assert.equal(await page.locator('.lvcard.done').count(), 0); assert.ok((await nextText()).includes('Chào mừng'), 'đặt lại về lá đầu');
  assert.ok((await stat()).includes('Đã đặt lại'));
  assert.equal(await page.locator('[data-k="lvreset"]').isDisabled(), true, 'chưa chạy lá nào thì không cần đặt lại');
  // bấm nút bằng chuột không giữ focus: Space ngay sau đó vẫn là "kế tiếp"
  const nn = called('deckRunNext').length; await page.keyboard.press('Space'); await wait(); assert.equal(called('deckRunNext').length, nn + 1);

  // ---- 7) đóng rồi mở lại: vào thẳng chế độ dùng, dấu đã chạy còn nguyên
  await closeDlg(); assert.equal(await page.locator('.kdlg').count(), 0);
  await open();
  assert.equal(await visible('.klive'), true, 'mở ra là dùng'); assert.equal(await prog(), '1 / 7 lá đã chạy');
  await page.keyboard.press('Space'); await wait(); assert.equal(await prog(), '2 / 7 lá đã chạy', 'Space chạy được ngay sau khi mở, không cần bấm gì');

  // ---- 8) chuyển giữa các bộ: dấu đã chạy giữ riêng từng bộ
  assert.equal(await page.locator('.lvsel option').count(), 3);
  await page.selectOption('.lvsel', B); await wait(300);
  assert.equal(await page.textContent('.lvtitle'), 'Sinh nhật'); assert.equal(await prog(), '0 / 2 lá đã chạy');
  await page.keyboard.press('Space'); await wait(); assert.equal(await prog(), '1 / 2 lá đã chạy', 'sau khi đổi bộ, Space chạy ngay (focus đã về cửa sổ)');
  await page.selectOption('.lvsel', A); await wait(300);
  assert.equal(await prog(), '2 / 7 lá đã chạy', 'quay lại bộ cũ vẫn còn dấu');

  // ---- 9) chỉnh sửa rồi quay lại; ngừng dùng
  await page.click('[data-k="lvedit"]'); await wait();
  assert.equal(await visible('.kmanage'), true); assert.equal(await visible('.klive'), false);
  assert.equal(await page.locator('.krow.sel .kact').count(), 1, 'bộ đang dùng có dấu ▶'); assert.equal(await page.textContent('[data-k="duse"]'), '▶ Mở chế độ dùng');
  assert.equal(await page.inputValue('[data-k="dname"]'), 'Đám cưới 20/12', 'chỉnh sửa đúng bộ đang dùng');
  await page.click('[data-k="duse"]'); await wait(); assert.equal(await visible('.klive'), true); assert.equal(await prog(), '2 / 7 lá đã chạy');
  await page.click('[data-k="lvstop"]'); await wait();
  assert.equal(await visible('.kmanage'), true); assert.equal(decks.getLive().deckId, null);
  await closeDlg(); await open(); assert.equal(await visible('.kmanage'), true, 'ngừng dùng rồi thì mở ra là màn hình quản lý');
  await closeDlg();
  decks.setActive(A); // dấu đã chạy của bộ A vẫn giữ sau khi ngừng dùng
  assert.deepEqual(decks.getLive().played.length, 2);

  // ---- 10) bộ đang dùng bị xoá từ nơi khác: tự về màn hình quản lý, không lỗi
  await open(); assert.equal(await visible('.klive'), true);
  decks.removeDeck(A); await emit('decks-list', decks.list()); await livePush(); await wait(300);
  assert.equal(await visible('.kmanage'), true); assert.equal(await visible('.klive'), false);
  assert.deepEqual(await page.$$eval('.krow .kname', els => els.map(e => e.textContent)), ['Sinh nhật', 'Bộ dài']);
  await closeDlg();

  // ---- 11) bộ dài: lá kế tiếp ở xa được cuộn vào tầm nhìn; lưới cuộn riêng, nút Kế tiếp luôn thấy
  for (const c of decks.get(C).cards.slice(0, 49)) decks.markPlayed(C, c.id);
  decks.setActive(C);
  await open(); await wait(300);
  assert.equal(await prog(), '49 / 60 lá đã chạy'); assert.ok((await nextText()).includes('Lá 50'));
  const pos = await page.evaluate(() => { const g = document.querySelector('.lvgrid').getBoundingClientRect(), n = document.querySelector('.lvcard.next').getBoundingClientRect(), b = document.querySelector('.lvnext').getBoundingClientRect(); return { gt: g.top, gb: g.bottom, nt: n.top, nb: n.bottom, bb: b.bottom, h: innerHeight, scroll: document.querySelector('.lvgrid').scrollTop }; });
  assert.ok(pos.scroll > 0 && pos.nt >= pos.gt - 1 && pos.nb <= pos.gb + 1, 'lá kế tiếp nằm trong khung cuộn: ' + JSON.stringify(pos));
  assert.ok(pos.gb < pos.h, 'lưới không tràn khỏi màn hình');
  const before = pos.scroll; await page.keyboard.press('Space'); await wait();
  assert.equal(await page.evaluate(() => document.querySelector('.lvgrid').scrollTop) >= before - 2, true, 'chạy xong không bị cuộn giật về đầu');
  await page.screenshot({ path: SHOT + '/deck-live-long.png' });
  await closeDlg();

  assert.deepEqual(errors, [], 'không có lỗi trong trang: ' + errors.join('\n'));
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('deck-live-ui-test: ok');
})().catch(e => { console.error(e); process.exit(1); });
