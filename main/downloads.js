'use strict';
/**
 * Bài YouTube đã tải sẵn về máy (phần 7).
 * Bước 1: chỉ có phần "biết bài nào đã tải" — quét thư mục, nhận biết qua mã [videoId] trong tên file, đếm x/y cho từng bộ bài.
 * Không cần sổ ghi riêng: chép thư mục sang máy khác vẫn dùng được. Không phụ thuộc Electron nên kiểm thử được bằng node.
 */
const fs = require('fs');
const path = require('path');
const { isMedia, kindOf, mimeOf } = require('./localfiles');

/** Tên file yt-dlp tạo ra: "<tiêu đề> [<videoId>].<đuôi>" (dùng ở bước tải). */
const OUT_TEMPLATE = '%(title).80s [%(id)s].%(ext)s';
const ID_OK = /^[A-Za-z0-9_-]{11}$/;
// Chỉ nhận đúng một đuôi sau "]": loại "x [id].f137.mp4" (mảnh rời chưa ghép) và "x [id].mp4.part" (đang tải dở).
const NAME_RE = /\[([A-Za-z0-9_-]{11})\]\.([A-Za-z0-9]+)$/;
const MIN_BYTES = 1024;     // file nhỏ hơn mức này coi là hỏng
const MAX_DEPTH = 2;        // thư mục gốc + 2 cấp con
const MAX_FILES = 20000;
const SKIP_DIR = /^(\$recycle\.bin|system volume information|\.|__macosx)/i;

/** Mã videoId trong tên file, hoặc null nếu không phải file bài tải (hoặc đuôi không phát được). */
function idFromName(name) {
  const base = path.basename(String(name || ''));
  const m = NAME_RE.exec(base);
  if (!m || !isMedia(base)) return null;
  return m[1];
}

/** Thư mục mặc định: <Nhạc>\Youtube Player. musicDir lấy từ app.getPath('music'). */
function defaultDir(musicDir) { return path.join(String(musicDir || ''), 'Youtube Player'); }

/** Lọc danh sách mã: chỉ giữ mã hợp lệ, bỏ trùng, giữ thứ tự. */
function uniqueIds(ids) {
  const seen = new Set(), out = [];
  for (const v of ids || []) {
    const id = String(v == null ? '' : v);
    if (ID_OK.test(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

class DownloadLibrary {
  /** getDir: hàm trả về thư mục tải hiện tại (đổi trong cài đặt thì lần quét sau theo thư mục mới). */
  constructor(getDir) {
    this.getDir = typeof getDir === 'function' ? getDir : () => String(getDir || '');
    this.map = new Map();    // videoId -> { path, size, kind, mtime }
    this.dir = null;
  }

  /** Quét lại thư mục. Bài có cả file hình lẫn file tiếng thì dùng file hình. Trả về số bài. */
  async scan() {
    const dir = this.getDir();
    const next = new Map();
    const walk = async (d, depth, state) => {
      if (state.n >= MAX_FILES) return;
      let ents;
      try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (state.n >= MAX_FILES) return;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < MAX_DEPTH && !SKIP_DIR.test(e.name)) await walk(full, depth + 1, state); continue; }
        if (!e.isFile()) continue;
        const id = idFromName(e.name);
        if (!id) continue;
        let st; try { st = await fs.promises.stat(full); } catch (x) { continue; }
        if (st.size < MIN_BYTES) continue;
        state.n++;
        const rec = { path: full, size: st.size, kind: kindOf(full), mtime: st.mtimeMs };
        const old = next.get(id);
        if (!old || better(rec, old)) next.set(id, rec);
      }
    };
    if (dir) await walk(dir, 0, { n: 0 });
    this.map = next; this.dir = dir;
    return next.size;
  }

  /** Đường dẫn file đã tải của bài, hoặc null. Kiểm tra file còn thật (bị xoá thì quên luôn). */
  fileFor(videoId) {
    const r = this.map.get(String(videoId));
    if (!r) return null;
    try { if (fs.statSync(r.path).size >= MIN_BYTES) return r.path; } catch (e) { /* mất file */ }
    this.map.delete(String(videoId));
    return null;
  }
  has(videoId) { return this.fileFor(videoId) !== null; }
  /** Quên bài trong danh sách (file hỏng / không phát được). KHÔNG xoá file trên đĩa; quét lại thì bài có thể hiện lại. */
  forget(videoId) { return this.map.delete(String(videoId)); }
  get count() { return this.map.size; }
  /** Mọi mã bài đã tải (theo sổ đang nhớ, không dò từng file). Giao diện dùng để vẽ nhãn "Đã tải". */
  ids() { return [...this.map.keys()]; }
  info(videoId) { const p = this.fileFor(videoId); return p ? { ...this.map.get(String(videoId)), mime: mimeOf(p) } : null; }

  /** Ghi nhận bài vừa tải xong (không cần quét lại). Trả về true nếu file hợp lệ. */
  add(videoId, file) {
    const id = String(videoId);
    if (!ID_OK.test(id) || typeof file !== 'string' || !isMedia(file)) return false;
    let st; try { st = fs.statSync(file); } catch (e) { return false; }
    if (!st.isFile() || st.size < MIN_BYTES) return false;
    const rec = { path: file, size: st.size, kind: kindOf(file), mtime: st.mtimeMs };
    const old = this.map.get(id);
    if (!old || better(rec, old)) this.map.set(id, rec);
    return true;
  }

  /** Xoá file đã tải của bài (mọi file mang mã đó trong thư mục tải). Trả về số file đã xoá. */
  async remove(videoId) {
    const id = String(videoId); let n = 0;
    const r = this.map.get(id);
    const files = new Set(r ? [r.path] : []);
    if (r) {
      try {
        for (const f of await fs.promises.readdir(path.dirname(r.path))) if (idFromName(f) === id) files.add(path.join(path.dirname(r.path), f));
      } catch (e) { /* ignore */ }
    }
    for (const f of files) { try { await fs.promises.unlink(f); n++; } catch (e) { /* ignore */ } }
    this.map.delete(id);
    return n;
  }

  /** Trong danh sách mã, những bài chưa tải (đã bỏ trùng, bỏ mã sai). */
  missing(videoIds) { return uniqueIds(videoIds).filter(id => !this.has(id)); }

  /** { done, total, missing:[mã] } cho một danh sách mã. */
  progress(videoIds) {
    const ids = uniqueIds(videoIds), missing = ids.filter(id => !this.has(id));
    return { done: ids.length - missing.length, total: ids.length, missing };
  }

  /** Các mã YouTube trong một bộ bài (lá bài loại 'yt'). */
  static deckIds(deck) {
    return uniqueIds(((deck && deck.cards) || []).filter(c => c && c.type === 'yt').map(c => c.videoId));
  }

  /** Mỗi bộ bài: { id, name, done, total, missing }. Bộ không có bài YouTube nào thì bỏ qua. */
  decksProgress(decks) {
    const out = [];
    for (const d of decks || []) {
      const ids = DownloadLibrary.deckIds(d);
      if (!ids.length) continue;
      out.push({ id: d.id, name: d.name, ...this.progress(ids) });
    }
    return out;
  }
}

/** Ưu tiên file hình hơn file tiếng; cùng loại thì lấy file mới hơn. */
function better(a, b) {
  if (a.kind !== b.kind) return a.kind === 'video';
  return a.mtime > b.mtime;
}

module.exports = { DownloadLibrary, idFromName, defaultDir, uniqueIds, OUT_TEMPLATE, ID_OK, MIN_BYTES };
