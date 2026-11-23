'use strict';
// Bước 7: các ca lỗi ghép giữa bảng hiệu ứng thật (Soundboard), bộ bài và việc chạy lá bài (không cần Electron):
// xoá hiệu ứng đang được bộ bài dùng, file mất giữa buổi tiệc, hàng đợi đầy, nhân bản bộ rồi xoá hiệu ứng.
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const { Store } = require('../main/store');
const { Soundboard } = require('../main/sfx');
const { Decks } = require('../main/decks');
const { runCard, runAndMark, runNext, queueDeck } = require('../main/deckrun');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckedge-'));
const store = new Store(dir);
const board = new Soundboard(store);
const decks = new Decks(store, { sfxHas: id => !!board.get(id) });
const mk = n => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return p; };

const [sA, sB] = board.addFiles([mk('a.mp3'), mk('b.mp3')]).added.map(s => s.id);
const song = mk('bai.mp3');
const log = []; let queueCode = 1;
const env = {
  sfx: id => (board.get(id) ? (log.push('sfx:' + id), 'ok') : 'missing'),
  localOk: f => fs.existsSync(f),
  local: { now: f => (log.push('now'), 0), queue: f => (log.push('queue'), queueCode) },
  yt: { now: () => 0, queue: () => queueCode }, banner: () => true
};

const D = decks.create('Tiệc', '🎉').deck.id;
const add = src => decks.addCard(D, src).card.id;
const c1 = add({ type: 'sfx', sfxId: sA, label: 'Vỗ tay' });
const c2 = add({ type: 'sfx', sfxId: sB, label: 'Reo hò' });
const c3 = add({ type: 'local', file: song, label: 'Nhạc', mode: 'queue' });

// xoá hiệu ứng đang được bộ bài dùng: lá hiện missing, chạy báo MISSING và không phát gì, "kế tiếp" lướt qua
assert.equal(decks.get(D).missingCount, 0);
board.remove(sA);
assert.equal(decks.get(D).cards[0].missing, true); assert.equal(decks.get(D).missingCount, 1);
assert.equal(decks.get(D).cards[1].missing, false, 'hiệu ứng khác không bị ảnh hưởng');
let r = runAndMark(decks, D, c1, env); assert.equal(r.ok, false); assert.equal(r.reason, 'MISSING'); assert.equal(r.marked, false); assert.deepEqual(log, []);
r = runNext(decks, D, env); assert.equal(r.ok, true); assert.equal(r.cardId, c2); assert.deepEqual(r.skipped, ['Vỗ tay']);
assert.deepEqual(decks.liveOf(D).played, [c2], 'lá bị mất không bị đánh dấu là đã chạy');

// nhân bản bộ rồi xoá nốt hiệu ứng còn lại: cả hai bộ cùng báo mất, không lỗi
const copy = decks.duplicate(D).deck.id;
board.remove(sB);
for (const id of [D, copy]) assert.equal(decks.get(id).cards.filter(c => c.type === 'sfx' && c.missing).length, 2);
r = runNext(decks, D, env); assert.equal(r.cardId, c3); assert.equal(r.ok, true);
r = runNext(decks, D, env); assert.equal(r.ok, false); assert.equal(r.reason, 'NOTHING', 'còn lá nhưng đều mất file');

// file nhạc mất giữa buổi tiệc rồi có lại (cắm lại ổ đĩa): lá dùng được trở lại
decks.resetPlayed(copy); fs.renameSync(song, song + '.bak');
assert.equal(decks.get(copy).cards[2].missing, true); r = runNext(decks, copy, env); assert.equal(r.reason, 'NOTHING');
fs.renameSync(song + '.bak', song);
assert.equal(decks.get(copy).cards[2].missing, false); r = runNext(decks, copy, env); assert.equal(r.ok, true);

// hàng đợi đầy: lá không đánh dấu (còn thử lại được), nạp cả bộ báo đầy
decks.resetPlayed(copy); queueCode = 3;
r = runAndMark(decks, copy, decks.get(copy).cards[2].id, env); assert.equal(r.reason, 'FULL'); assert.equal(r.marked, false);
const q = queueDeck(decks.get(copy), env); assert.equal(q.ok, false); assert.ok(q.full >= 1 && q.msg.includes('đầy'));
queueCode = 1; r = runAndMark(decks, copy, decks.get(copy).cards[2].id, env); assert.equal(r.ok, true, 'hết đầy thì chạy lại được');

// bộ bị xoá giữa chừng
decks.removeDeck(copy);
assert.equal(runCard(decks.get(copy), 'x', env).reason, 'NO_DECK'); assert.equal(runNext(decks, copy, env).reason, 'NO_DECK');
assert.equal(decks.liveOf(copy), null);
console.log('decks-edge-test OK');
