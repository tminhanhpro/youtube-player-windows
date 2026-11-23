'use strict';
// Kiểm thử "Kịch bản / bộ bài" (phần lưu trữ, không cần Electron): tạo bộ, mẫu dựng sẵn, thêm/sửa/gán/xoá/sắp xếp lá bài, dữ liệu hỏng, giới hạn.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Decks, sanitizeCard, MAX_DECKS, MAX_CARDS, DEFAULT_DECK_ICON, DEFAULT_ICONS } = require('../main/decks');

const mem = () => { const m = {}; return { get: (k, d) => (m[k] === undefined ? d : m[k]), set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); }, raw: m }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decks-'));
const mk = n => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return p; };
const song = mk('don_khach.mp3'), clip = mk('clip.mp4'), txt = mk('ghi_chu.txt');
const YT = 'dQw4w9WgXcQ';

const store = mem();
const sfxLive = new Set(['sAbc12345']);
const dk = new Decks(store, { sfxHas: id => sfxLive.has(id) });
assert.deepEqual(dk.list(), [], 'ban đầu trống');

// ---- bộ bài
let r = dk.create('  Đám   cưới  A&B ', '💒xyz');
assert.equal(r.reason, null); assert.equal(r.deck.name, 'Đám cưới A&B', 'gộp khoảng trắng');
assert.equal(Array.from(r.deck.icon).length, 2, 'icon tối đa 2 ký tự'); assert.deepEqual(r.deck.cards, []);
const d1 = r.deck.id;
assert.equal(dk.create('', '').deck.name, 'Bộ bài', 'tên rỗng thì dùng tên mặc định');
assert.equal(dk.list()[1].icon, DEFAULT_DECK_ICON);
assert.equal(dk.create('a'.repeat(99)).deck.name.length, 40);
const d2 = dk.list()[1].id, d3 = dk.list()[2].id;

// ---- thêm lá bài: đủ 5 loại, nội dung hợp lệ
const add = src => dk.addCard(d1, src);
let c = add({ type: 'local', file: song, label: '  Đón  khách ' });
assert.equal(c.reason, null); assert.equal(c.card.label, 'Đón khách'); assert.equal(c.card.mode, 'now'); assert.equal(c.card.icon, DEFAULT_ICONS.local);
assert.equal(c.card.missing, false);
assert.ok(/^c[A-Za-z0-9_-]{4,14}$/.test(c.card.id));
const cLocal = c.card.id;
assert.equal(add({ type: 'local', file: clip }).card.label, 'clip', 'video trong máy cũng được, tên lấy từ file');
assert.equal(add({ type: 'local', file: txt }).reason, 'INVALID', 'sai định dạng');
assert.equal(add({ type: 'local', file: 'rel/x.mp3' }).reason, 'INVALID', 'đường dẫn tương đối');
assert.equal(add({ type: 'local' }).reason, 'INVALID');

c = add({ type: 'yt', videoId: YT, title: 'Bài  hát   hay', channel: 'Kênh', durationSec: 215.6, mode: 'queue' });
assert.equal(c.card.videoId, YT); assert.equal(c.card.label, 'Bài hát hay'); assert.equal(c.card.durationSec, 216); assert.equal(c.card.mode, 'queue');
assert.equal(add({ type: 'yt', videoId: 'abc' }).reason, 'INVALID', 'videoId sai');
assert.equal(add({ type: 'yt', videoId: YT, durationSec: -9, mode: 'bay' }).card.durationSec, 0, 'thời lượng kẹp từ 0');
assert.equal(add({ type: 'yt', videoId: YT, mode: 'bay' }).card.mode, 'now', 'mode lạ thì về now');

c = add({ type: 'sfx', sfxId: 'sAbc12345', label: 'Vỗ tay' });
assert.equal(c.card.missing, false); assert.equal(c.card.icon, DEFAULT_ICONS.sfx); assert.equal(c.card.mode, undefined, 'sfx không có mode');
assert.equal(add({ type: 'sfx', sfxId: 'bad' }).reason, 'INVALID');
const cSfx = c.card.id;

