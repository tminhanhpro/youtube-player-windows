'use strict';
/**
 * Kịch bản = nhiều "bộ bài" (mỗi buổi tiệc một bộ), mỗi bộ có nhiều "lá bài" xếp theo thứ tự.
 * Lá bài thuộc một trong 5 loại:
 *   sfx    – hiệu ứng âm thanh riêng (chỉ lưu id, nội dung nằm ở bảng hiệu ứng)
 *   local  – nhạc / video trong máy (đường dẫn tuyệt đối)
 *   yt     – bài YouTube (videoId + tiêu đề để hiện khi chưa có mạng)
 *   banner – chữ chào mừng (lưu nguyên nội dung chữ)
 *   empty  – ô trống có tên, chờ gán nhạc sau (dùng cho mẫu dựng sẵn)
 * Lo phần LƯU TRỮ và KIỂM TRA DỮ LIỆU, và nhớ chế độ dùng khi diễn ra buổi tiệc (bộ đang dùng, lá đã chạy, lá kế tiếp).
 * Việc chạy lá bài nằm ở deckrun.js, giao diện ở renderer/dashboard.js.
 * Không phụ thuộc Electron nên kiểm thử được bằng node.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { clean, ID_RE } = require('./util');
const { kindOf, titleOf } = require('./localfiles');
const { sanitize: sanitizeBanner } = require('./banner');

const KEY = 'decks';
const LIVE_KEY = 'decksLive'; // chế độ dùng khi diễn ra buổi tiệc: { deckId, played: { [deckId]: [cardId] }, last: { [deckId]: cardId } }
const MAX_DECKS = 30;
const MAX_CARDS = 60;
const MAX_DECK_NAME = 40;
const MAX_LABEL = 30;
const DEFAULT_DECK_ICON = '🎬';
const DEFAULT_ICONS = { sfx: '🔊', local: '🎵', yt: '📺', banner: '💬', empty: '➕' };
const MODES = ['now', 'queue']; // nhạc: phát ngay hay chỉ thêm vào hàng đợi
const SFX_ID_OK = /^s[A-Za-z0-9_-]{4,14}$/;
const DECK_ID_OK = /^d[A-Za-z0-9_-]{4,14}$/;
const CARD_ID_OK = /^c[A-Za-z0-9_-]{4,14}$/;

const newDeckId = () => 'd' + crypto.randomBytes(6).toString('base64url');
const newCardId = () => 'c' + crypto.randomBytes(6).toString('base64url');

/** Biểu tượng tuỳ chọn: tối đa 2 ký tự; rỗng = dùng biểu tượng mặc định theo loại. */
function customIcon(v) { return Array.from(String(v == null ? '' : v).trim()).slice(0, 2).join(''); }

function fileExists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function isMediaPath(p) { return typeof p === 'string' && path.isAbsolute(p) && kindOf(p) !== null; }
const cleanMode = m => (MODES.includes(m) ? m : 'now');

/** Phần "nội dung" của lá bài (loại + tham chiếu). Trả về null nếu không hợp lệ. */
function parseRef(o) {
  if (!o || typeof o !== 'object') return null;
  switch (o.type) {
    case 'empty': return { type: 'empty' };
    case 'sfx': {
      const id = String(o.sfxId == null ? '' : o.sfxId);
      return SFX_ID_OK.test(id) ? { type: 'sfx', sfxId: id } : null;
    }
    case 'local':
      return isMediaPath(o.file) ? { type: 'local', file: o.file, mode: cleanMode(o.mode) } : null;
    case 'yt': {
      const v = String(o.videoId == null ? '' : o.videoId);
      if (!ID_RE.test(v)) return null;
      const d = Number(o.durationSec);
      return {
        type: 'yt', videoId: v, title: clean(o.title, 200), channel: clean(o.channel, 100),
        durationSec: Number.isFinite(d) ? Math.min(86400, Math.max(0, Math.round(d))) : 0, mode: cleanMode(o.mode)
      };
    }
    case 'banner': {
      const b = sanitizeBanner(o.banner);
      return b.text ? { type: 'banner', banner: b } : null;
    }
    default: return null;
  }
}

