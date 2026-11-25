'use strict';
/**
 * Nhạc và video có sẵn trong máy (không cần mạng, không cần yt-dlp).
 * Thư viện = các thư mục đã thêm (quét lại mỗi lần mở) + các file lẻ đã thêm. Không phụ thuộc Electron nên kiểm thử được bằng node.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Chỉ nhận định dạng mà trình phát Chromium của Electron phát được (không có WMA, AVI, WMV, FLV).
const MEDIA = {
  mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'], aac: ['audio', 'audio/aac'], wav: ['audio', 'audio/wav'],
  flac: ['audio', 'audio/flac'], ogg: ['audio', 'audio/ogg'], oga: ['audio', 'audio/ogg'], opus: ['audio', 'audio/ogg'], weba: ['audio', 'audio/webm'],
  mp4: ['video', 'video/mp4'], m4v: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'],
  mkv: ['video', 'video/x-matroska'], ogv: ['video', 'video/ogg']
};
// Hình nền / video nền hiện phía sau tên bài khi phát nhạc không có hình (mp3...). Video nền luôn tắt tiếng và lặp lại.
const BG_IMAGE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
const BG_VIDEO = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'];
/** 'image' | 'video' | null theo đuôi file. */
const bgKindOf = p => { const e = extOf(p); return Object.prototype.hasOwnProperty.call(BG_IMAGE, e) ? 'image' : BG_VIDEO.includes(e) ? 'video' : null; };
const bgMimeOf = p => (bgKindOf(p) === 'image' ? BG_IMAGE[extOf(p)] : mimeOf(p));
const MAX_FILES = 5000;      // tối đa số file trong thư viện
const MAX_DEPTH = 6;         // tối đa độ sâu thư mục con
const MAX_FOLDERS = 30, MAX_SINGLES = 500;
const SKIP_DIR = /^(\$recycle\.bin|system volume information|node_modules|\.|__macosx)/i;

const extOf = p => path.extname(String(p || '')).slice(1).toLowerCase();
const isMedia = p => Object.prototype.hasOwnProperty.call(MEDIA, extOf(p));
const kindOf = p => (isMedia(p) ? MEDIA[extOf(p)][0] : null);
const mimeOf = p => (isMedia(p) ? MEDIA[extOf(p)][1] : 'application/octet-stream');

/** Tên hiển thị: bỏ đuôi file, đổi gạch dưới thành khoảng trắng. */
function titleOf(p) {
  const base = path.basename(String(p || ''), path.extname(String(p || '')));
  return base.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || path.basename(String(p || ''));
}

/** Mã 11 ký tự (bắt đầu bằng "L") thay cho videoId của YouTube: cùng đường kiểm tra trùng/khôi phục hàng đợi. */
function idFor(p) {
  const key = process.platform === 'win32' ? String(p).toLowerCase() : String(p);
  return 'L' + crypto.createHash('sha1').update(key).digest('base64url').slice(0, 10);
}

const natural = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

async function scanFolder(dir, out, depth, seen) {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
  let ents;
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
  ents.sort((a, b) => natural.compare(a.name, b.name));
  for (const e of ents) {
    if (out.length >= MAX_FILES) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) await scanFolder(full, out, depth + 1, seen); }
    else if (e.isFile() && isMedia(e.name) && !seen.has(full)) {
      seen.add(full);
      let size = 0; try { size = (await fs.promises.stat(full)).size; } catch (x) { continue; }
      out.push({ path: full, name: titleOf(full), dir: path.basename(dir), kind: kindOf(full), size });
    }
  }
}

class LocalLibrary {
  constructor(store) { this.store = store; }

  get folders() { const v = this.store.get('localFolders', []); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
  get singles() { const v = this.store.get('localFiles', []); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }

  /** Thêm file lẻ: chỉ nhận đường dẫn tuyệt đối, đúng định dạng, file có thật. Trả về số file mới. */
  addFiles(paths) {
    const cur = this.singles; let n = 0;
    for (const p of paths || []) {
      if (typeof p !== 'string' || !path.isAbsolute(p) || !isMedia(p)) continue;
      try { if (!fs.statSync(p).isFile()) continue; } catch (e) { continue; }
      if (cur.includes(p) || cur.length >= MAX_SINGLES) continue;
      cur.push(p); n++;
    }
    if (n) this.store.set('localFiles', cur);
    return n;
  }

  addFolder(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
    try { if (!fs.statSync(p).isDirectory()) return false; } catch (e) { return false; }
    const cur = this.folders;
    if (cur.includes(p) || cur.length >= MAX_FOLDERS) return false;
    cur.push(p); this.store.set('localFolders', cur);
    return true;
  }

  remove(p) {
    const f = this.folders.filter(x => x !== p), s = this.singles.filter(x => x !== p);
    const changed = f.length !== this.folders.length || s.length !== this.singles.length;
    this.store.set('localFolders', f); this.store.set('localFiles', s);
    return changed;
  }

  /** Quét toàn bộ thư viện. Mỗi bài kèm cờ "single" (file lẻ, xoá riêng được). */
  async list() {
    const out = [], seen = new Set();
    for (const d of this.folders) await scanFolder(d, out, 0, seen);
    for (const p of this.singles) {
      if (seen.has(p) || out.length >= MAX_FILES + MAX_SINGLES) continue;
      let size = 0; try { const st = await fs.promises.stat(p); if (!st.isFile()) continue; size = st.size; } catch (e) { continue; }
      seen.add(p);
      out.push({ path: p, name: titleOf(p), dir: path.basename(path.dirname(p)), kind: kindOf(p), size, single: true });
    }
    return out;
  }

  /**
   * Biến các đường dẫn kéo thả thành danh sách file nhạc/video: thư mục được thêm vào thư viện và quét, file lẻ được nhớ.
   * Trả về { files: [path], folders: số thư mục mới, singles: số file lẻ mới }.
   */
  async resolveDropped(paths) {
    const files = [], seen = new Set(); let folders = 0; const loose = [];
    for (const p of paths || []) {
      if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
      let st; try { st = await fs.promises.stat(p); } catch (e) { continue; }
      if (st.isDirectory()) {
        if (this.addFolder(p)) folders++;
        const found = []; await scanFolder(p, found, 0, new Set());
        for (const f of found) if (!seen.has(f.path)) { seen.add(f.path); files.push(f.path); }
      } else if (st.isFile() && isMedia(p) && !seen.has(p)) { seen.add(p); files.push(p); loose.push(p); }
    }
    const singles = this.addFiles(loose);
    return { files, folders, singles };
  }
}

module.exports = { LocalLibrary, MEDIA, BG_IMAGE, BG_VIDEO, bgKindOf, bgMimeOf, isMedia, kindOf, mimeOf, titleOf, idFor, MAX_FILES };