c = add({ type: 'banner', banner: { text: 'Chúc mừng\nA & B', color: 'đỏ', size: 99 } });
assert.equal(c.card.banner.text, 'Chúc mừng\nA & B'); assert.equal(c.card.banner.size, 5, 'chữ chào mừng dùng chung làm sạch với banner'); assert.equal(c.card.label, 'Chúc mừng');
assert.equal(add({ type: 'banner', banner: { text: '   ' } }).reason, 'INVALID', 'chữ trống không thành lá bài');

c = add({ type: 'empty', label: 'Cắt bánh' });
assert.equal(c.card.type, 'empty'); assert.equal(c.card.icon, DEFAULT_ICONS.empty); assert.equal(add({ type: 'empty' }).card.label, 'Ô trống');
const cEmpty = c.card.id;
assert.equal(add({ type: 'hack' }).reason, 'INVALID'); assert.equal(add(null).reason, 'INVALID'); assert.equal(add('x').reason, 'INVALID');
assert.equal(dk.addCard('dNOPE1234', { type: 'empty' }).reason, 'NO_DECK');

// id do app tạo, không nhận từ ngoài
const forged = dk.addCard(d1, { type: 'empty', id: 'cHACK12345' });
assert.notEqual(forged.card.id, 'cHACK12345');
dk.removeCard(d1, forged.card.id);

// cùng một bài được dùng hai lần trong một kịch bản: cho phép
const before = dk.get(d1).cards.length;
add({ type: 'local', file: song }); assert.equal(dk.get(d1).cards.length, before + 1);

// ---- thêm vào vị trí
const mid = dk.addCard(d1, { type: 'empty', label: 'Chèn' }, 1).card;
assert.equal(dk.get(d1).cards[1].id, mid.id); assert.equal(dk.addCard(d1, { type: 'empty', label: 'Cuối' }, 999).card.label, 'Cuối');
assert.equal(dk.get(d1).cards.at(-1).label, 'Cuối'); assert.equal(dk.addCard(d1, { type: 'empty', label: 'Đầu' }, -5).card.label, 'Đầu');
assert.equal(dk.get(d1).cards[0].label, 'Đầu');
for (const x of ['Đầu', 'Cuối', 'Chèn']) dk.removeCard(d1, dk.get(d1).cards.find(k => k.label === x).id);

// ---- file mất / hiệu ứng bị xoá: có cờ missing, lá bài vẫn còn
const gone = mk('se_mat.mp3'); const cGone = dk.addCard(d1, { type: 'local', file: gone }).card.id;
fs.unlinkSync(gone);
assert.equal(dk.get(d1).cards.find(k => k.id === cGone).missing, true);
sfxLive.delete('sAbc12345');
assert.equal(dk.get(d1).cards.find(k => k.id === cSfx).missing, true, 'hiệu ứng bị xoá khỏi bảng thì lá bài báo missing');
assert.equal(dk.get(d1).missingCount, 2); assert.equal(dk.list()[0].missingCount, 2);
sfxLive.add('sAbc12345'); dk.removeCard(d1, cGone);
assert.equal(dk.get(d1).missingCount, 0);
assert.equal(new Decks(store).get(d1).cards.find(k => k.id === cSfx).missing, false, 'không có sfxHas thì không báo missing');