function defaultLabel(ref) {
  switch (ref.type) {
    case 'local': return clean(titleOf(ref.file), MAX_LABEL);
    case 'yt': return clean(ref.title, MAX_LABEL) || 'Bài YouTube';
    case 'banner': return clean(ref.banner.text.split('\n')[0], MAX_LABEL);
    case 'sfx': return 'Hiệu ứng';
    default: return 'Ô trống';
  }
}

/** Làm sạch một lá bài đã lưu; null nếu hỏng (thiếu id, loại lạ, thiếu nội dung). */
function sanitizeCard(o) {
  if (!o || typeof o !== 'object' || !CARD_ID_OK.test(String(o.id || ''))) return null;
  const ref = parseRef(o);
  if (!ref) return null;
  return { id: String(o.id), label: clean(o.label, MAX_LABEL) || defaultLabel(ref), icon: customIcon(o.icon), ...ref };
}

function sanitizeDeck(o) {
  if (!o || typeof o !== 'object' || !DECK_ID_OK.test(String(o.id || ''))) return null;
  const cards = [], seen = new Set();
  for (const c of Array.isArray(o.cards) ? o.cards : []) {
    const s = sanitizeCard(c);
    if (s && !seen.has(s.id)) { seen.add(s.id); cards.push(s); }
    if (cards.length >= MAX_CARDS) break;
  }
  return { id: String(o.id), name: clean(o.name, MAX_DECK_NAME) || 'Bộ bài', icon: customIcon(o.icon) || DEFAULT_DECK_ICON, cards };
}

// ---------------------------------------------------------------- mẫu dựng sẵn
// Mỗi mục: [tên lá bài] (ô trống) hoặc [tên, { chữ chào mừng }] (lá chữ chào mừng có sẵn nội dung).
const TEMPLATES = {
  wedding: {
    name: 'Đám cưới', icon: '💒',
    cards: [['Đón khách'], ['Chào mừng', { text: 'Chúc mừng đám cưới\nA & B', color: '#ffd54f', size: 4 }], ['Cô dâu chú rể vào'],
      ['Phát biểu'], ['Cắt bánh'], ['Mời rượu'], ['Ăn tiệc'], ['Văn nghệ'], ['Tiễn khách']]
  },
  birthday: {
    name: 'Sinh nhật', icon: '🎂',
    cards: [['Đón khách'], ['Chào mừng', { text: 'Chúc mừng sinh nhật!', color: '#ff80ab', size: 4 }], ['Hát chúc mừng'], ['Thổi nến'], ['Cắt bánh'], ['Ăn tiệc'], ['Karaoke']]
  },
  thoinoi: {
    name: 'Thôi nôi', icon: '👶',
    cards: [['Đón khách'], ['Chào mừng', { text: 'Mừng thôi nôi bé yêu', color: '#40c4ff', size: 4 }], ['Bốc đồ'], ['Cắt bánh'], ['Ăn tiệc']]
  }
};

class Decks {
  /**
   * @param store  đối tượng có get(k, d) / set(k, v)
   * @param opts   { sfxHas(id) => bool } (tuỳ chọn): để biết hiệu ứng mà lá bài trỏ tới còn tồn tại không
   */
  constructor(store, opts) { this.store = store; this.sfxHas = opts && typeof opts.sfxHas === 'function' ? opts.sfxHas : null; }

  _load() {
    const raw = this.store.get(KEY, []);
    const out = [], seen = new Set();
    for (const o of Array.isArray(raw) ? raw : []) {
      const d = sanitizeDeck(o);
      if (d && !seen.has(d.id)) { seen.add(d.id); out.push(d); }
    }
    return out.slice(0, MAX_DECKS);
  }
  _save(list) { this.store.set(KEY, list); }

  /** Dạng trả cho giao diện: có biểu tượng đã quyết định và cờ `missing` cho từng lá. */
  _viewCard(c) {
    let missing = false;
    if (c.type === 'local') missing = !fileExists(c.file);
    else if (c.type === 'sfx') missing = this.sfxHas ? !this.sfxHas(c.sfxId) : false;
    return { ...c, icon: c.icon || DEFAULT_ICONS[c.type], missing };
  }
  _viewDeck(d) {
    const cards = d.cards.map(c => this._viewCard(c));
    return { id: d.id, name: d.name, icon: d.icon, cards, missingCount: cards.filter(c => c.missing).length };
  }

