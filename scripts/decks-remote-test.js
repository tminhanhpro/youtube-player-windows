'use strict';
// Bước 6: điện thoại remote cho Kịch bản (bộ bài). Chạy server thật + trang web remote thật trong Chromium:
// danh sách bộ bài, xem lá bài (không lộ đường dẫn file), bấm lá bài, "kế tiếp", đặt lại, chống bấm dồn, file mất, bộ bị xoá.
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const { chromium } = require('playwright');
const { Store, Settings } = require('../main/store');
const { Controller } = require('../main/controller');
const { KaraokeServer } = require('../main/server');
const { Soundboard } = require('../main/sfx');
const { Decks } = require('../main/decks');
const { runAndMark, runNext } = require('../main/deckrun');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckr-'));
  const store = new Store(dir), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  const board = new Soundboard(store);
  const decks = new Decks(store, { sfxHas: id => !!board.get(id) });

  // "máy tính" giả: ghi lại mọi việc được chạy
  const log = [];
  const env = {
    sfx: id => (board.get(id) ? (log.push('sfx:' + id), 'ok') : 'missing'),
    localOk: f => fs.existsSync(f),
    local: { now: f => (log.push('local-now:' + path.basename(f)), 0), queue: f => (log.push('local-queue:' + path.basename(f)), 1) },
    yt: { now: c => (log.push('yt-now:' + c.videoId), 0), queue: c => (log.push('yt-queue:' + c.videoId), 1) },
    banner: b => (log.push('banner:' + b.text), true)
  };
  const decksApi = {
    list: () => decks.list(), get: id => decks.get(id), live: () => decks.getLive(), liveOf: id => decks.liveOf(id),
    play: (d, c) => runAndMark(decks, d, c, env), next: d => runNext(decks, d, env), reset: d => decks.resetPlayed(d)
  };
  const srv = new KaraokeServer({ ctl, settings, store, decksApi, webDir: path.join(__dirname, '..', 'web'), uiDir: path.join(__dirname, '..', 'renderer') });
  const port = await srv.listen(); ctl.start();
  const base = 'http://127.0.0.1:' + port;
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + settings.token, 'x-device': 'Test' };
  const j = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };

  // ---- chưa có bộ bài nào
  let r = await j('GET', '/api/decks'); assert.equal(r.s, 200); assert.deepEqual(r.b.items, []); assert.equal(r.b.active, null);

  // ---- dựng dữ liệu trên "máy tính"
  const mk = n => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return p; };
  const song = mk('don_khach_rieng_tu.mp3'), song2 = mk('van_nghe.mp3');
  const sfxAdded = board.addFiles([mk('vo_tay_bi_mat.mp3')]).added; const sfxId = sfxAdded[0].id;
  const YT = 'dQw4w9WgXcQ';
  const d1 = decks.create('Đám cưới 20/12', '💒').deck.id;
  const add = (d, src) => decks.addCard(d, src).card.id;
  const cDon = add(d1, { type: 'local', file: song, label: 'Đón khách' });
  const cEmpty = add(d1, { type: 'empty', label: 'Cắt bánh' });
  const cSfx = add(d1, { type: 'sfx', sfxId, label: 'Vỗ tay' });
  const cBanner = add(d1, { type: 'banner', banner: { text: 'Chúc mừng đám cưới BÍ MẬT', color: '#ffd54f', size: 4 }, label: 'Chào mừng' });
  const cYt = add(d1, { type: 'yt', videoId: YT, title: 'Bài mở màn', channel: 'K', durationSec: 200, label: 'Mở màn' });
  const cVan = add(d1, { type: 'local', file: song2, label: 'Văn nghệ' });
  const d2 = decks.create('Sinh nhật', '🎂').deck.id;
  const cSn = add(d2, { type: 'empty', label: 'Thổi nến' });
  const d3 = decks.create('Bộ rỗng', '📭').deck.id;
  decks.setActive(d1);

  // ---- danh sách: chỉ những trường điện thoại cần
  r = await j('GET', '/api/decks'); assert.equal(r.s, 200); assert.equal(r.b.items.length, 3); assert.equal(r.b.active, d1);
  assert.deepEqual(Object.keys(r.b.items[0]).sort(), ['count', 'icon', 'id', 'missingCount', 'name']);
  assert.equal(r.b.items[0].count, 6); assert.equal(r.b.items[0].name, 'Đám cưới 20/12'); assert.equal(r.b.items[2].count, 0);

  // ---- chi tiết một bộ: không lộ đường dẫn file, id hiệu ứng, videoId, nội dung chữ
  r = await j('GET', '/api/decks/' + d1); assert.equal(r.s, 200);
  assert.deepEqual(Object.keys(r.b).sort(), ['cards', 'icon', 'id', 'last', 'missingCount', 'name', 'next']);
  assert.equal(r.b.cards.length, 6);
  assert.deepEqual(Object.keys(r.b.cards[0]).sort(), ['icon', 'id', 'label', 'missing', 'played', 'type']);
  const raw = JSON.stringify(r.b);
  for (const secret of ['don_khach_rieng_tu', 'van_nghe', 'vo_tay_bi_mat', sfxId, YT, 'BÍ MẬT', dir.replace(/\\/g, '\\\\'), dir]) assert.ok(!raw.includes(secret), 'không được lộ: ' + secret);
  assert.deepEqual(r.b.cards.map(c => c.type), ['local', 'empty', 'sfx', 'banner', 'yt', 'local']);
  assert.equal(r.b.next, cDon, 'lá kế tiếp là lá đầu tiên dùng được'); assert.equal(r.b.last, null);
  assert.ok(r.b.cards.every(c => c.played === false));

  // ---- bộ lạ / lá lạ / đường sai
  r = await j('GET', '/api/decks/dKHONGCO123'); assert.equal(r.s, 404); assert.equal(r.b.error.code, 'DECK_MISSING');
  r = await j('POST', '/api/decks/dKHONGCO123/play', { cardId: cDon }); assert.equal(r.s, 404); assert.equal(r.b.error.code, 'DECK_MISSING');
  r = await j('POST', '/api/decks/' + d1 + '/play', { cardId: 'cKHONGCO123' }); assert.equal(r.s, 404); assert.equal(r.b.error.code, 'CARD_MISSING');
  r = await j('POST', '/api/decks/' + d1 + '/play', {}); assert.equal(r.s, 404); assert.equal(r.b.error.code, 'CARD_MISSING');
  r = await j('POST', '/api/decks/' + d1 + '/xyz', {}); assert.equal(r.s, 404);
  r = await j('GET', '/api/decks/' + d1 + '/play'); assert.equal(r.s, 404, 'play chỉ nhận POST');
  assert.deepEqual(log, [], 'các yêu cầu sai không chạy gì');

  // ---- bấm lá bài: chạy đúng loại, đánh dấu đã chạy
  r = await j('POST', '/api/decks/' + d1 + '/play', { cardId: cDon });
  assert.equal(r.s, 200); assert.equal(r.b.ok, true); assert.equal(r.b.marked, true); assert.equal(r.b.dropped, false); assert.equal(r.b.label, 'Đón khách');
  assert.deepEqual(Object.keys(r.b).sort(), ['dropped', 'label', 'marked', 'msg', 'ok', 'reason'], 'chỉ trả các trường cần thiết');
  assert.deepEqual(log, ['local-now:don_khach_rieng_tu.mp3']);
  r = await j('GET', '/api/decks/' + d1); assert.equal(r.b.cards[0].played, true); assert.equal(r.b.last, cDon); assert.equal(r.b.next, cSfx, 'kế tiếp lướt qua ô trống');
  assert.deepEqual(decks.getLive().played, [cDon], 'cửa sổ máy tính cũng thấy dấu đã chạy');
  await sleep(250);
  r = await j('POST', '/api/decks/' + d1 + '/play', { cardId: cEmpty }); assert.equal(r.s, 200); assert.equal(r.b.ok, false); assert.equal(r.b.reason, 'EMPTY'); assert.equal(r.b.marked, false);
  r = await j('POST', '/api/decks/' + d1 + '/play', { cardId: cBanner }); assert.equal(r.b.ok, true); assert.ok(log.includes('banner:Chúc mừng đám cưới BÍ MẬT'));
  r = await j('POST', '/api/decks/' + d1 + '/play', { cardId: cYt }); assert.equal(r.b.ok, true); assert.ok(log.includes('yt-now:' + YT));
  r = await j('POST', '/api/decks/' + d1 + '/play', { cardId: cSfx }); assert.equal(r.b.ok, true); assert.ok(log.includes('sfx:' + sfxId));
  // bấm lại lá đã chạy vẫn chạy được, không nhân đôi dấu (chờ qua cửa sổ chống bấm dồn 1 giây của 5 lần bấm trước)
  await sleep(1100);
  log.length = 0; r = await j('POST', '/api/decks/' + d1 + '/play', { cardId: cDon }); assert.equal(r.b.ok, true); assert.equal(log.length, 1);
  assert.equal(decks.getLive().played.filter(x => x === cDon).length, 1);

  // ---- file mất: báo lỗi, không đánh dấu, lá hiện cờ missing
  await sleep(1100);
  fs.unlinkSync(song2);
  r = await j('GET', '/api/decks/' + d1); assert.equal(r.b.cards[5].missing, true); assert.equal(r.b.missingCount, 1);
  log.length = 0; r = await j('POST', '/api/decks/' + d1 + '/play', { cardId: cVan }); assert.equal(r.b.ok, false); assert.equal(r.b.reason, 'MISSING'); assert.equal(r.b.marked, false); assert.deepEqual(log, []);
  r = await j('GET', '/api/decks'); assert.equal(r.b.items[0].missingCount, 1);

  // ---- "kế tiếp" và đặt lại
  r = await j('POST', '/api/decks/' + d1 + '/reset', {}); assert.equal(r.s, 200); assert.equal(r.b.ok, true);
  r = await j('GET', '/api/decks/' + d1); assert.ok(r.b.cards.every(c => !c.played)); assert.equal(r.b.last, null);
  log.length = 0; await sleep(600);
  r = await j('POST', '/api/decks/' + d1 + '/next', {});
  assert.equal(r.s, 200); assert.equal(r.b.ok, true); assert.equal(r.b.cardId, cDon); assert.deepEqual(r.b.skipped, []); assert.equal(r.b.left, 3); assert.equal(r.b.done, false);
  assert.deepEqual(log, ['local-now:don_khach_rieng_tu.mp3']);
  await sleep(600);
  r = await j('POST', '/api/decks/' + d1 + '/next', {});
  assert.equal(r.b.ok, true); assert.equal(r.b.cardId, cSfx); assert.deepEqual(r.b.skipped, ['Cắt bánh'], 'báo lá bị bỏ qua');
  await sleep(600); r = await j('POST', '/api/decks/' + d1 + '/next', {}); assert.equal(r.b.cardId, cBanner);
  await sleep(600); r = await j('POST', '/api/decks/' + d1 + '/next', {}); assert.equal(r.b.cardId, cYt); assert.equal(r.b.done, true, 'hết lá dùng được');
  await sleep(600); r = await j('POST', '/api/decks/' + d1 + '/next', {});
  assert.equal(r.s, 200); assert.equal(r.b.ok, false); assert.equal(r.b.done, false); assert.ok(['DONE', 'NOTHING'].includes(r.b.reason));
  // bộ chỉ có ô trống: không có gì để chạy, không bị lỗi 500
  await sleep(600); r = await j('POST', '/api/decks/' + d2 + '/next', {}); assert.equal(r.s, 200); assert.equal(r.b.ok, false); assert.equal(r.b.reason, 'NOTHING');
  await sleep(600); r = await j('POST', '/api/decks/' + d3 + '/next', {}); assert.equal(r.s, 200); assert.equal(r.b.ok, false); assert.equal(r.b.reason, 'DONE');
  r = await j('GET', '/api/decks/' + d3); assert.equal(r.s, 200); assert.deepEqual(r.b.cards, []); assert.equal(r.b.next, null);

  // ---- chống bấm dồn: tối đa 5 lần chạy mỗi giây; "kế tiếp" cách nhau ít nhất 0,5 giây
  await sleep(1100);
  log.length = 0; let dropped = 0, okN = 0;
  for (let i = 0; i < 8; i++) { const x = await j('POST', '/api/decks/' + d1 + '/play', { cardId: cDon }); if (x.b.dropped) { dropped++; assert.equal(x.b.reason, 'BUSY'); assert.equal(x.b.ok, false); } else okN++; }
  assert.equal(okN, 5); assert.equal(dropped, 3); assert.equal(log.length, 5, 'lần bị chặn không chạy gì');
  await sleep(1100);
  decks.resetPlayed(d1); log.length = 0;
  const n1 = await j('POST', '/api/decks/' + d1 + '/next', {}), n2 = await j('POST', '/api/decks/' + d1 + '/next', {});
  assert.equal(n1.b.ok, true); assert.equal(n2.b.dropped, true, 'bấm đúp "kế tiếp" không nhảy cóc một lá'); assert.equal(log.length, 1);
  await sleep(600); const n3 = await j('POST', '/api/decks/' + d1 + '/next', {}); assert.equal(n3.b.ok, true); assert.equal(n3.b.dropped, false);

  // ---- server không có decksApi thì không lộ đường này
  const srv2 = new KaraokeServer({ ctl, settings, store, webDir: path.join(__dirname, '..', 'web'), uiDir: path.join(__dirname, '..', 'renderer') });
  const port2 = await srv2.listen();
  const rr = await fetch('http://127.0.0.1:' + port2 + '/api/decks', { headers: H }); assert.equal(rr.status, 404); srv2.close();
  console.log('  API OK');

  // ================================================================ giao diện điện thoại thật
  await sleep(1100); decks.resetPlayed(d1); log.length = 0;
  const browser = await chromium.launch(), errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push(String(e)));
  await page.setExtraHTTPHeaders({ authorization: 'Bearer ' + settings.token });
  await page.goto(base + '/'); await page.waitForTimeout(800);
  const shot = n => page.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/' + n });

  assert.equal(await page.locator('#b-deck').isVisible(), true, 'có nút Kịch bản');
  assert.ok((await page.textContent('#b-deck')).trim().length > 2);
  assert.ok(await page.locator('#b-deck svg').count() === 1, 'nút có biểu tượng');
  assert.equal(await page.locator('#sheet-deck').isVisible(), false);

  // mở: có bộ đang dùng trên máy tính (d1) -> vào thẳng bộ đó
  await page.click('#b-deck'); await page.waitForTimeout(600);
  assert.equal(await page.locator('#sheet-deck').isVisible(), true);
  assert.equal(await page.locator('#k-view').isVisible(), true); assert.equal(await page.locator('#k-list').isVisible(), false);
  assert.ok((await page.textContent('#k-name')).includes('Đám cưới 20/12'));
  assert.equal(await page.locator('.kcard').count(), 6);
  assert.equal(await page.locator('.kcard.isnext').count(), 1); assert.ok((await page.textContent('.kcard.isnext')).includes('Đón khách'));
  assert.ok((await page.textContent('#k-next')).includes('Đón khách'), 'nút kế tiếp ghi tên lá sắp chạy');
  assert.equal(await page.locator('.kcard.off').count(), 2, 'ô trống và lá mất file bị mờ');
  assert.ok(await page.locator('.kcard >> nth=1').isDisabled()); assert.ok(await page.locator('.kcard >> nth=5').isDisabled());
  assert.ok(!(await page.content()).includes('don_khach_rieng_tu'), 'trang không chứa đường dẫn file');
  await shot('deck-phone1.png');

  // bấm "kế tiếp" -> chạy lá đầu, đánh dấu, nút chuyển sang lá sau
  await page.click('#k-next'); await page.waitForTimeout(600);
  assert.deepEqual(log, ['local-now:don_khach_rieng_tu.mp3']);
  assert.equal(await page.locator('.kcard.played').count(), 1);
  assert.ok((await page.textContent('#k-next')).includes('Vỗ tay'), 'lướt qua ô trống tới lá Vỗ tay');
  // bấm thẳng một lá (Mở màn)
  log.length = 0; await page.click('.kcard >> nth=4'); await page.waitForTimeout(600);
  assert.deepEqual(log, ['yt-now:' + YT]); assert.equal(await page.locator('.kcard.played').count(), 2);
  await shot('deck-phone2.png');

  // máy tính chạy một lá: điện thoại tự cập nhật dấu đã chạy (đồng bộ mỗi 3 giây)
  decks.markPlayed(d1, cBanner);
  await page.waitForFunction(() => document.querySelectorAll('.kcard.played').length === 3, null, { timeout: 6000 });

  // đặt lại: bấm một lần chỉ hỏi lại, bấm hai lần mới đặt lại
  await page.click('#k-reset'); await page.waitForTimeout(300);
  assert.equal(await page.locator('#k-reset.arm').count(), 1); assert.equal(await page.locator('.kcard.played').count(), 3, 'chưa đặt lại');
  await page.click('#k-reset'); await page.waitForTimeout(600);
  assert.equal(await page.locator('.kcard.played').count(), 0); assert.equal(await page.locator('#k-reset.arm').count(), 0);
  assert.deepEqual(decks.getLive().played, []);

  // file mất khi đang mở: đi qua máy tính xoá file của lá Đón khách -> lá bị mờ sau lần đồng bộ kế
  fs.unlinkSync(song);
  await page.waitForFunction(() => document.querySelectorAll('.kcard.off').length === 3, null, { timeout: 6000 });
  // "kế tiếp" bây giờ lướt qua lá mất file và báo đã bỏ qua
  log.length = 0; await page.click('#k-next'); await page.waitForTimeout(600);
  assert.deepEqual(log, ['sfx:' + sfxId]);
  assert.equal(await page.locator('#toast').isVisible(), true, 'có báo lá bị bỏ qua');

  // quay lại danh sách: 3 bộ, ghi số lá và số lá thiếu
  await page.click('#k-back'); await page.waitForTimeout(500);
  assert.equal(await page.locator('#k-list').isVisible(), true);
  assert.equal(await page.locator('.kdeck').count(), 3);
  assert.ok((await page.textContent('.kdeck >> nth=0')).includes('Đám cưới 20/12') && /6/.test(await page.textContent('.kdeck >> nth=0')));
  assert.ok(/2/.test(await page.textContent('.kdeck >> nth=0')), 'hiện số lá thiếu file');
  await shot('deck-phone3.png');

  // mở bộ khác, bộ rỗng báo rõ
  await page.click('.kdeck >> nth=2'); await page.waitForTimeout(500);
  assert.equal(await page.locator('#k-msg').isVisible(), true); assert.equal(await page.locator('.kcard').count(), 0);
  assert.equal(await page.locator('#k-next').isDisabled(), true); assert.equal(await page.locator('#k-reset').isVisible(), false);
  // bộ chỉ có ô trống: "kế tiếp" bị khoá
  await page.click('#k-back'); await page.click('.kdeck >> nth=1'); await page.waitForTimeout(500);
  assert.equal(await page.locator('#k-next').isDisabled(), true); assert.equal(await page.locator('.kcard.off').count(), 1);

  // đóng và mở lại: nhớ bộ vừa xem
  await page.click('#k-close'); await page.waitForTimeout(200);
  assert.equal(await page.locator('#sheet-deck').isVisible(), false);
  await page.click('#b-deck'); await page.waitForTimeout(600);
  assert.ok((await page.textContent('#k-name')).includes('Sinh nhật'), 'mở lại đúng bộ vừa xem');

  // bộ đang xem bị xoá trên máy tính: báo và quay về danh sách
  decks.removeDeck(d2);
  await page.waitForFunction(() => !document.getElementById('k-list').hidden, null, { timeout: 6000 });
  assert.equal(await page.locator('.kdeck').count(), 2);
  assert.equal(await page.locator('#toast').isVisible(), true);

  // xoá hết bộ bài: báo rõ cách tạo
  await page.click('#k-close'); decks.removeDeck(d1); decks.removeDeck(d3);
  await page.click('#b-deck'); await page.waitForTimeout(600);
  assert.equal(await page.locator('#k-empty').isVisible(), true); assert.equal(await page.locator('.kdeck').count(), 0);
  await shot('deck-phone4.png');
  await page.click('#k-close');

  // bộ sưu tập Cổ vũ / hiệu ứng cũ vẫn mở được bình thường
  await page.click('#b-react'); await page.waitForTimeout(400);
  assert.ok(await page.locator('#r-grid .rbtn').count() > 30);
  await browser.close(); srv.close();
  assert.deepEqual(errors, [], errors.join(' | '));
  console.log('decks-remote-test: OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
