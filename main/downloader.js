'use strict';
/**
 * Hàng đợi tải bài YouTube về máy bằng yt-dlp (phần 7, bước 2).
 * - Tải từng bài một; đọc phần trăm / tốc độ; huỷ được (đang tải hoặc đang chờ).
 * - Bài lỗi thì thử lại bằng client android_vr (cùng cách resolver.js đổi client). Bài không khả dụng thì không thử lại.
 * - Hai kiểu: 'video' (hình + tiếng; có ffmpeg thì ghép, không có thì lấy định dạng gộp sẵn, thường chỉ 360p) và 'audio' (m4a).
 * - Không phụ thuộc Electron: yt-dlp và hàm kill có thể thay bằng bản giả khi kiểm thử.
 */
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const resolver = require('./resolver');
const { OUT_TEMPLATE, ID_OK, MIN_BYTES, idFromName } = require('./downloads');

const PROG = 'YTPROG|', FILE = 'YTPFILE|';
const STALL_MS = 90000;           // không có dòng nào từ yt-dlp trong chừng này thì coi là đứng
const EMIT_GAP_MS = 150;          // giãn nhịp báo tiến độ
const DEFAULT_MAX_HEIGHT = 1080;
const UNAVAILABLE_RE = /Video unavailable|Private video|has been removed|is not available|copyright|members-only|Join this channel|confirm your age|account associated with this video has been terminated|This live event/i;

/** Tìm file chạy trong PATH (Windows tự thêm .exe). */
function findOnPath(name) {
  const exts = process.platform === 'win32' ? ['.exe'] : [''];
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    for (const e of exts) { const f = path.join(d, name + e); try { if (fs.statSync(f).isFile()) return f; } catch (x) { /* thử tiếp */ } }
  }
  return null;
}

/** Công cụ mặc định: yt-dlp / deno / ffmpeg trong bin (như resolver.js); ffmpeg có thể nằm sẵn trong PATH. */
function defaultTools() {
  const win = process.platform === 'win32';
  const ytdlp = resolver.exe('yt-dlp') || (win ? 'yt-dlp.exe' : 'yt-dlp');
  const deno = resolver.exe('deno');
  const ffmpeg = resolver.exe('ffmpeg') || findOnPath('ffmpeg');
  const env = {};
  if (deno) env.PATH = path.dirname(deno) + path.delimiter + (process.env.PATH || '');
  return { ytdlp, prefix: [], deno, ffmpeg, env };
}

/** Dừng yt-dlp và cả ffmpeg con của nó. */
function killTree(proc) {
  if (!proc || proc.exitCode !== null || proc.killed && proc.signalCode) return;
  try {
    if (process.platform === 'win32' && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }).on('error', () => { try { proc.kill(); } catch (e) { /* ignore */ } });
    else { proc.kill('SIGTERM'); const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) { /* ignore */ } }, 2000); if (t.unref) t.unref(); }
  } catch (e) { /* ignore */ }
}