// ---- sửa lá bài
let u = dk.updateCard(d1, cLocal, { label: '  Nhạc   đón ', icon: '🎉abc', mode: 'queue', file: '/etc/passwd', type: 'sfx', id: 'cHACK12345' });
assert.equal(u.label, 'Nhạc đón'); assert.equal(Array.from(u.icon).length, 2); assert.equal(u.mode, 'queue'); assert.equal(u.file, song, 'không đổi được file qua update'); assert.equal(u.type, 'local'); assert.equal(u.id, cLocal);
assert.equal(dk.updateCard(d1, cLocal, { icon: '' }).icon, DEFAULT_ICONS.local, 'icon rỗng = về mặc định');
assert.equal(dk.updateCard(d1, cLocal, { label: '   ' }).label, 'Nhạc đón', 'tên rỗng thì giữ tên cũ');
assert.equal(dk.updateCard(d1, cLocal, { mode: 'bay' }).mode, 'queue', 'mode lạ bị bỏ qua');
assert.equal(dk.updateCard(d1, cSfx, { mode: 'queue' }).mode, undefined, 'mode không áp dụng cho hiệu ứng');
assert.equal(dk.updateCard(d1, 'cNOPE12345', { label: 'a' }), null); assert.equal(dk.updateCard(d1, cLocal, null), null); assert.equal(dk.updateCard('dNOPE1234', cLocal, {}), null);
assert.equal(dk.updateCard(d1, cLocal, { label: 'a'.repeat(99) }).label.length, 30);

// ---- gán nội dung cho ô trống (giữ id, tên, biểu tượng)
dk.updateCard(d1, cEmpty, { icon: '🍰' });
let a = dk.assignCard(d1, cEmpty, { type: 'local', file: song });
assert.equal(a.id, cEmpty); assert.equal(a.label, 'Cắt bánh', 'giữ tên đã đặt'); assert.equal(a.icon, '🍰'); assert.equal(a.type, 'local'); assert.equal(a.file, song);
a = dk.assignCard(d1, cEmpty, { type: 'yt', videoId: YT, title: 'X' });
assert.equal(a.type, 'yt'); assert.equal(a.file, undefined, 'không còn dấu vết của nội dung cũ'); assert.equal(a.label, 'Cắt bánh');
assert.equal(dk.assignCard(d1, cEmpty, { type: 'local', file: txt }), null, 'nội dung sai thì không đổi');
assert.equal(dk.get(d1).cards.find(k => k.id === cEmpty).type, 'yt');
a = dk.assignCard(d1, cEmpty, { type: 'empty' }); assert.equal(a.type, 'empty'); assert.equal(a.videoId, undefined, 'gán empty để xoá nội dung');
assert.equal(dk.assignCard(d1, 'cNOPE12345', { type: 'empty' }), null); assert.equal(dk.assignCard('dNOPE1234', cEmpty, { type: 'empty' }), null);

// ---- sắp xếp lá bài
const ids = () => dk.get(d1).cards.map(k => k.id);
const n0 = ids().length; assert.ok(n0 >= 5);
const [i0, i1] = ids(), last = ids().at(-1);
assert.equal(dk.moveCard(d1, last, 0), true); assert.equal(ids()[0], last); assert.equal(ids().length, n0);
assert.equal(dk.moveCard(d1, last, 999), true); assert.equal(ids().at(-1), last);
assert.equal(dk.moveCard(d1, i0, 1), true); assert.equal(ids()[1], i0);
assert.equal(dk.moveCard(d1, 'cNOPE12345', 0), false); assert.equal(dk.moveCard('dNOPE1234', i0, 0), false);

// ---- xoá lá bài
assert.equal(dk.removeCard(d1, i1), true); assert.equal(dk.removeCard(d1, i1), false); assert.equal(ids().length, n0 - 1); assert.equal(dk.removeCard('dNOPE1234', i0), false);

// ---- giới hạn số lá bài
const dFull = dk.create('Đầy').deck.id;
for (let k = 0; k < MAX_CARDS; k++) assert.equal(dk.addCard(dFull, { type: 'empty' }).reason, null);
assert.equal(dk.addCard(dFull, { type: 'empty' }).reason, 'FULL'); assert.equal(dk.get(dFull).cards.length, MAX_CARDS);
dk.removeDeck(dFull);