  list() { return this._load().map(d => this._viewDeck(d)); }
  get(id) { const d = this._load().find(x => x.id === String(id)); return d ? this._viewDeck(d) : null; }

  static templates() { return Object.keys(TEMPLATES).map(k => ({ key: k, name: TEMPLATES[k].name, icon: TEMPLATES[k].icon, count: TEMPLATES[k].cards.length })); }

  // ---------------------------------------------------------------- bộ bài
  /** Tạo bộ bài trống. Trả về { deck, reason }: reason = null | 'FULL'. */
  create(name, icon) {
    const list = this._load();
    if (list.length >= MAX_DECKS) return { deck: null, reason: 'FULL' };
    const d = sanitizeDeck({ id: newDeckId(), name, icon, cards: [] });
    list.push(d); this._save(list);
    return { deck: this._viewDeck(d), reason: null };
  }

  /** Tạo bộ bài từ mẫu dựng sẵn ('wedding' | 'birthday' | 'thoinoi'). reason = null | 'FULL' | 'NO_TEMPLATE'. */
  createFromTemplate(key, name) {
    const t = Object.prototype.hasOwnProperty.call(TEMPLATES, key) ? TEMPLATES[key] : null;
    if (!t) return { deck: null, reason: 'NO_TEMPLATE' };
    const list = this._load();
    if (list.length >= MAX_DECKS) return { deck: null, reason: 'FULL' };
    const cards = t.cards.map(([label, banner]) => (banner
      ? { id: newCardId(), type: 'banner', label, banner }
      : { id: newCardId(), type: 'empty', label }));
    const d = sanitizeDeck({ id: newDeckId(), name: name || t.name, icon: t.icon, cards });
    list.push(d); this._save(list);
    return { deck: this._viewDeck(d), reason: null };
  }

  /** Nhân bản (cả bộ, lá bài có id mới). */
  duplicate(id) {
    const list = this._load(), src = list.find(x => x.id === String(id));
    if (!src) return { deck: null, reason: 'NO_DECK' };
    if (list.length >= MAX_DECKS) return { deck: null, reason: 'FULL' };
    const base = src.name.length > MAX_DECK_NAME - 11 ? src.name.slice(0, MAX_DECK_NAME - 11).trim() : src.name;
    const d = sanitizeDeck({ ...src, id: newDeckId(), name: base + ' (bản sao)', cards: src.cards.map(c => ({ ...c, id: newCardId() })) });
    list.splice(list.indexOf(src) + 1, 0, d); this._save(list);
    return { deck: this._viewDeck(d), reason: null };
  }

  /** Đổi tên / biểu tượng bộ bài. Tên rỗng thì giữ tên cũ; biểu tượng rỗng thì về mặc định. */
  updateDeck(id, patch) {
    const list = this._load(), i = list.findIndex(x => x.id === String(id));
    if (i < 0 || !patch || typeof patch !== 'object') return null;
    const next = { ...list[i] };
    if (patch.name !== undefined) next.name = clean(patch.name, MAX_DECK_NAME) || list[i].name;
    if (patch.icon !== undefined) next.icon = customIcon(patch.icon) || DEFAULT_DECK_ICON;
    list[i] = next; this._save(list);
    return this._viewDeck(next);
  }

  removeDeck(id) {
    const list = this._load(), rest = list.filter(x => x.id !== String(id));
    if (rest.length === list.length) return false;
    this._save(rest); return true;
  }