/** Dòng lệnh yt-dlp cho một bài. variant 0 = client mặc định, 1 = android_vr. */
function buildArgs(o) {
  const H = Math.max(144, Math.min(4320, Number(o.maxHeight) || DEFAULT_MAX_HEIGHT));
  const args = ['-4', '--no-playlist', '--no-warnings', '--no-cache-dir', '--newline', '--progress', '--no-simulate',
    '--socket-timeout', '15', '--retries', '3', '--fragment-retries', '3', '-N', '4', '--windows-filenames',
    '-P', o.dir, '-o', OUT_TEMPLATE,
    '--progress-template', 'download:' + PROG + '%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '--print', 'after_move:' + FILE + '%(filepath)s'];
  if (o.deno) args.push('--js-runtimes', 'deno:' + o.deno);
  if (o.ffmpeg) args.push('--ffmpeg-location', o.ffmpeg);
  if (o.mode === 'audio') {
    args.push('-f', 'ba[ext=m4a]/ba/b');
  } else if (o.ffmpeg) {
    args.push('-f', 'bv*[vcodec^=avc1][height<=' + H + ']+ba[ext=m4a]/bv*[height<=' + H + '][ext=mp4]+ba[ext=m4a]/bv*[height<=' + H + ']+ba/b[height<=' + H + ']/b', '--merge-output-format', 'mp4');
  } else {
    args.push('-f', 'b[ext=mp4][height<=' + H + ']/b[ext=mp4]/b');   // không có ffmpeg: chỉ lấy loại gộp sẵn
  }
  for (const a of resolver.VARIANTS[o.variant || 0] || []) args.push(a);
  args.push('https://www.youtube.com/watch?v=' + o.id);
  return args;
}

const num = s => { if (s == null || s === 'NA' || s === 'None' || s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const lastError = err => {
  const lines = String(err || '').split('\n').map(s => s.trim()).filter(Boolean);
  const e = lines.filter(l => /^ERROR:/i.test(l)).pop() || lines.pop() || '';
  return e.replace(/^ERROR:\s*/i, '').slice(0, 200);
};

class DownloadQueue extends EventEmitter {
  /**
   * library: DownloadLibrary. getDir/getMode/getMaxHeight: hàm đọc cài đặt hiện tại (mỗi bài đọc lại lúc bắt đầu).
   * tools: () => { ytdlp, prefix, deno, ffmpeg, env } (thay được khi kiểm thử). spawn/kill cũng thay được.
   */
  constructor(o) {
    super();
    o = o || {};
    this.library = o.library;
    this.getDir = typeof o.getDir === 'function' ? o.getDir : () => String(o.getDir || '');
    this.getMode = o.getMode || (() => 'video');
    this.getMaxHeight = o.getMaxHeight || (() => DEFAULT_MAX_HEIGHT);
    this.tools = o.tools || defaultTools;
    this.spawnFn = o.spawn || spawn;
    this.killFn = o.kill || killTree;
    this.stallMs = o.stallMs || STALL_MS;
    this.jobs = new Map();       // videoId -> job (thứ tự thêm = thứ tự hiện)
    this.cur = null; this.proc = null; this.busy = false;
  }

  /** Thêm bài vào hàng đợi. items: mảng mã hoặc { videoId, title }. Trả về { added, have, queued, bad }. */
  enqueue(items) {
    const out = { added: [], have: [], queued: [], bad: 0 };
    const seen = new Set();
    for (const it of items || []) {
      const id = String(it && typeof it === 'object' ? it.videoId : it == null ? '' : it);
      if (!ID_OK.test(id)) { out.bad++; continue; }
      if (seen.has(id)) continue; seen.add(id);
      if (this.library && this.library.has(id)) { out.have.push(id); continue; }
      const old = this.jobs.get(id);
      if (old && (old.status === 'queued' || old.status === 'downloading')) { out.queued.push(id); continue; }
      if (old) this.jobs.delete(id);                      // lỗi / đã huỷ / file đã mất: xếp lại từ đầu, xuống cuối danh sách
      const title = it && typeof it === 'object' && it.title ? String(it.title).slice(0, 200) : '';
      const job = { id, title, status: 'queued', percent: 0, speed: 0, eta: null, bytes: 0, total: 0, error: '', file: null, attempt: 0, lite: false, mode: 'video', cancelled: false, _emitAt: 0 };
      this.jobs.set(id, job); out.added.push(id);
      this._changed(job, true);
    }
    this._pump();
    return out;
  }

  /** Huỷ một bài (đang chờ hoặc đang tải). Trả về true nếu có gì để huỷ. */
  cancel(videoId) {
    const job = this.jobs.get(String(videoId));
    if (!job) return false;
    if (job.status === 'queued') { job.status = 'canceled'; this._changed(job, true); return true; }
    if (job.status === 'downloading') { job.cancelled = true; this._kill(); return true; }
    return false;
  }

  /** Huỷ tất cả. Trả về số bài bị huỷ. */
  cancelAll() {
    let n = 0;
    for (const id of [...this.jobs.keys()]) if (this.cancel(id)) n++;
    return n;
  }

  /** Xoá một dòng đã xong / lỗi / huỷ khỏi danh sách (không xoá file). */
  clear(videoId) {
    const job = this.jobs.get(String(videoId));
    if (!job || job.status === 'queued' || job.status === 'downloading') return false;
    this.jobs.delete(job.id); this.emit('removed', job.id); return true;
  }
  clearFinished() { let n = 0; for (const id of [...this.jobs.keys()]) if (this.clear(id)) n++; return n; }

  snapshot() {
    const t = this._tools(), mode = this._mode();
    const counts = { queued: 0, downloading: 0, done: 0, error: 0, canceled: 0 };
    const jobs = [];
    for (const j of this.jobs.values()) { counts[j.status]++; jobs.push(pub(j)); }
    return { dir: this.getDir() || '', mode, maxHeight: this._maxH(), ffmpeg: !!t.ffmpeg, lite: mode === 'video' && !t.ffmpeg, running: !!this.cur, counts, jobs };
  }

  // ---------- bên trong ----------
  _tools() { try { return this.tools() || {}; } catch (e) { return {}; } }
  _mode() { return this.getMode() === 'audio' ? 'audio' : 'video'; }
  _maxH() { return Number(this.getMaxHeight()) || DEFAULT_MAX_HEIGHT; }
  _kill() { if (this.proc) this.killFn(this.proc); }
  _changed(job, force) {
    const now = Date.now();
    if (!force && now - job._emitAt < EMIT_GAP_MS) return;
    job._emitAt = now; this.emit('update', pub(job));
  }

  _pump() {
    if (this.cur) return;
    let next = null;
    for (const j of this.jobs.values()) if (j.status === 'queued') { next = j; break; }
    if (!next) { if (this.busy) { this.busy = false; this.emit('idle'); } return; }
    this.busy = true; this.cur = next;
    this._run(next).catch(e => this._finish(next, 'error', 'Lỗi không rõ: ' + (e && e.message))).then(() => { this.cur = null; this.proc = null; this._pump(); });
  }

  _finish(job, status, error, file) {
    job.status = status; job.error = error || ''; job.speed = 0; job.eta = null;
    if (status === 'done') { job.percent = 100; job.file = file; }
    this._changed(job, true);
    if (status === 'done') this.emit('done', pub(job));
  }

  async _run(job) {
    job.status = 'downloading'; job.error = ''; job.percent = 0; job.attempt = 0; this._changed(job, true);
    const dir = this.getDir();
    if (!dir) return this._finish(job, 'error', 'Chưa chọn thư mục tải');
    try { await fs.promises.mkdir(dir, { recursive: true }); } catch (e) { return this._finish(job, 'error', 'Không tạo được thư mục tải: ' + (e && e.message)); }
    if (job.cancelled) return this._finish(job, 'canceled');
    const t = this._tools(), mode = this._mode();
    job.mode = mode; job.lite = mode === 'video' && !t.ffmpeg;
    let last = null;
    for (let v = 0; v < resolver.VARIANTS.length; v++) {
      if (job.cancelled) break;
      job.attempt = v + 1; job.percent = 0; this._changed(job, true);
      const args = buildArgs({ id: job.id, dir, mode, maxHeight: this._maxH(), deno: t.deno, ffmpeg: t.ffmpeg, variant: v });
      const r = await this._once(job, t, args, dir, mode === 'video' && !!t.ffmpeg ? 2 : 1);
      if (r.ok) { resolver.log('TẢI OK ' + job.id + ' -> ' + r.file); return this._finish(job, 'done', '', r.file); }
      last = r;
      if (job.cancelled) break;
      resolver.log('TẢI LỖI ' + job.id + ' lần ' + (v + 1) + ': ' + r.error);
      if (r.fatal) break;
    }
    if (job.cancelled) return this._finish(job, 'canceled');
    this._finish(job, 'error', last ? last.error : 'Tải không được');
  }

  /** Chạy yt-dlp một lần. Trả về { ok, file } hoặc { ok:false, error, fatal }. */
  _once(job, t, args, dir, stages) {
    return new Promise(resolve => {
      let settled = false, stalled = false, out = '', err = '', file = null, stage = 0, lastD = 0, timer = null, proc;
      const env = { ...process.env, ...(t.env || {}) };
      const end = r => { if (settled) return; settled = true; clearTimeout(timer); this.proc = null; resolve(r); };
      const stallErr = () => ({ ok: false, error: 'Tải bị đứng (' + Math.round(this.stallMs / 1000) + ' giây không có dữ liệu)' });
      // Đứng: dừng tiến trình rồi đợi nó thoát hẳn (tối đa 3 giây) trước khi thử lại, để không chạy chồng hai yt-dlp.
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; this._kill(); timer = setTimeout(() => end(stallErr()), 3000); }, this.stallMs); };
      try { proc = this.spawnFn(t.ytdlp, [...(t.prefix || []), ...args], { env, windowsHide: true }); }
      catch (e) { return end({ ok: false, fatal: true, error: 'Không chạy được yt-dlp: ' + (e && e.message) }); }
      this.proc = proc;
      if (job.cancelled) this._kill();
      arm();
      const line = s => {
        if (s.startsWith(PROG)) {
          const p = s.slice(PROG.length).split('|'), d = num(p[0]), tot = num(p[1]) || num(p[2]);
          if (d == null) return;
          if (d < lastD - 1) stage++;                               // luồng mới (hình xong, sang tiếng): số byte đếm lại từ đầu
          lastD = d;
          const frac = tot ? Math.min(1, d / tot) : 0;
          const pct = Math.min(99, Math.round(((Math.min(stage, stages - 1) + frac) / stages) * 1000) / 10);
          if (pct > job.percent) job.percent = pct;
          job.bytes = d; job.total = tot || 0; job.speed = num(p[3]) || 0; job.eta = num(p[4]);
          this._changed(job, false);
        } else if (s.startsWith(FILE)) file = s.slice(FILE.length).trim();
      };
      const feed = (buf, isErr) => {
        if (stalled) return;
        arm();
        if (isErr) { err += buf; if (err.length > 8000) err = err.slice(-8000); return; }
        out += buf;
        let i; while ((i = out.indexOf('\n')) >= 0) { line(out.slice(0, i).replace(/\r$/, '')); out = out.slice(i + 1); }
      };
      proc.stdout.on('data', d => feed(String(d), false));
      proc.stderr.on('data', d => feed(String(d), true));
      proc.on('error', e => end({ ok: false, fatal: true, error: 'Không chạy được yt-dlp (thiếu bin\\yt-dlp.exe?): ' + (e && e.message) }));
      proc.on('close', code => {
        if (out) line(out.replace(/\r$/, ''));
        if (settled) return;
        if (stalled) return end(stallErr());
        if (job.cancelled) return end({ ok: false, error: 'Đã huỷ' });
        if (code !== 0) {
          const un = UNAVAILABLE_RE.test(err);
          return end({ ok: false, fatal: un, error: un ? 'Video không khả dụng (đã xoá, riêng tư hoặc bị chặn): ' + lastError(err) : lastError(err) || 'yt-dlp lỗi ' + code });
        }
        if (!file || !fileOk(file)) {                                // yt-dlp không in đường dẫn (hoặc file in ra hỏng): tự tìm theo mã
          const printed = file; file = findFile(dir, job.id);
          if (!file) return end({ ok: false, error: printed && fs.existsSync(printed) ? 'File tải về bị hỏng hoặc quá nhỏ' : 'Tải xong nhưng không thấy file' });
        }
        if (!this.library || !this.library.add(job.id, file)) return end({ ok: false, error: 'File tải về bị hỏng hoặc quá nhỏ' });
        end({ ok: true, file });
      });
    });
  }
}

function fileOk(f) { try { const st = fs.statSync(f); return st.isFile() && st.size >= MIN_BYTES; } catch (e) { return false; } }

/** File mới nhất mang mã [id] ở thư mục tải (không đi vào thư mục con). */
function findFile(dir, id) {
  let best = null;
  try {
    for (const n of fs.readdirSync(dir)) {
      if (idFromName(n) !== id) continue;
      const f = path.join(dir, n); let st; try { st = fs.statSync(f); } catch (e) { continue; }
      if (st.isFile() && st.size >= MIN_BYTES && (!best || st.mtimeMs > best.m)) best = { f, m: st.mtimeMs };
    }
  } catch (e) { /* ignore */ }
  return best ? best.f : null;
}

function pub(j) {
  return { id: j.id, title: j.title, status: j.status, percent: j.percent, speed: j.speed, eta: j.eta, bytes: j.bytes, total: j.total, error: j.error, file: j.file, attempt: j.attempt, lite: j.lite, mode: j.mode };
}

module.exports = { DownloadQueue, buildArgs, defaultTools, findOnPath, killTree, DEFAULT_MAX_HEIGHT };