// ---- đổi tên bộ / sắp xếp bộ / nhân bản / xoá
let ud = dk.updateDeck(d2, { name: '  Sinh   nhật  ', icon: '🎂' });
assert.equal(ud.name, 'Sinh nhật'); assert.equal(ud.icon, '🎂');
assert.equal(dk.updateDeck(d2, { name: '   ' }).name, 'Sinh nhật'); assert.equal(dk.updateDeck(d2, { icon: '' }).icon, DEFAULT_DECK_ICON);
assert.equal(dk.updateDeck('dNOPE1234', { name: 'a' }), null); assert.equal(dk.updateDeck(d2, null), null);
const dids = () => dk.list().map(x => x.id);
assert.deepEqual(dids(), [d1, d2, d3]);
assert.equal(dk.moveDeck(d3, 0), true); assert.deepEqual(dids(), [d3, d1, d2]);
assert.equal(dk.moveDeck(d3, 99), true); assert.deepEqual(dids(), [d1, d2, d3]);
assert.equal(dk.moveDeck('dNOPE1234', 0), false);

const cp = dk.duplicate(d1);
assert.equal(cp.reason, null); assert.equal(cp.deck.name, 'Đám cưới A&B (bản sao)'); assert.equal(cp.deck.cards.length, dk.get(d1).cards.length);
assert.deepEqual(dids(), [d1, cp.deck.id, d2, d3], 'bản sao nằm ngay sau bản gốc');
const orig = new Set(dk.get(d1).cards.map(k => k.id));
assert.ok(cp.deck.cards.every(k => !orig.has(k.id)), 'lá bài trong bản sao có id mới');
dk.removeCard(cp.deck.id, cp.deck.cards[0].id); assert.equal(dk.get(d1).cards.length, cp.deck.cards.length, 'sửa bản sao không ảnh hưởng bản gốc');
assert.equal(dk.duplicate('dNOPE1234').reason, 'NO_DECK');
assert.equal(dk.duplicate(dk.create('x'.repeat(40)).deck.id).deck.name.length <= 40, true, 'tên bản sao không vượt giới hạn');

assert.equal(dk.removeDeck(cp.deck.id), true); assert.equal(dk.removeDeck(cp.deck.id), false);

// ---- mẫu dựng sẵn
assert.deepEqual(Decks.templates().map(t => t.key), ['wedding', 'birthday', 'thoinoi']);
const w = dk.createFromTemplate('wedding');
assert.equal(w.reason, null); assert.equal(w.deck.name, 'Đám cưới'); assert.equal(w.deck.icon, '💒');
assert.equal(w.deck.cards.length, Decks.templates()[0].count);
assert.deepEqual(w.deck.cards.slice(0, 3).map(k => k.label), ['Đón khách', 'Chào mừng', 'Cô dâu chú rể vào']);
assert.equal(w.deck.cards[0].type, 'empty'); assert.equal(w.deck.cards[1].type, 'banner'); assert.ok(w.deck.cards[1].banner.text.includes('đám cưới'));
assert.ok(w.deck.cards.some(k => k.label === 'Cắt bánh') && w.deck.cards.some(k => k.label === 'Mời rượu'));
assert.equal(new Set(w.deck.cards.map(k => k.id)).size, w.deck.cards.length, 'id lá bài không trùng');
assert.equal(dk.createFromTemplate('birthday', 'Sinh nhật bé Na').deck.name, 'Sinh nhật bé Na');
assert.equal(dk.createFromTemplate('thoinoi').reason, null);
assert.equal(dk.createFromTemplate('nope').reason, 'NO_TEMPLATE'); assert.equal(dk.createFromTemplate('__proto__').reason, 'NO_TEMPLATE'); assert.equal(dk.createFromTemplate('toString').reason, 'NO_TEMPLATE');
// gán nhạc vào ô trống của mẫu
const slot = w.deck.cards.find(k => k.label === 'Cắt bánh');
assert.equal(dk.assignCard(w.deck.id, slot.id, { type: 'local', file: song }).label, 'Cắt bánh');