  moveDeck(id, to) {
    const list = this._load(), i = list.findIndex(x => x.id === String(id));
    if (i < 0) return false;
    const [d] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, Number(to) | 0)), 0, d);
    this._save(list); return true;
  }

  // ---------------------------------------------------------------- chế độ dùng (buổi tiệc đang diễn ra)
  // Nhớ bộ nào đang dùng và lá nào đã chạy rồi (mỗi bộ một danh sách), để tắt/mở lại app giữa buổi vẫn còn nguyên.
  // Mỗi lần đọc đều lọc lại theo bộ bài hiện có: bộ/lá đã bị xoá thì tự biến mất khỏi đây.
  _loadLive(list) {
    const raw = this.store.get(LIVE_KEY, null) || {};
    const byId = new Map(list.map(d => [d.id, d]));
    const played = {}, last = {};
    const rp = raw.played && typeof raw.played === 'object' ? raw.played : {};
    const rl = raw.last && typeof raw.last === 'object' ? raw.last : {};
    for (const id of Object.keys(rp)) {
      const d = byId.get(id);
      if (!d || !Array.isArray(rp[id])) continue;
      const ids = new Set(d.cards.map(c => c.id)), seen = new Set();
      const keep = rp[id].map(String).filter(x => ids.has(x) && !seen.has(x) && seen.add(x));
      if (keep.length) played[id] = keep;
    }
    for (const id of Object.keys(rl)) { const d = byId.get(id); if (d && d.cards.some(c => c.id === String(rl[id]))) last[id] = String(rl[id]); }
    return { deckId: byId.has(String(raw.deckId)) ? String(raw.deckId) : '', played, last };
  }
  _saveLive(live) { this.store.set(LIVE_KEY, live); }

  /**
   * { deckId: id bộ đang dùng hoặc null, played: [id các lá đã chạy của bộ đó], last: id lá vừa chạy gần nhất hoặc null,
   *   next: id lá sẽ chạy khi bấm "kế tiếp" hoặc null }
   */
  getLive() {
    const live = this._loadLive(this._load()), id = live.deckId;
    if (!id) return { deckId: null, played: [], last: null, next: null };
    const n = this.next(id);
    return { deckId: id, played: (live.played[id] || []).slice(), last: live.last[id] || null, next: n && n.card ? n.card.id : null };
  }

  /**
   * Trạng thái chạy của MỘT bộ bất kỳ (không cần là bộ đang dùng): { played, last, next }. null nếu bộ không có.
   * Điện thoại dùng cái này để mở bất kỳ bộ nào mà vẫn thấy đúng lá đã chạy và lá kế tiếp.
   */
  liveOf(deckId) {
    const list = this._load(), id = String(deckId);
    if (!list.some(d => d.id === id)) return null;
    const live = this._loadLive(list), n = this.next(id);
    return { played: (live.played[id] || []).slice(), last: live.last[id] || null, next: n && n.card ? n.card.id : null };
  }

  /** Chọn bộ đang dùng; null hoặc '' = ngừng dùng. false nếu bộ không có. */
  setActive(deckId) {
    const list = this._load(), live = this._loadLive(list);
    if (deckId === null || deckId === undefined || deckId === '') { live.deckId = ''; this._saveLive(live); return true; }
    if (!list.some(d => d.id === String(deckId))) return false;
    live.deckId = String(deckId); this._saveLive(live); return true;
  }

  /** Đánh dấu một lá đã chạy và nhớ nó là lá vừa chạy (bấm lại lá đã đánh dấu thì không nhân đôi). false nếu bộ hoặc lá không có. */
  markPlayed(deckId, cardId) {
    const list = this._load(), d = list.find(x => x.id === String(deckId));
    if (!d || !d.cards.some(c => c.id === String(cardId))) return false;
    const live = this._loadLive(list), arr = live.played[d.id] || (live.played[d.id] = []);
    if (!arr.includes(String(cardId))) arr.push(String(cardId));
    live.last[d.id] = String(cardId); this._saveLive(live); // bấm lại lá đã chạy cũng đưa "vị trí hiện tại" về lá đó
    return true;
  }

  /** Xoá hết dấu "đã chạy" của một bộ (đặt lại để chạy từ đầu). false nếu bộ không có. */
  resetPlayed(deckId) {
    const list = this._load();
    if (!list.some(x => x.id === String(deckId))) return false;
    const live = this._loadLive(list); delete live.played[String(deckId)]; delete live.last[String(deckId)]; this._saveLive(live); return true;
  }

  /**
   * Lá kế tiếp để chạy, như bấm clicker: lá chưa chạy và dùng được (không phải ô trống, không bị mất file/hiệu ứng)
   * nằm sau lá vừa chạy; hết thì quay lại từ đầu bộ. Chưa chạy lá nào thì bắt đầu từ lá đầu tiên.
   * Trả về { card, skipped, left }:
   *   skipped = các lá chưa chạy nhưng không dùng được (ô trống, bị mất) vừa bị lướt qua để tới lá kế tiếp;
   *   left = số lá chưa chạy và dùng được còn lại (tính cả lá kế tiếp).
   *   card = null khi không còn lá nào dùng được: skipped liệt kê mọi lá chưa chạy mà không dùng được (rỗng = đã chạy hết).
   * null nếu bộ không có.
   */
  next(deckId) {
    const d = this.get(deckId);
    if (!d) return null;
    const live = this._loadLive(this._load());
    const played = new Set(live.played[d.id] || []), n = d.cards.length;
    const usable = c => !played.has(c.id) && c.type !== 'empty' && !c.missing;
    const left = d.cards.filter(usable).length;
    if (!left) return { card: null, skipped: d.cards.filter(c => !played.has(c.id)), left: 0 };
    const li = live.last[d.id] ? d.cards.findIndex(c => c.id === live.last[d.id]) : -1;
    const skipped = [];
    for (let k = 1; k <= n; k++) {
      const c = d.cards[(li + k + n) % n];
      if (usable(c)) return { card: c, skipped, left };
      if (!played.has(c.id)) skipped.push(c);
    }
    return { card: null, skipped, left: 0 }; // không tới được
  }

  // ---------------------------------------------------------------- lá bài
  /**
   * Thêm lá bài vào cuối bộ (hoặc vào vị trí `index`, tính từ 0).
   * src: { type, label?, icon?, mode?, + sfxId | file | videoId,title,channel,durationSec | banner }.
   * Trả về { card, reason }: reason = null | 'NO_DECK' | 'FULL' | 'INVALID'. id luôn do app tạo, không nhận từ ngoài.
   */
  addCard(deckId, src, index) {
    const list = this._load(), d = list.find(x => x.id === String(deckId));
    if (!d) return { card: null, reason: 'NO_DECK' };
    if (d.cards.length >= MAX_CARDS) return { card: null, reason: 'FULL' };
    const c = sanitizeCard({ ...(src && typeof src === 'object' ? src : {}), id: newCardId() });
    if (!c) return { card: null, reason: 'INVALID' };
    const at = index === undefined || index === null ? d.cards.length : Math.max(0, Math.min(d.cards.length, Number(index) | 0));
    d.cards.splice(at, 0, c); this._save(list);
    return { card: this._viewCard(c), reason: null };
  }

  /**
   * Thêm nhiều lá bài một lúc vào cuối bộ (chọn nhiều nhạc / hiệu ứng từ bảng chọn). Dừng khi bộ đầy.
   * Trả về { added: [lá bài], skipped: số nguồn không hợp lệ, full: số nguồn bị bỏ vì bộ đầy, reason: null | 'NO_DECK' }.
   */
  addCards(deckId, srcs) {
    const out = { added: [], skipped: 0, full: 0, reason: null };
    const list = this._load(), d = list.find(x => x.id === String(deckId));
    if (!d) { out.reason = 'NO_DECK'; return out; }
    for (const src of Array.isArray(srcs) ? srcs : []) {
      const c = sanitizeCard({ ...(src && typeof src === 'object' ? src : {}), id: newCardId() });
      if (!c) { out.skipped++; continue; }
      if (d.cards.length >= MAX_CARDS) { out.full++; continue; }
      d.cards.push(c); out.added.push(c);
    }
    if (out.added.length) this._save(list);
    out.added = out.added.map(c => this._viewCard(c));
    return out;
  }

  /**
   * Lưu hàng đợi hiện tại thành một bộ bài mới (mỗi bài là một lá, đúng thứ tự, kiểu "vào hàng đợi").
   * items: [{ videoId, title, channel, durationSec, local }] (local = đường dẫn file nếu là nhạc trong máy).
   * Bài trùng chỉ lấy một lần; quá MAX_CARDS thì cắt bớt.
   * Trả về { deck, reason: null | 'FULL' | 'EMPTY', added, dup, skipped, truncated }.
   */
  createFromQueue(name, items) {
    const out = { deck: null, reason: null, added: 0, dup: 0, skipped: 0, truncated: 0 };
    const list = this._load();
    if (list.length >= MAX_DECKS) { out.reason = 'FULL'; return out; }
    const cards = [], seen = new Set();
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || typeof it !== 'object') { out.skipped++; continue; }
      const src = it.local
        ? { type: 'local', file: it.local, label: it.title, mode: 'queue' }
        : { type: 'yt', videoId: it.videoId, title: it.title, channel: it.channel, durationSec: it.durationSec, mode: 'queue' };
      const c = sanitizeCard({ ...src, id: newCardId() });
      if (!c) { out.skipped++; continue; }
      const key = c.type === 'local' ? 'l:' + c.file : 'y:' + c.videoId;
      if (seen.has(key)) { out.dup++; continue; }
      seen.add(key);
      if (cards.length >= MAX_CARDS) { out.truncated++; continue; }
      cards.push(c);
    }
    if (!cards.length) { out.reason = 'EMPTY'; return out; }
    const d = sanitizeDeck({ id: newDeckId(), name: name || 'Hàng đợi', icon: '', cards });
    list.push(d); this._save(list);
    out.deck = this._viewDeck(d); out.added = cards.length;
    return out;
  }

  /** Đổi tên / biểu tượng / kiểu phát (mode chỉ có nghĩa với nhạc trong máy và YouTube). Không đổi nội dung hay id. */
  updateCard(deckId, cardId, patch) {
    const list = this._load(), d = list.find(x => x.id === String(deckId));
    const i = d ? d.cards.findIndex(x => x.id === String(cardId)) : -1;
    if (i < 0 || !patch || typeof patch !== 'object') return null;
    const cur = d.cards[i], next = { ...cur };
    if (patch.label !== undefined) next.label = clean(patch.label, MAX_LABEL) || cur.label;
    if (patch.icon !== undefined) next.icon = customIcon(patch.icon);
    if (patch.mode !== undefined && (cur.type === 'local' || cur.type === 'yt') && MODES.includes(patch.mode)) next.mode = patch.mode;
    d.cards[i] = next; this._save(list);
    return this._viewCard(next);
  }

  /**
   * Gán (hoặc đổi) nội dung cho một lá bài, giữ nguyên id, tên và biểu tượng đã đặt
   * (ví dụ ô trống "Cắt bánh" gán một bài nhạc). Gán { type: 'empty' } để xoá nội dung. Trả về lá bài sau khi đổi hoặc null.
   */
  assignCard(deckId, cardId, src) {
    const list = this._load(), d = list.find(x => x.id === String(deckId));
    const i = d ? d.cards.findIndex(x => x.id === String(cardId)) : -1;
    if (i < 0) return null;
    const ref = parseRef(src);
    if (!ref) return null;
    const cur = d.cards[i];
    const next = { id: cur.id, label: cur.label, icon: cur.icon, ...ref };
    d.cards[i] = next; this._save(list);
    return this._viewCard(next);
  }

  removeCard(deckId, cardId) {
    const list = this._load(), d = list.find(x => x.id === String(deckId));
    if (!d) return false;
    const rest = d.cards.filter(x => x.id !== String(cardId));
    if (rest.length === d.cards.length) return false;
    d.cards = rest; this._save(list); return true;
  }

  /** Dời lá bài tới vị trí `to` (tính từ 0) trong cùng bộ. */
  moveCard(deckId, cardId, to) {
    const list = this._load(), d = list.find(x => x.id === String(deckId));
    const i = d ? d.cards.findIndex(x => x.id === String(cardId)) : -1;
    if (i < 0) return false;
    const [c] = d.cards.splice(i, 1);
    d.cards.splice(Math.max(0, Math.min(d.cards.length, Number(to) | 0)), 0, c);
    this._save(list); return true;
  }
}

module.exports = { Decks, sanitizeCard, sanitizeDeck, MAX_DECKS, MAX_CARDS, DEFAULT_DECK_ICON, DEFAULT_ICONS, TEMPLATES };
