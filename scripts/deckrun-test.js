'use strict';
// Kiểm thử "chạy lá bài kịch bản": logic từng loại lá (env giả) + chạy thật với Controller, Soundboard, Banners (không cần Electron).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Store, Settings } = require('../main/store');
const { Controller } = require('../main/controller');
const { Soundboard } = require('../main/sfx');
const { Banners } = require('../main/banner');
const { Decks } = require('../main/decks');
const { runCard, runAndMark, runNext, queueDeck, makeEnv } = require('../main/deckrun');
const L = require('../main/localfiles');
const resolver = require('../main/resolver');

const mem = () => { const m = {}; return { get: (k, d) => (m[k] === undefined ? d : m[k]), set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const YT1 = 'dQw4w9WgXcQ', YT2 = 'aqz-KE-bpKQ';

// ---------------------------------------------------------------- 1) logic với env giả
(function unit() {
  const log = [];
  const env = {
    sfx: id => { log.push('sfx:' + id); return id === 'sOk123456' ? 'ok' : id === 'sBusy1234' ? 'busy' : 'missing'; },
    localOk: f => f !== '/gone.mp3',
    local: { now: f => { log.push('l.now:' + f); return 0; }, queue: f => { log.push('l.q:' + f); return f === '/dup.mp3' ? 2 : f === '/full.mp3' ? 3 : 1; } },
    yt: { now: c => { log.push('y.now:' + c.videoId); return 0; }, queue: c => { log.push('y.q:' + c.videoId); return 1; } },
    banner: b => { log.push('b:' + b.text); return b.text !== 'LOI'; }
  };
  const deck = { id: 'dX', cards: [
    { id: 'c1', type: 'empty', label: 'Cắt bánh' },
    { id: 'c2', type: 'sfx', sfxId: 'sOk123456', label: 'Vỗ tay' },
    { id: 'c3', type: 'sfx', sfxId: 'sBusy1234', label: 'Dồn' },
    { id: 'c4', type: 'sfx', sfxId: 'sGone1234', label: 'Mất' },
    { id: 'c5', type: 'local', file: '/a.mp3', mode: 'now', label: 'Đón khách' },
    { id: 'c6', type: 'local', file: '/a.mp3', mode: 'queue', label: 'Đón khách 2' },
    { id: 'c7', type: 'local', file: '/gone.mp3', mode: 'now', label: 'Mất file' },
    { id: 'c8', type: 'local', file: '/dup.mp3', mode: 'queue', label: 'Trùng' },
    { id: 'c9', type: 'local', file: '/full.mp3', mode: 'queue', label: 'Đầy' },
    { id: 'c10', type: 'yt', videoId: YT1, mode: 'now', label: 'Y now' },
    { id: 'c11', type: 'yt', videoId: YT2, mode: 'queue', label: 'Y queue' },
    { id: 'c12', type: 'banner', banner: { text: 'Chúc mừng' }, label: 'Chữ' },
    { id: 'c13', type: 'banner', banner: { text: 'LOI' }, label: 'Chữ lỗi' }
  ] };
  const run = id => runCard(deck, id, env);
  let r = run('c1'); assert.equal(r.ok, false); assert.equal(r.reason, 'EMPTY'); assert.ok(r.msg.includes('Cắt bánh')); assert.equal(log.length, 0, 'ô trống không làm gì');
  r = run('c2'); assert.deepEqual([r.ok, r.action], [true, 'sfx']);
  assert.equal(run('c3').reason, 'BUSY'); assert.equal(run('c4').reason, 'MISSING');
  r = run('c5'); assert.deepEqual([r.ok, r.action, r.msg], [true, 'played', 'Đang phát: Đón khách']); assert.equal(log.at(-1), 'l.now:/a.mp3');
  r = run('c6'); assert.deepEqual([r.ok, r.action], [true, 'queued']); assert.equal(log.at(-1), 'l.q:/a.mp3');
  const n = log.length; assert.equal(run('c7').reason, 'MISSING'); assert.equal(log.length, n, 'file mất thì không gọi phát');
  assert.equal(run('c8').reason, 'DUP'); assert.equal(run('c9').reason, 'FULL');
  assert.equal(run('c10').action, 'played'); assert.equal(log.at(-1), 'y.now:' + YT1);
  assert.equal(run('c11').action, 'queued'); assert.equal(log.at(-1), 'y.q:' + YT2);
  assert.equal(run('c12').action, 'banner'); assert.equal(run('c13').reason, 'FAILED');
  assert.equal(run('nope').reason, 'NO_CARD'); assert.equal(runCard(null, 'c1', env).reason, 'NO_DECK');
  assert.equal(runCard(deck, 'c5', { ...env, local: { now() { throw new Error('boom'); } } }).reason, 'FAILED', 'lỗi bất ngờ không làm sập');

  // nạp cả bộ
  log.length = 0;
  const q = queueDeck(deck, env);
  assert.deepEqual(log, ['l.q:/a.mp3', 'l.q:/dup.mp3', 'l.q:/full.mp3'],
    'chỉ nhạc trong máy và YouTube, đúng thứ tự lá bài; bài lặp trong bộ chỉ gọi một lần; hiệu ứng, chữ, ô trống bị bỏ qua; đến lá làm đầy hàng đợi thì dừng gọi');
  assert.equal(q.total, 7); assert.equal(q.added, 1);
  assert.equal(q.dup, 2, 'lá lặp lại trong bộ + bài đã có sẵn'); assert.equal(q.missing, 1); assert.equal(q.empty, 1); assert.equal(q.skipped, 5);
  assert.equal(q.full, 3, 'gặp đầy thì các bài còn lại không gọi nữa');
  assert.equal(queueDeck(null, env).ok, false);
  const none = queueDeck({ cards: [{ id: 'c1', type: 'empty', label: 'x' }] }, env);
  assert.equal(none.ok, false); assert.ok(none.msg.includes('chưa có bài nhạc'));
})();
console.log('  logic lá bài OK');

// ---------------------------------------------------------------- 1b) chạy lá kế tiếp + đánh dấu đã chạy (bước 5)
(function liveUnit() {
  const log = [], tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-live-'));
  const F_DUP = path.join(tmp, 'dup.mp3'), F_FULL = path.join(tmp, 'full.mp3'), F_BOOM = path.join(tmp, 'boom.mp3');
  for (const f of [F_DUP, F_FULL, F_BOOM]) fs.writeFileSync(f, 'x');
  const env = {
    sfx: id => (id === 'sBusy1234' ? 'busy' : 'ok'), localOk: () => true,
    local: { now: f => { log.push('l.now:' + f); return 0; }, queue: f => { log.push('l.q:' + f); return f === F_DUP ? 2 : f === F_FULL ? 3 : 1; } },
    yt: { now: () => 0, queue: () => 1 }, banner: b => b.text !== 'LOI'
  };
  const ds = new Decks(mem(), { sfxHas: id => id !== 'sGone1234' });
  const D = ds.create('Tiệc').deck.id, add = src => ds.addCard(D, src).card.id;
  const e1 = add({ type: 'empty', label: 'Đón khách' });
  const a = add({ type: 'banner', banner: { text: 'Chào' }, label: 'Chào mừng' });
  const busy = add({ type: 'sfx', sfxId: 'sBusy1234', label: 'Dồn' });
  const gone = add({ type: 'sfx', sfxId: 'sGone1234', label: 'Mất' });
  const dup = add({ type: 'local', file: F_DUP, mode: 'queue', label: 'Trùng' });
  const full = add({ type: 'local', file: F_FULL, mode: 'queue', label: 'Đầy' });
  const bad = add({ type: 'banner', banner: { text: 'LOI' }, label: 'Chữ lỗi' });
  const last = add({ type: 'banner', banner: { text: 'Cuối' }, label: 'Cuối' });
  ds.setActive(D);
  const play = id => ds.getLive().played.includes(id);

  // 1) ô trống ở đầu bị bỏ qua và nói rõ; lá chạy được thì được đánh dấu
  let r = runNext(ds, D, env);
  assert.deepEqual([r.ok, r.cardId, r.marked, r.skipped, r.left], [true, a, true, ['Đón khách'], 5], JSON.stringify(r));
  assert.ok(r.msg.includes('Đã hiện chữ: Chào mừng') && r.msg.includes('bỏ qua 1 lá') && r.msg.includes('Đón khách'), r.msg); assert.ok(play(a));
  // 2) bấm dồn: không đánh dấu, bấm lại vẫn là lá đó (không bị kẹt vì không bị bỏ qua)
  r = runNext(ds, D, env); assert.deepEqual([r.ok, r.reason, r.cardId, r.marked], [false, 'BUSY', busy, false]); assert.ok(!play(busy));
  assert.equal(runNext(ds, D, env).cardId, busy, 'lỗi tạm thời thì lần sau vẫn thử lại đúng lá đó');
  env.sfx = () => 'ok';
  r = runNext(ds, D, env); assert.deepEqual([r.ok, r.cardId, r.marked, r.skipped], [true, busy, true, []]); assert.ok(play(busy));
  // 3) lá mất hiệu ứng bị bỏ qua tự động; nhạc đã có trong hàng đợi (DUP) coi như xong, không kẹt
  r = runNext(ds, D, env); assert.deepEqual([r.ok, r.reason, r.cardId, r.marked, r.skipped], [false, 'DUP', dup, true, ['Mất']]); assert.ok(play(dup));
  // 4) hàng đợi đầy: không đánh dấu, báo lỗi, còn thử lại được
  r = runNext(ds, D, env); assert.deepEqual([r.reason, r.cardId, r.marked], ['FULL', full, false]); assert.ok(!play(full));
  env.local.queue = f => { log.push('l.q:' + f); return 1; };
  r = runNext(ds, D, env); assert.deepEqual([r.ok, r.cardId, r.marked], [true, full, true]);
  // 5) lá lỗi (chữ không hiện được) không đánh dấu; lá khác vẫn bấm trực tiếp được
  r = runNext(ds, D, env); assert.deepEqual([r.reason, r.cardId, r.marked], ['FAILED', bad, false]);
  r = runAndMark(ds, D, last, env); assert.deepEqual([r.ok, r.marked], [true, true], 'bấm thẳng một lá cũng được đánh dấu');
  assert.deepEqual(ds.getLive().played.includes(last), true);
  assert.equal(runAndMark(ds, D, 'cKHONGCO1', env).marked, false); assert.equal(runAndMark(ds, 'dKHONGCO1', a, env).reason, 'NO_DECK');
  // 6) khi lá lỗi được chữa (hiện được) thì chạy tiếp; sau lá cuối là hết
  env.banner = () => true;
  r = runNext(ds, D, env); assert.deepEqual([r.ok, r.cardId, r.marked, r.left, r.done], [true, bad, true, 0, true], 'lá cuối cùng chạy xong thì done');
  // 7) đã chạy hết: lá ô trống / mất vẫn chưa chạy nên báo NOTHING, không phải DONE
  r = runNext(ds, D, env); assert.deepEqual([r.ok, r.reason, r.done, r.cardId], [false, 'NOTHING', false, null]); assert.ok(r.msg.includes('Đón khách') && r.msg.includes('Mất'), r.msg);
  // 8) gán nội dung cho ô trống rồi xoá lá mất: lần sau chạy ô đó, rồi mới thật sự hết
  ds.assignCard(D, e1, { type: 'banner', banner: { text: 'Đón' } }); ds.removeCard(D, gone);
  r = runNext(ds, D, env); assert.deepEqual([r.ok, r.cardId, r.left, r.done], [true, e1, 0, true]);
  r = runNext(ds, D, env); assert.deepEqual([r.ok, r.reason, r.done], [false, 'DONE', true]); assert.ok(r.msg.includes('Đặt lại'));
  // 9) đặt lại: chạy lại từ đầu
  ds.resetPlayed(D); r = runNext(ds, D, env); assert.equal(r.cardId, e1);
  // 10) bộ không có / bộ rỗng
  assert.equal(runNext(ds, 'dKHONGCO1', env).reason, 'NO_DECK');
  const E = ds.create('Rỗng').deck.id; r = runNext(ds, E, env); assert.deepEqual([r.ok, r.reason, r.done], [false, 'DONE', true]);
  // 11) lá lỗi bất ngờ không làm sập và không đánh dấu
  const F = ds.create('Lỗi').deck.id, fc = ds.addCard(F, { type: 'local', file: F_BOOM }).card.id;
  r = runNext(ds, F, { ...env, localOk: () => true, local: { now() { throw new Error('boom'); } } }); assert.deepEqual([r.reason, r.marked], ['FAILED', false]); ds.setActive(F); assert.ok(!ds.getLive().played.includes(fc));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
console.log('  chạy lá kế tiếp OK');

// ---------------------------------------------------------------- 2) chạy thật
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-deckrun-'));
  const mk = (n, data) => { const f = path.join(root, n); fs.writeFileSync(f, data || 'x'); return f; };
  const f1 = mk('01_Đón_khách.wav'), f2 = mk('02_Cắt_bánh.wav'), f3 = mk('03_Mời_rượu.wav'), clap = mk('vo_tay.mp3');
  const checkedLocal = p => (typeof p === 'string' && path.isAbsolute(p) && L.isMedia(p) && fs.existsSync(p) ? p : null);

  resolver.resolve = () => new Promise(() => {});   // YouTube không được gọi mạng thật
  resolver.meta = async () => null;

  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-deckrun2-'))), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  ctl.attachPlayer(true);
  const board = new Soundboard(mem()); const sfx = board.addFiles([clap]).added[0];
  let banner = null; const banners = new Banners(mem(), b => { banner = b; });
  let sfxPlays = 0; const playSfx = id => { if (!board.get(id)) return false; sfxPlays++; return true; };
  const env = makeEnv({ ctl, soundboard: board, banners, checkedLocal, playSfx });
  const decks = new Decks(mem(), { sfxHas: id => !!board.get(id) });
  const dk = decks.create('Đám cưới').deck.id;
  const add = src => decks.addCard(dk, src).card.id;

  const cEmpty = add({ type: 'empty', label: 'Mời rượu' });
  const cL1 = add({ type: 'local', file: f1, label: 'Đón khách' });
  const cL2 = add({ type: 'local', file: f2, label: 'Cắt bánh', mode: 'queue' });
  const cL3 = add({ type: 'local', file: f3, label: 'Mời rượu', mode: 'queue' });
  const cY1 = add({ type: 'yt', videoId: YT1, title: 'Bài YouTube một', mode: 'now' });
  const cY2 = add({ type: 'yt', videoId: YT2, title: 'Bài YouTube hai', mode: 'queue' });
  const cS = add({ type: 'sfx', sfxId: sfx.id, label: 'Vỗ tay' });
  const cB = add({ type: 'banner', banner: { text: 'Chúc mừng đám cưới\nA & B', color: '#ffd54f' }, label: 'Chào mừng' });
  const run = id => runCard(decks.get(dk), id, env);

  // hiệu ứng và chữ
  assert.deepEqual([run(cS).ok, sfxPlays], [true, 1]);
  assert.equal(run(cB).action, 'banner'); assert.equal(banner.text, 'Chúc mừng đám cưới\nA & B'); assert.equal(banners.current().color, '#ffd54f');
  fs.unlinkSync(clap); let r = run(cS);
  assert.equal(r.reason, 'MISSING', 'file hiệu ứng bị xoá thì báo thiếu, không phát'); assert.equal(sfxPlays, 1);
  assert.equal(run(cEmpty).reason, 'EMPTY');

  // nhạc trong máy: phát ngay khi đang rảnh
  r = run(cL1); assert.equal(r.action, 'played'); await sleep(30);
  assert.equal(ctl.current.local, f1); assert.equal(ctl.current.title, '01 Đón khách');
  // đang phát: lá "queue" vào hàng đợi, bấm lại thì báo đã có
  assert.equal(run(cL2).action, 'queued'); assert.equal(run(cL2).reason, 'DUP');
  assert.deepEqual(ctl.queue.map(i => i.local), [f2]);
  // "phát ngay" chen lên và chuyển bài; bài đang phát không bị nhân đôi
  r = run(cL3); assert.equal(r.action, 'queued');
  fs.writeFileSync(f3, 'x'); // vẫn còn file
  const modeNow = decks.updateCard(dk, cL3, { mode: 'now' }); assert.equal(modeNow.mode, 'now');
  r = run(cL3); assert.equal(r.action, 'played'); await sleep(30);
  assert.equal(ctl.current.local, f3, 'phát ngay đổi sang bài của lá bài'); assert.ok(!ctl.queue.some(i => i.local === f3), 'bài phát ngay rời khỏi hàng đợi');
  // file nhạc bị xoá/di chuyển
  fs.unlinkSync(f2); assert.equal(run(cL2).reason, 'MISSING');

  // YouTube: phát ngay + vào hàng đợi
  r = run(cY1); assert.equal(r.action, 'played'); await sleep(30);
  assert.equal(ctl.current.videoId, YT1); assert.equal(ctl.current.title, 'Bài YouTube một'); assert.equal(ctl.current.local, null);
  const qBefore = ctl.queue.length;
  assert.equal(run(cY2).action, 'queued'); assert.equal(ctl.queue.length, qBefore + 1); assert.equal(ctl.queue.at(-1).videoId, YT2);
  assert.equal(run(cY2).reason, 'DUP');
  assert.equal(ctl.playYoutubeNow(YT2, 'Bài YouTube hai', '', 0), 0, 'phát ngay bài đang nằm trong hàng đợi thì lấy ra từ đó'); await sleep(30);
  assert.equal(ctl.current.videoId, YT2); assert.equal(ctl.queue.filter(i => i.videoId === YT2).length, 0);
  const seeks = []; ctl.on('player', c => { if (c.type === 'seek') seeks.push(c.ms); });
  assert.equal(ctl.playYoutubeNow(YT2, 'x', '', 0), 0); await sleep(30);
  assert.equal(ctl.queue.filter(i => i.videoId === YT2).length, 0, 'bấm lại đúng bài đang phát không tạo bản sao trong hàng đợi');
  assert.deepEqual(seeks, [0], 'mà phát lại từ đầu');
  assert.equal(run(cY1).action, 'played'); await sleep(30); assert.equal(ctl.current.videoId, YT1);
  assert.equal(run(cL3).action, 'played'); await sleep(30); assert.equal(ctl.current.local, f3);
  assert.equal(run(cL3).action, 'played'); assert.equal(ctl.queue.filter(i => i.local === f3).length, 0, 'bài trong máy cũng vậy');
  assert.equal(seeks.length, 2);

  // ---- nạp cả bộ vào hàng đợi khi đang rảnh: bài đầu phát ngay, còn lại đúng thứ tự
  const ctl2 = new Controller(settings, new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-deckrun3-'))), path.join(__dirname, '..', 'main', 'seed.json'));
  ctl2.attachPlayer(true);
  const env2 = makeEnv({ ctl: ctl2, soundboard: board, banners, checkedLocal, playSfx });
  const dk2 = decks.create('Kịch bản').deck.id;
  const f4 = mk('04.wav'), f5 = mk('05.wav');
  const a2 = src => decks.addCard(dk2, src).card.id;
  a2({ type: 'empty', label: 'Ô trống' }); a2({ type: 'local', file: f4 }); a2({ type: 'banner', banner: { text: 'Hi' } });
  a2({ type: 'yt', videoId: YT1, title: 'Một' }); a2({ type: 'local', file: path.join(root, 'bien_mat.mp3') }); a2({ type: 'local', file: f5, mode: 'now' }); a2({ type: 'local', file: f4 });
  const q = queueDeck(decks.get(dk2), env2); await sleep(30);
  assert.equal(q.ok, true); assert.equal(q.played, 1); assert.equal(q.added, 2); assert.equal(q.dup, 1, 'bài lặp lại trong bộ không thêm hai lần'); assert.equal(q.missing, 1); assert.equal(q.empty, 1); assert.equal(q.skipped, 1);
  assert.equal(ctl2.current.local, f4, 'bài đầu tiên của bộ phát ngay');
  assert.deepEqual(ctl2.queue.map(i => i.local || i.videoId), [YT1, f5], 'phần còn lại theo đúng thứ tự lá bài, bỏ qua ô trống/chữ');
  assert.ok(q.msg.includes('Đã nạp 3 bài') && q.msg.includes('1 bài thiếu file') && q.msg.includes('1 ô trống'), q.msg);
  // nạp lần hai: tất cả đã có
  const q2 = queueDeck(decks.get(dk2), env2); assert.equal(q2.ok, false); assert.equal(q2.dup, 4, 'bài đang phát, bài đã trong hàng đợi và bài lặp đều tính là đã có'); assert.equal(ctl2.queue.length, 2);

  // hàng đợi đầy (200)
  const ctl3 = new Controller(settings, new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-deckrun4-'))), path.join(__dirname, '..', 'main', 'seed.json'));
  ctl3.attachPlayer(true);
  for (let i = 0; i < 201; i++) ctl3.add('Q' + String(i).padStart(10, '0'), 't', '', 0, 'TV', 'end', true);
  const env3 = makeEnv({ ctl: ctl3, soundboard: board, banners, checkedLocal, playSfx });
  const rf = runCard(decks.get(dk), cY2, env3); assert.equal(rf.reason, 'FULL'); assert.equal(rf.msg, 'Hàng đợi đã đầy');
  assert.equal(runCard(decks.get(dk), cL3, env3).reason, 'FULL', 'phát ngay khi đầy cũng báo đầy');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('deckrun-test OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
