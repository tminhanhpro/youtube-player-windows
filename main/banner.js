'use strict';
/**
 * Chữ chào mừng gõ trên máy tính ("Chúc mừng đám cưới A & B"): mẫu lưu sẵn + chữ đang hiện trên màn hình lớn.
 * Không phụ thuộc Electron nên kiểm thử được bằng node.
 */
const { clean } = require('./util');

const COLORS = ['#ffffff', '#ffd54f', '#ff80ab', '#ff5252', '#69f0ae', '#40c4ff', '#b388ff', '#ffab40'];
const POS = ['center', 'bottom', 'top'];
const HIDE_SECS = [0, 10, 30, 60, 120]; // 0 = giữ đến khi bấm Ẩn
const MAX_TEMPLATES = 30;
const MAX_TEXT = 120;

const DEFAULTS = [
  { text: 'Chúc mừng đám cưới\nA & B', color: '#ffd54f', size: 4, pos: 'center', hideSec: 0 },
  { text: 'Chúc mừng sinh nhật!', color: '#ff80ab', size: 4, pos: 'center', hideSec: 0 },
  { text: 'Mừng thôi nôi bé yêu', color: '#40c4ff', size: 4, pos: 'center', hideSec: 0 },
  { text: 'Kính chào quý khách', color: '#ffffff', size: 3, pos: 'bottom', hideSec: 0 }
];

/** Làm sạch một mẫu: chỉ nhận giá trị hợp lệ, mọi thứ khác về mặc định. */
function sanitize(b) {
  b = b && typeof b === 'object' ? b : {};
  // giữ tối đa 3 dòng; clean() của util đổi xuống dòng thành khoảng trắng nên làm từng dòng
  const lines = String(b.text == null ? '' : b.text).replace(/\r/g, '').split('\n').map(l => clean(l, MAX_TEXT)).filter(Boolean).slice(0, 3);
  const text = lines.join('\n').slice(0, MAX_TEXT);
  const color = typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color.toLowerCase() : COLORS[0];
  const size = Math.min(5, Math.max(1, Number(b.size) | 0 || 3));
  const pos = POS.includes(b.pos) ? b.pos : 'center';
  const hs = Number(b.hideSec) | 0;
  const hideSec = HIDE_SECS.includes(hs) ? hs : 0;
  return { text, color, size, pos, hideSec };
}

class Banners {
  /** onChange(bannerOrNull): gọi mỗi khi chữ đang hiện thay đổi (để đẩy tới các cửa sổ). */
  constructor(store, onChange) {
    this.store = store;
    this.onChange = onChange || (() => {});
    this.cur = null;
    this.seq = 0;
    this._t = null;
  }

  list() {
    const raw = this.store.get('welcomeTemplates', null);
    if (!Array.isArray(raw)) return DEFAULTS.map(d => ({ ...d }));
    return raw.map(sanitize).filter(t => t.text).slice(0, MAX_TEMPLATES);
  }

  saveList(list) {
    const out = (Array.isArray(list) ? list : []).map(sanitize).filter(t => t.text).slice(0, MAX_TEMPLATES);
    this.store.set('welcomeTemplates', out);
    return out;
  }

  current() { return this.cur; }

  show(b) {
    const s = sanitize(b);
    if (!s.text) return null;
    clearTimeout(this._t); this._t = null;
    this.cur = { ...s, seq: ++this.seq };
    if (s.hideSec > 0) { const my = this.seq; this._t = setTimeout(() => { if (this.cur && this.cur.seq === my) this.hide(); }, s.hideSec * 1000); if (this._t.unref) this._t.unref(); }
    this.onChange(this.cur);
    return this.cur;
  }

  hide() {
    clearTimeout(this._t); this._t = null;
    if (!this.cur) return false;
    this.cur = null;
    this.onChange(null);
    return true;
  }
}

module.exports = { Banners, sanitize, COLORS, POS, HIDE_SECS, DEFAULTS };