// ---- dữ liệu được lưu thật và đọc lại đúng (khởi động lại app)
const again = new Decks(store, { sfxHas: () => true });
assert.deepEqual(again.list().map(x => x.id), dk.list().map(x => x.id));
assert.equal(again.get(w.deck.id).cards.find(k => k.id === slot.id).file, song);
assert.ok(!JSON.stringify(store.raw.decks).includes('missing'), 'không lưu cờ missing xuống file');
assert.ok(store.raw.decks[0].cards.every(k => k.icon === '' || Array.from(k.icon).length <= 2), 'chỉ lưu biểu tượng tuỳ chọn, không lưu biểu tượng mặc định');
assert.ok(store.raw.decks[0].cards.filter(k => k.type === 'sfx').every(k => k.icon === ''));

// ---- dữ liệu hỏng trong file cài đặt không làm sập
const bad = mem();
bad.set('decks', [null, 5, 'x', { id: 'x' }, { id: 'dGood1234', name: '', cards: [null, { id: 'c1' }, { id: 'cOk12345', type: 'empty' }, { id: 'cOk12345', type: 'empty' }, { id: 'cBad1234', type: 'local', file: 'rel.mp3' }, { id: 'cYt12345', type: 'yt', videoId: 'zz' }, { id: 'cFine123', type: 'banner', banner: { text: 'Hi' } }] },
  { id: 'dGood1234', name: 'trùng id' }, { id: 'dNoCards1', name: 'Không có lá', cards: 'oops' }]);
const dk2 = new Decks(bad);
assert.equal(dk2.list().length, 2, 'bỏ bộ hỏng và bộ trùng id'); assert.equal(dk2.list()[0].name, 'Bộ bài'); assert.equal(dk2.list()[0].icon, DEFAULT_DECK_ICON);
assert.deepEqual(dk2.list()[0].cards.map(k => k.id), ['cOk12345', 'cFine123'], 'bỏ lá hỏng và lá trùng id, giữ thứ tự');
assert.deepEqual(dk2.list()[1].cards, []);
assert.equal(new Decks(mem()).list().length, 0); const bad2 = mem(); bad2.set('decks', { not: 'array' }); assert.deepEqual(new Decks(bad2).list(), []);
assert.equal(sanitizeCard({ id: 'cOk12345', type: 'local', file: clip }).type, 'local');
assert.equal(sanitizeCard({ id: 'bad', type: 'empty' }), null);

// ---- giới hạn số bộ bài
const many = new Decks(mem());
for (let k = 0; k < MAX_DECKS; k++) assert.equal(many.create('b' + k).reason, null);
assert.equal(many.create('thừa').reason, 'FULL'); assert.equal(many.createFromTemplate('wedding').reason, 'FULL'); assert.equal(many.duplicate(many.list()[0].id).reason, 'FULL');
assert.equal(many.list().length, MAX_DECKS);
const huge = mem(); huge.set('decks', Array.from({ length: 50 }, (_, k) => ({ id: 'dBulk' + String(k).padStart(4, '0'), name: 'n', cards: [] })));
assert.equal(new Decks(huge).list().length, MAX_DECKS, 'dữ liệu quá số lượng bị cắt khi đọc');

