'use strict';
const { idFor } = require('./localfiles');
/**
 * Chạy lá bài của bộ bài kịch bản. Chỉ có logic "lá bài loại nào thì làm gì" và thông báo tiếng Việt;
 * việc thật (phát nhạc, hiện chữ...) do `env` đảm nhiệm nên kiểm thử được bằng node, không cần Electron.
 *
 * env = {
 *   sfx(id)        -> 'ok' | 'missing' | 'busy'
 *   localOk(file)  -> bool                     file nhạc/video trong máy còn dùng được không
 *   local.now(file) / local.queue(file)  -> 0 phát ngay | 1 vào hàng đợi | 2 đã có | 3 đầy
 *   yt.now(card)    / yt.queue(card)     -> như trên
 *   banner(b)      -> bool
 * }
 */

const fail = (reason, msg, label) => ({ ok: false, action: null, reason, msg, label: label || '' });
const done = (action, msg, label) => ({ ok: true, action, reason: null, msg, label: label || '' });

function fromCode(code, card, label) {
  if (code === 0) return done('played', 'Đang phát: ' + label, label);
  if (code === 1) return done('queued', 'Đã thêm vào hàng đợi: ' + label, label);
  if (code === 2) return fail('DUP', '"' + label + '" đã có trong hàng đợi hoặc đang phát', label);
  return fail('FULL', 'Hàng đợi đã đầy', label);
}

/**
 * Chạy một lá bài. deck có thể null (đã bị xoá). Kết quả: { ok, action, reason, msg, label }
 *   action: 'sfx' | 'played' | 'queued' | 'banner'
 *   reason (khi ok = false): NO_DECK | NO_CARD | EMPTY | MISSING | FULL | DUP | BUSY | FAILED
 */
function runCard(deck, cardId, env) {
  if (!deck) return fail('NO_DECK', 'Bộ bài không còn');
  const card = deck.cards.find(c => c.id === String(cardId));
  if (!card) return fail('NO_CARD', 'Lá bài không còn');
  const label = card.label;
  try {
    switch (card.type) {
      case 'empty': return fail('EMPTY', 'Ô "' + label + '" chưa có nội dung', label);
      case 'sfx': {
        const r = env.sfx(card.sfxId);
        if (r === 'ok') return done('sfx', 'Hiệu ứng: ' + label, label);
        return r === 'busy' ? fail('BUSY', 'Bấm quá nhanh, thử lại', label) : fail('MISSING', 'Không tìm thấy hiệu ứng của "' + label + '"', label);
      }
      case 'local': {
        if (!env.localOk(card.file)) return fail('MISSING', 'Không tìm thấy file của "' + label + '"', label);
        return fromCode(card.mode === 'queue' ? env.local.queue(card.file) : env.local.now(card.file), card, label);
      }
      case 'yt':
        return fromCode(card.mode === 'queue' ? env.yt.queue(card) : env.yt.now(card), card, label);
      case 'banner':
        return env.banner(card.banner) ? done('banner', 'Đã hiện chữ: ' + label, label) : fail('FAILED', 'Không hiện được chữ "' + label + '"', label);
      default: return fail('FAILED', 'Lá bài không hợp lệ', label);
    }
  } catch (e) {
    return fail('FAILED', 'Không chạy được "' + label + '"', label);
  }
}

/**
 * Chạy một lá bài rồi đánh dấu "đã chạy" trong chế độ dùng. Chỉ đánh dấu khi lá thật sự chạy được,
 * hoặc khi nhạc đã có sẵn trong hàng đợi / đang phát (DUP): nội dung đó đã có mặt nên không cần chạy lại.
 * Các lỗi khác (bấm dồn, hàng đợi đầy, mất file...) không đánh dấu để còn thử lại.
 * Kết quả như runCard, thêm: marked (bool).
 */
function runAndMark(decks, deckId, cardId, env) {
  const r = runCard(decks.get(String(deckId)), cardId, env);
  r.marked = !!((r.ok || r.reason === 'DUP') && decks.markPlayed(deckId, cardId));
  return r;
}

/**
 * "Chạy lá kế tiếp" (phím Space / Enter của MC): lá đầu tiên chưa chạy và dùng được, bỏ qua ô trống và lá bị mất.
 * Kết quả như runAndMark, thêm: cardId, skipped (tên các lá bị bỏ qua phía trước), left (số lá còn lại sau lá này), done (đã hết lá).
 *   reason thêm: DONE (đã chạy hết) | NOTHING (còn lá nhưng đều là ô trống / bị mất)
 */
