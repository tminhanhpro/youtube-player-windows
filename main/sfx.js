'use strict';
/**
 * Bảng hiệu ứng âm thanh riêng (vỗ tay, reo hò, "mời cô dâu chú rể"...): mỗi hiệu ứng = 1 file nhạc + tên + biểu tượng + âm lượng riêng.
 * Chỉ lo phần LƯU TRỮ và KIỂM TRA DỮ LIỆU. Việc phát nằm ở bước sau (cửa sổ TV / máy tính), giao diện nằm ở các bước sau nữa.
 * Không phụ thuộc Electron nên kiểm thử được bằng node.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { clean } = require('./util');
const { kindOf, titleOf } = require('./localfiles');

const MAX_ITEMS = 40;
const MAX_NAME = 24;
const DEFAULT_ICON = '🔊';
const KEY = 'sfxList';

const newId = () => 's' + crypto.randomBytes(6).toString('base64url');
const ID_OK = /^s[A-Za-z0-9_-]{4,14}$/;

/** Biểu tượng: tối đa 2 ký tự (đủ cho một emoji, kể cả emoji ghép), không có thì dùng loa mặc định. */
function cleanIcon(v) {
  const s = Array.from(String(v == null ? '' : v).trim()).slice(0, 2).join('');
  return s || DEFAULT_ICON;
}

/** Chỉ nhận file nhạc (không nhận video), đường dẫn tuyệt đối. */
function isAudioPath(p) { return typeof p === 'string' && path.isAbsolute(p) && kindOf(p) === 'audio'; }

/** Làm sạch một hiệu ứng đã lưu; trả về null nếu hỏng (thiếu id/đường dẫn). */
function sanitize(o) {
  if (!o || typeof o !== 'object' || !ID_OK.test(String(o.id || '')) || !isAudioPath(o.file)) return null;
  const vol = Number(o.vol);
  return {
    id: String(o.id),
    name: clean(o.name, MAX_NAME) || clean(titleOf(o.file), MAX_NAME) || 'Hiệu ứng',
    icon: cleanIcon(o.icon),
    file: o.file,
    vol: Number.isFinite(vol) ? Math.min(100, Math.max(0, Math.round(vol))) : 100
  };
}

class Soundboard {
  constructor(store) { this.store = store; }

  _load() {
    const raw = this.store.get(KEY, []);
    const out = [], seen = new Set();
    for (const o of Array.isArray(raw) ? raw : []) {
      const s = sanitize(o);
      if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
    }
    return out.slice(0, MAX_ITEMS);
  }
  _save(list) { this.store.set(KEY, list); }

  /** Danh sách hiệu ứng, kèm cờ `missing` nếu file đã bị xoá/di chuyển (để giao diện báo thay vì im lặng). */
  list() {
    return this._load().map(s => ({ ...s, missing: !fileExists(s.file) }));
  }

  /** Lấy một hiệu ứng để phát; null nếu không có hoặc file không còn. */
  get(id) {
    const s = this._load().find(x => x.id === String(id));
    return s && fileExists(s.file) ? s : null;
  }

  /**
   * Thêm file nhạc. Trả về { added: [hiệu ứng mới], skipped: số file bị bỏ (sai định dạng/không có thật/trùng), full: bool }.
   * Cho phép cùng một file làm 2 nút khác nhau? Không: trùng đường dẫn thì bỏ, để khỏi tạo nút thừa khi kéo thả hai lần.
   */
  addFiles(paths) {
    const list = this._load(), added = [];
    let skipped = 0, full = false;
    for (const p of Array.isArray(paths) ? paths : []) {
      if (!isAudioPath(p) || !fileExists(p) || list.some(x => x.file === p)) { skipped++; continue; }
      if (list.length >= MAX_ITEMS) { full = true; skipped++; continue; }
      const it = sanitize({ id: newId(), name: titleOf(p), file: p, vol: 100 });
      if (it) { list.push(it); added.push(it); } else skipped++;
    }
    if (added.length) this._save(list);
    return { added, skipped, full };
  }

  /** Gói gửi tới cửa sổ phát: { key, id, name, url, vol }. urlFor(file) đổi đường dẫn thành URL cục bộ. Null nếu không phát được. */
  playPayload(id, urlFor) {
    const s = this.get(id);
    if (!s) return null;
    const url = urlFor(s.file);
    return url ? { key: crypto.randomBytes(5).toString('hex'), id: s.id, name: s.name, url, vol: s.vol } : null;
  }

  /** Đổi tên / biểu tượng / âm lượng. Chỉ nhận 3 trường này (không đổi file hay id). Trả về hiệu ứng sau khi đổi hoặc null. */
  update(id, patch) {
    const list = this._load();
    const i = list.findIndex(x => x.id === String(id));
    if (i < 0 || !patch || typeof patch !== 'object') return null;
    const cur = list[i], next = { ...cur };
    if (patch.name !== undefined) next.name = clean(patch.name, MAX_NAME) || cur.name;
    if (patch.icon !== undefined) next.icon = cleanIcon(patch.icon);
    if (patch.vol !== undefined) { const v = Number(patch.vol); if (Number.isFinite(v)) next.vol = Math.min(100, Math.max(0, Math.round(v))); }
    list[i] = next;
    this._save(list);
    return next;
  }

  remove(id) {
    const list = this._load(), rest = list.filter(x => x.id !== String(id));
    if (rest.length === list.length) return false;
    this._save(rest);
    return true;
  }

  /** Dời hiệu ứng tới vị trí `to` (tính từ 0). */
  move(id, to) {
    const list = this._load(), i = list.findIndex(x => x.id === String(id));
    if (i < 0) return false;
    const [it] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, Number(to) | 0)), 0, it);
    this._save(list);
    return true;
  }
}

function fileExists(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

module.exports = { Soundboard, sanitize, MAX_ITEMS, DEFAULT_ICON };