fs.rmSync(dir, { recursive: true, force: true });
// ---- thêm nhiều lá một lúc (bảng chọn nguồn)
{
  const s2 = mem(), k2 = new Decks(s2, { sfxHas: () => true });
  const id = k2.create('Nhiều lá').deck.id;
  let r = k2.addCards(id, [
    { type: 'local', file: song }, { type: 'yt', videoId: YT, title: 'Bài' }, { type: 'sfx', sfxId: 'sAbc12345', label: 'Vỗ tay', icon: '👏' },
    { type: 'local', file: txt }, null, { type: 'banner', banner: { text: 'Xin chào' } }]);
  assert.equal(r.reason, null); assert.equal(r.added.length, 4); assert.equal(r.skipped, 2, 'nguồn hỏng bị bỏ qua, không làm hỏng cả lô');
  assert.deepEqual(r.added.map(x => x.type), ['local', 'yt', 'sfx', 'banner'], 'giữ đúng thứ tự');
  assert.equal(r.added[2].icon, '👏', 'giữ biểu tượng của hiệu ứng');
  assert.deepEqual(k2.get(id).cards.map(x => x.id), r.added.map(x => x.id), 'đã lưu thật');
  assert.equal(k2.addCards('dNONE1234', [{ type: 'empty' }]).reason, 'NO_DECK');
  assert.deepEqual(k2.addCards(id, 'x').added, [], 'không phải mảng thì không làm gì');
  // đầy bộ: nhận đến khi đủ MAX_CARDS, phần còn lại báo full
  const many = Array.from({ length: MAX_CARDS + 5 }, (_, i) => ({ type: 'empty', label: 'Ô ' + i }));
  r = k2.addCards(id, many);
  assert.equal(r.added.length, MAX_CARDS - 4); assert.equal(r.full, 9); assert.equal(k2.get(id).cards.length, MAX_CARDS);
  assert.equal(k2.addCards(id, [{ type: 'empty' }]).full, 1, 'bộ đã đầy');
  assert.equal(k2.addCards(id, [{ type: 'empty' }]).added.length, 0);
}

// ---- lưu hàng đợi thành bộ bài
{
  const s3 = mem(), k3 = new Decks(s3);
  assert.equal(k3.createFromQueue('X', []).reason, 'EMPTY', 'hàng đợi trống');
  assert.equal(k3.createFromQueue('X', null).reason, 'EMPTY');
  assert.deepEqual(k3.list(), [], 'không tạo bộ rỗng');
  const q = [
    { videoId: YT, title: 'Bài một', channel: 'K', durationSec: 200 },
    { videoId: 'local1234ab', title: 'Nhạc vào', local: song },
    { videoId: YT, title: 'Bài một lần nữa' },                 // trùng
    { videoId: 'local1234ab', title: 'Nhạc vào', local: song }, // trùng file
    { videoId: 'sai', title: 'Hỏng' },                          // videoId sai
    { videoId: 'x', title: 'File lạ', local: txt },             // sai định dạng
    null
  ];
  const r = k3.createFromQueue('  Tiệc   tối ', q);
  assert.equal(r.reason, null); assert.equal(r.added, 2); assert.equal(r.dup, 2); assert.equal(r.skipped, 3);
  assert.equal(r.deck.name, 'Tiệc tối'); assert.equal(r.deck.icon, DEFAULT_DECK_ICON);
  assert.deepEqual(r.deck.cards.map(x => [x.type, x.label, x.mode]), [['yt', 'Bài một', 'queue'], ['local', 'Nhạc vào', 'queue']], 'đúng thứ tự, kiểu vào hàng đợi');
  assert.equal(r.deck.cards[0].durationSec, 200);
  assert.equal(r.deck.cards[1].file, song);
  assert.equal(k3.createFromQueue('', [{ videoId: YT, title: 'A' }]).deck.name, 'Hàng đợi', 'tên rỗng thì dùng tên mặc định');
  // quá nhiều bài: cắt ở MAX_CARDS, báo số bị cắt
  const big = Array.from({ length: MAX_CARDS + 7 }, (_, i) => ({ videoId: 'vid' + String(i).padStart(8, '0'), title: 'Bài ' + i }));
  const rb = k3.createFromQueue('Nhiều', big);
  assert.equal(rb.added, MAX_CARDS); assert.equal(rb.truncated, 7);
  // đầy số bộ
  const s4 = mem(), k4 = new Decks(s4);
  for (let i = 0; i < MAX_DECKS; i++) k4.create('b' + i);
  assert.equal(k4.createFromQueue('Z', [{ videoId: YT, title: 'A' }]).reason, 'FULL');
  // lá từ hàng đợi chạy được: nạp cả bộ vào hàng đợi đúng thứ tự
  const { queueDeck } = require('../main/deckrun');
  const got = [];
  const env = { localOk: () => true, local: { queue: f => { got.push('l:' + path.basename(f)); return 1; } }, yt: { queue: c => { got.push('y:' + c.videoId); return 1; } } };
  const qr = queueDeck(r.deck, env);
  assert.deepEqual(got, ['y:' + YT, 'l:don_khach.mp3']); assert.equal(qr.added, 2);
}