function runNext(decks, deckId, env) {
  const n = decks.next(String(deckId));
  if (!n) return { ...fail('NO_DECK', 'Bộ bài không còn'), marked: false, cardId: null, skipped: [], left: 0, done: false };
  const names = n.skipped.map(c => c.label);
  if (!n.card) {
    const done = names.length === 0;
    return {
      ...(done ? fail('DONE', 'Đã chạy hết các lá bài. Bấm "Đặt lại" để chạy lại từ đầu') : fail('NOTHING', 'Các lá còn lại đều là ô trống hoặc bị mất file: ' + names.slice(0, 3).join(', '))),
      marked: false, cardId: null, skipped: names, left: 0, done
    };
  }
  const r = runAndMark(decks, deckId, n.card.id, env);
  r.cardId = n.card.id; r.skipped = names; r.left = Math.max(0, n.left - (r.marked ? 1 : 0)); r.done = r.marked && r.left === 0;
  if (r.ok && names.length) r.msg += ' · bỏ qua ' + names.length + ' lá chưa dùng được (' + names.slice(0, 2).join(', ') + (names.length > 2 ? '…' : '') + ')';
  return r;
}

/**
 * Nạp cả bộ vào hàng đợi theo đúng thứ tự lá bài. Chỉ lấy lá nhạc trong máy và YouTube
 * (hiệu ứng, chữ chào mừng, ô trống bị bỏ qua). Bài đã có trong hàng đợi, đang phát, hoặc lặp lại trong chính bộ này thì chỉ thêm một lần.
 * Kết quả: { ok, total, played, added, dup, full, missing, empty, skipped, msg }
 */
function queueDeck(deck, env) {
  const out = { ok: false, total: 0, played: 0, added: 0, dup: 0, full: 0, missing: 0, empty: 0, skipped: 0, msg: '' };
  if (!deck) { out.msg = 'Bộ bài không còn'; return out; }
  let isFull = false;
  const seen = new Set();
  for (const c of deck.cards) {
    if (c.type === 'empty') { out.empty++; continue; }
    if (c.type !== 'local' && c.type !== 'yt') { out.skipped++; continue; }
    out.total++;
    if (c.type === 'local' && !env.localOk(c.file)) { out.missing++; continue; }
    const key = c.type === 'local' ? 'l:' + c.file : 'y:' + c.videoId;
    if (seen.has(key)) { out.dup++; continue; }
    seen.add(key);
    if (isFull) { out.full++; continue; }
    let code;
    try { code = c.type === 'local' ? env.local.queue(c.file) : env.yt.queue(c); } catch (e) { code = 3; }
    if (code === 0) out.played++;
    else if (code === 1) out.added++;
    else if (code === 2) out.dup++;
    else { out.full++; isFull = true; }
  }
  const nIn = out.played + out.added;
  out.ok = nIn > 0;
  const parts = [];
  if (nIn) parts.push('Đã nạp ' + nIn + ' bài vào hàng đợi' + (out.played ? ' (bài đầu phát ngay)' : ''));
  else parts.push(out.total ? 'Không nạp được bài nào' : 'Bộ bài chưa có bài nhạc nào');
  if (out.dup) parts.push(out.dup + ' bài đã có sẵn');
  if (out.missing) parts.push(out.missing + ' bài thiếu file');
  if (out.empty) parts.push(out.empty + ' ô trống');
  if (out.full) parts.push('hàng đợi đầy, bỏ ' + out.full + ' bài');
  out.msg = parts.join(' · ');
  return out;
}

/**
 * Ghép env thật từ các thành phần của app.
 * deps = { ctl, soundboard, banners, checkedLocal(p) -> đường dẫn hợp lệ hoặc null, playSfx(id) -> bool }
 */
function makeEnv(deps) {
  const { ctl, soundboard, banners, checkedLocal, playSfx } = deps;
  return {
    sfx: id => (!soundboard.get(id) ? 'missing' : playSfx(id) ? 'ok' : 'busy'),
    localOk: f => !!checkedLocal(f),
    // vào hàng đợi: bài đang phát hoặc đã nằm trong hàng đợi thì báo "đã có" (2), không thêm bản sao
    local: {
      now: f => ctl.playLocalNow(checkedLocal(f)),
      queue: f => { const p = checkedLocal(f); return ctl.pendingVideoIds().has(idFor(p)) ? 2 : ctl.addLocalFromTv(p, false); }
    },
    yt: {
      now: c => ctl.playYoutubeNow(c.videoId, c.title, c.channel, c.durationSec),
      queue: c => (ctl.pendingVideoIds().has(c.videoId) ? 2 : ctl.addFromTv(c.videoId, c.title, c.channel, c.durationSec, false))
    },
    banner: b => !!banners.show(b)
  };
}

module.exports = { runCard, runAndMark, runNext, queueDeck, makeEnv };