// ---- gán nguồn khác loại cho ô trống, giữ tên và biểu tượng đã đặt
{
  const s5 = mem(), k5 = new Decks(s5, { sfxHas: () => true });
  const t = k5.createFromTemplate('wedding').deck;
  const cut = t.cards.find(x => x.label === 'Cắt bánh');
  k5.updateCard(t.id, cut.id, { icon: '🍰' });
  const a = k5.assignCard(t.id, cut.id, { type: 'sfx', sfxId: 'sAbc12345' });
  assert.equal(a.type, 'sfx'); assert.equal(a.label, 'Cắt bánh'); assert.equal(a.icon, '🍰');
  const b = k5.assignCard(t.id, cut.id, { type: 'yt', videoId: YT, title: 'Happy' });
  assert.equal(b.type, 'yt'); assert.equal(b.sfxId, undefined, 'nội dung cũ bị thay hẳn'); assert.equal(b.label, 'Cắt bánh');
  assert.equal(k5.assignCard(t.id, cut.id, { type: 'local', file: txt }), null, 'nguồn hỏng thì giữ nguyên');
  assert.equal(k5.get(t.id).cards.find(x => x.id === cut.id).type, 'yt');
}

// ---- chế độ dùng: bộ đang dùng, lá đã chạy, lá kế tiếp (bước 5)
{
  const s6 = mem(), k6 = new Decks(s6, { sfxHas: id => id !== 'sGone1234' });
  assert.deepEqual(k6.getLive(), { deckId: null, played: [], last: null, next: null }, 'chưa chọn bộ nào');
  const A = k6.create('A').deck.id, B = k6.create('B').deck.id;
  const add = (d, src) => k6.addCard(d, src).card.id;
  const e1 = add(A, { type: 'empty', label: 'Đón khách' });
  const c1 = add(A, { type: 'banner', banner: { text: 'Chào' }, label: 'Chào mừng' });
  const gone = add(A, { type: 'sfx', sfxId: 'sGone1234', label: 'Mất hiệu ứng' });
  const c2 = add(A, { type: 'banner', banner: { text: 'Hai' }, label: 'Hai' });
  const c3 = add(A, { type: 'banner', banner: { text: 'Ba' }, label: 'Ba' });
  const b1 = add(B, { type: 'banner', banner: { text: 'B1' }, label: 'B1' });

  assert.equal(k6.setActive('dKHONGCO1'), false, 'bộ không có thì không chọn được');
  assert.equal(k6.setActive(A), true); assert.deepEqual(k6.getLive(), { deckId: A, played: [], last: null, next: c1 }, 'chưa chạy lá nào: lá kế tiếp là lá dùng được đầu tiên');
  // lá kế tiếp bỏ qua ô trống và lá bị mất, nói rõ đã bỏ qua lá nào
  let n = k6.next(A);
  assert.equal(n.card.id, c1); assert.deepEqual(n.skipped.map(x => x.id), [e1]); assert.equal(n.left, 3);
  assert.equal(k6.markPlayed(A, c1), true); assert.equal(k6.markPlayed(A, c1), true, 'đánh dấu lại không nhân đôi');
  assert.deepEqual(k6.getLive().played, [c1]);
  n = k6.next(A); assert.equal(n.card.id, c2); assert.deepEqual(n.skipped.map(x => x.id), [gone], 'chỉ báo các lá vừa lướt qua (sau lá vừa chạy), không nhắc lại ô trống ở đầu bộ'); assert.equal(n.left, 2);
  assert.equal(k6.markPlayed(A, 'cKHONGCO1'), false); assert.equal(k6.markPlayed('dKHONGCO1', c1), false);
  k6.markPlayed(A, c2); k6.markPlayed(A, c3);
  n = k6.next(A); assert.equal(n.card, null); assert.deepEqual(n.skipped.map(x => x.id), [e1, gone], 'hết lá dùng được nhưng còn ô trống / lá mất');
  // đã chạy hết hẳn: không còn gì bị bỏ qua
  k6.assignCard(A, e1, { type: 'banner', banner: { text: 'Đón' } }); k6.removeCard(A, gone); k6.markPlayed(A, e1);
  n = k6.next(A); assert.equal(n.card, null); assert.equal(n.skipped.length, 0);
  // gán nội dung cho ô trống chưa chạy thì nó thành lá kế tiếp (đúng thứ tự gốc, ở đầu bộ)
  assert.equal(k6.resetPlayed(A), true); assert.deepEqual(k6.getLive().played, []);
  assert.equal(k6.next(A).card.id, e1, 'ô trống đã gán nội dung dùng được ngay');
  // mỗi bộ có dấu riêng; đổi bộ đang dùng không làm mất dấu của bộ kia
  k6.markPlayed(A, c1); k6.markPlayed(B, b1);
  k6.setActive(B); assert.deepEqual(k6.getLive(), { deckId: B, played: [b1], last: b1, next: null });
  k6.setActive(A); assert.deepEqual(k6.getLive().played, [c1]); assert.equal(k6.getLive().next, c2);
  // lưu thật: dựng lại từ cùng kho dữ liệu (tắt mở app giữa buổi) vẫn còn
  const again = new Decks(s6); assert.deepEqual(again.getLive(), { deckId: A, played: [c1], last: c1, next: c2 });
  // xoá lá / xoá bộ thì dấu và bộ đang dùng tự biến mất
  k6.removeCard(A, c1); assert.deepEqual(k6.getLive().played, []);
  k6.markPlayed(A, c2); k6.removeDeck(A); assert.deepEqual(k6.getLive(), { deckId: null, played: [], last: null, next: null }, 'bộ đang dùng bị xoá thì ngừng dùng');
  assert.equal(k6.next(A), null);
  // nhân bản không chép dấu đã chạy; dữ liệu hỏng không làm sập
  k6.markPlayed(B, b1); const dup = k6.duplicate(B).deck; k6.setActive(dup.id); assert.deepEqual(k6.getLive().played, []);
  s6.set('decksLive', { deckId: 5, played: { [B]: 'xx', dBAD: ['c1'], [dup.id]: [null, 7, 'cKHONGCO1'] } });
  assert.deepEqual(k6.getLive(), { deckId: null, played: [], last: null, next: null });
  assert.equal(k6.setActive(''), true); assert.equal(k6.setActive(null), true);

  // đi tiếp như clicker: nhảy tới một lá phía sau thì lá kế tiếp là lá sau nó, hết bộ thì quay lại lá chưa chạy từ đầu
  {
    const s7 = mem(), k7 = new Decks(s7), D = k7.create('Clicker').deck.id;
    const [p, q, r, t] = ['P', 'Q', 'R', 'S'].map(x => k7.addCard(D, { type: 'banner', banner: { text: x }, label: x }).card.id);
    k7.setActive(D); assert.equal(k7.getLive().next, p);
    k7.markPlayed(D, r); assert.equal(k7.getLive().next, t, 'nhảy tới R rồi thì kế tiếp là S, không quay lại P, Q');
    k7.markPlayed(D, t); assert.equal(k7.getLive().next, p, 'hết bộ thì quay lại lá chưa chạy đầu tiên');
    k7.markPlayed(D, p); assert.equal(k7.getLive().next, q);
    k7.markPlayed(D, r); assert.equal(k7.getLive().next, q, 'bấm lại lá đã chạy: vị trí về lá đó, lá kế tiếp vẫn là lá chưa chạy');
    k7.markPlayed(D, q); assert.equal(k7.getLive().next, null); assert.equal(k7.next(D).left, 0);
    k7.resetPlayed(D); assert.deepEqual([k7.getLive().last, k7.getLive().next], [null, p], 'đặt lại: về đầu bộ');
  }
}

console.log('decks-test OK');
