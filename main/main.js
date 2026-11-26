'use strict';
const { app, BrowserWindow, ipcMain, Menu, shell, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const { Store, Settings } = require('./store');
const { Controller } = require('./controller');
const { KaraokeServer } = require('./server');
const { Cats, Favs } = require('./data');
const { lanIp, newToken, netInfo, parseVideoId, clean } = require('./util');
const searchSvc = require('./search');
const resolver = require('./resolver');
const REACT_IDS = require('./react-ids');
const { StreamProxy } = require('./proxy');
const { TvManager } = require('./tv');
const { Banners, COLORS: BANNER_COLORS } = require('./banner');
const { Soundboard } = require('./sfx');
const { Decks } = require('./decks');
const { runAndMark, runNext, queueDeck, makeEnv } = require('./deckrun');
const { LocalLibrary, MEDIA, BG_IMAGE, BG_VIDEO, bgKindOf, bgMimeOf, isMedia } = require('./localfiles');
const { DownloadService } = require('./dlservice');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) { /* ignore */ } // link googlevideo gắn với IP lúc lấy link (yt-dlp -4) -> proxy cũng dùng IPv4

if (!app.requestSingleInstanceLock()) { app.quit(); }

let store, settings, ctl, server, proxy, tv, banners, library, soundboard, decks, dl, win = null;
let lastQrUrl = null, qrData = null;

/** Đẩy danh sách hiệu ứng mới tới mọi cửa sổ (giao diện quản lý tự cập nhật). */
function sfxPush() { try { broadcast('sfx-list', soundboard.list()); } catch (e) { /* bỏ qua */ } }
const sfxLast = new Map(); // chống bấm dội: cùng một nút trong 150ms chỉ tính một lần
function playSfx(id) {
  const now = Date.now();
  if (now - (sfxLast.get(id) || 0) < 150) return false;
  sfxLast.set(id, now);
  const msg = soundboard.playPayload(id, f => proxy.localFile(f));
  if (!msg) return false;
  broadcast('sfx', msg);
  return true;
}
function deckEnv() { return makeEnv({ ctl, soundboard, banners, checkedLocal, playSfx }); }
function sfxChanged(res) { if (res && res.added && res.added.length) sfxPush(); return res; }
/** Đẩy danh sách bộ bài mới tới mọi cửa sổ (cửa sổ Kịch Bản tự cập nhật). */
function decksPush() { try { broadcast('decks-list', decks.list()); } catch (e) { /* bỏ qua */ } }
/** Đẩy trạng thái chế độ dùng (bộ đang dùng + lá đã chạy) tới mọi cửa sổ. */
function livePush() { try { broadcast('decks-live', decks.getLive()); } catch (e) { /* bỏ qua */ } }
function decksChanged(res) { if (res && (res.deck || res.card)) decksPush(); return res; }

/** Chỉ nhận đường dẫn tuyệt đối, đúng định dạng nhạc/video, file có thật. */
function checkedLocal(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || !isMedia(p)) return null;
  try { return fs.statSync(p).isFile() ? p : null; } catch (e) { return null; }
}
/** Hình/video nền đang chọn (null nếu chưa chọn hoặc file đã mất). */
function bgInfo() {
  const f = store.get('bgFile', '');
  if (typeof f !== 'string' || !f || !path.isAbsolute(f)) return null;
  const kind = bgKindOf(f);
  try { if (!kind || !fs.statSync(f).isFile()) return null; } catch (e) { return null; }
  return { type: kind, file: f, name: path.basename(f) };
}
/** Dạng gửi cho trình phát: { type, url } hoặc null. */
function bgPayload() {
  const b = bgInfo();
  return b ? { type: b.type, url: proxy.localFile(b.file, bgMimeOf(b.file)) } : null;
}
/** Đổi nền: lưu lại rồi báo cả cửa sổ laptop lẫn màn hình lớn (đang phát nhạc thì đổi ngay). */
// Chế độ màn hình TV/LED: LIVE (hiện hình đang phát) | STANDBY (hiện video/hình chờ) | BLACK (tối đen). Nhạc luôn tiếp tục phát.
let screenMode = 'LIVE';
function screenCmd() { return { type: 'screen', mode: screenMode, bg: bgPayload() }; }
function screenApply(mode) {
  screenMode = mode === 'STANDBY' || mode === 'BLACK' ? mode : 'LIVE';
  tv.broadcastPlayer(screenCmd());
  broadcast('screen', screenMode);
  return screenMode;
}
function bgApply(file) {
  store.set('bgFile', file || '');
  const bg = bgPayload();
  tv.broadcastPlayer({ type: 'bg', bg });
  if (tv.lastLoad && tv.lastLoad.src && tv.lastLoad.src.audioOnly) tv.lastLoad = { ...tv.lastLoad, bg };
  if (screenMode === 'STANDBY') tv.broadcastPlayer(screenCmd()); // đang hiện màn hình chờ: đổi theo nền mới
  const info = bgInfo();
  broadcast('bg', info);
  return info;
}
function enqueueLocal(paths, priority) {
  const res = { played: 0, added: 0, dup: 0, full: 0, bad: 0 };
  for (const p of Array.isArray(paths) ? paths.slice(0, 200) : []) {
    const f = checkedLocal(p);
    if (!f) { res.bad++; continue; }
    const c = ctl.addLocalFromTv(f, !!priority);
    if (c === 0) res.played++; else if (c === 1) res.added++; else if (c === 2) res.dup++; else res.full++;
  }
  return res;
}

function windows() { return BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()); }
function broadcast(channel, data) { for (const w of windows()) w.webContents.send(channel, data); }

async function info() {
  const ip = lanIp();
  const url = ip ? 'http://' + ip + ':' + server.port + '/?token=' + settings.token : null;
  if (url !== lastQrUrl) {
    lastQrUrl = url;
    qrData = url ? await QRCode.toDataURL(url, { margin: 4, width: 600, errorCorrectionLevel: 'M' }) : null;
  }
  return {
    ip, port: server.port, token: settings.token, qr: qrData,
    host: ip ? 'http://' + ip + ':' + server.port : '',
    remoteConnected: Date.now() - server.lastRemoteSeen < 8000,
    who: ctl.lastActorName(),
    progress: ctl.progress(),
    net: netInfo(), cfg: methods.getSettings()
  };
}

async function pushState() {
  if (!windows().length) return;
  try { broadcast('state', { snap: ctl.snapshot(), info: await info(), ui: ctl.ui }); } catch (e) { /* bỏ qua */ }
}

let searchTok = 0;
async function tvSearch(q) {
  const t = ++searchTok;
  ctl.searchBegin(q, 'tv');
  try {
    const r = await ctl.runSearch(q, 0, 'tv');
    if (t === searchTok) ctl.searchDone(q, 'tv', 0, r.hits, r.hasMore);
  } catch (e) {
    if (t === searchTok) ctl.searchFail(q, 'tv', String(e && e.message || 'lỗi mạng').slice(0, 100));
  }
}
async function tvLoadMore() {
  const s = ctl.search;
  if (s.loading || !s.hasMore || !s.query) return;
  const t = searchTok, q = s.query, page = s.page + 1, src = s.source;
  ctl.searchLoadingMore();
  try {
    const r = await ctl.runSearch(q, page, src);
    if (t === searchTok) ctl.searchDone(q, src, page, r.hits, r.hasMore);
  } catch (e) {
    if (t === searchTok) ctl.searchFail(q, src, String(e && e.message || 'lỗi mạng').slice(0, 100));
  }
}
function searchPayload(s) {
  return { version: s.version, query: s.query, source: s.source, results: s.results.slice(0, 300), hasMore: s.hasMore, page: s.page, loading: s.loading, error: s.error };
}
function saveFavs(list) { Favs.save(store, list); ctl.bumpFavVersion(); ctl.emit('favs'); }

/** Các lệnh cửa sổ được phép gọi. */
const SETTING_KEYS = { backend: ['AUTO', 'STREAM', 'IFRAME'], seedAutoplay: 'bool', gridCols: [1, 2, 3], fullscreenSec: 'int', qrHidden: 'bool', tvOutput: ['AUTO', 'OFF'],
  sfxDuck: 'bool', duckLevel: [10, 20, 30, 40, 50], fadeInSec: [0, 1, 2, 3, 5], fadeOutSec: [2, 3, 5, 8, 10] };
const maskIp = t => String(t).replace(/(\bip=|cho IP )(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}/g, '$1$2.$3.x.x');
function buildReport() {
  const os = require('os');
  const lines = resolver.readLog(400);
  const ok = [], fails = {}; let nFail = 0, nPlayFail = 0, nProxy = 0, nRetry = 0, nUi = 0;
  for (const l of lines) {
    let m;
    if ((m = / OK \S+ (\d+)ms/.exec(l))) ok.push(Number(m[1]));
    else if (/ FAIL /.test(l) && !/ PROXY FAIL /.test(l)) { nFail++; const r = (l.split('ms: ')[1] || l.split(' FAIL ')[1] || '').slice(0, 90); fails[r] = (fails[r] || 0) + 1; }
    else if (/ PLAYFAIL /.test(l)) { nPlayFail++; const r = (l.split('] ')[1] || '').slice(0, 90); fails['(phát) ' + r] = (fails['(phát) ' + r] || 0) + 1; }
    else if (/ PROXY FAIL /.test(l)) { nProxy++; }
    else if (/ RETRY /.test(l)) nRetry++;
    else if (/ (UI|MEDIA|JS) /.test(l)) nUi++;
  }
  const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length / 100) / 10 : 0;
  const max = ok.length ? Math.round(Math.max(...ok) / 100) / 10 : 0;
  const bin = resolver.binDir();
  const head = [
    '=== TỔNG HỢP ===',
    'Phiên bản app ' + app.getVersion() + ' · Electron ' + process.versions.electron + ' · ' + os.type() + ' ' + os.release() + ' · ' + os.arch(),
    'yt-dlp: ' + (resolver.exe('yt-dlp') ? 'có' : 'THIẾU') + ' · deno: ' + (resolver.exe('deno') ? 'có' : 'THIẾU') + (bin ? '' : ' (không thấy thư mục bin)'),
    'Cài đặt: ' + settings.backend + ' · tối đa ' + settings.maxHeight + 'p',
    'Lấy link OK: ' + ok.length + ' lần (TB ' + avg + ' giây, chậm nhất ' + max + ' giây) · lấy link LỖI: ' + nFail,
    'Bài phát lỗi: ' + nPlayFail + ' · proxy lỗi mạng: ' + nProxy + ' · tự thử lại: ' + nRetry + ' · lỗi giao diện/media: ' + nUi
  ];
  const top = Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) { head.push('Lỗi hay gặp:'); top.forEach(([r, c]) => head.push('  ' + c + ' lần: ' + r)); }
  head.push('', '=== NHẬT KÝ (60 dòng gần nhất, mới nhất ở dưới) ===');
  return { text: maskIp(head.concat(lines.slice(-60)).join('\n')) || '(chưa có nhật ký)', path: resolver.logPath() };
}
const methods = {
  getReport: () => buildReport(),
  netTest: async () => {
    // Mở 8 kết nối MỚI ra internet và xem IP công cộng mỗi lần: nếu khác nhau, link YouTube (gắn với IP) sẽ hay bị 403.
    const https = require('https');
    const HOSTS = ['api.ipify.org', 'checkip.amazonaws.com', 'ipv4.icanhazip.com'];
    const one = host => new Promise(resolve => {
      const t0 = Date.now();
      const req = https.get({ host, path: '/', agent: false, family: 4, headers: { Connection: 'close', 'User-Agent': 'curl/8.0' }, timeout: 8000 }, r => {
        let b = ''; r.on('data', d => { b += d; });
        r.on('end', () => { const ip = (/\b(\d{1,3}\.){3}\d{1,3}\b/.exec(b) || [''])[0]; resolve({ host, ip, st: r.statusCode, ms: Date.now() - t0, note: ip ? '' : 'trả về không có IP (HTTP ' + r.statusCode + ', ' + b.length + ' byte)' }); });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', e => resolve({ host, ip: '', st: 0, ms: Date.now() - t0, note: 'lỗi ' + (e.code || e.message) }));
    });
    const list = [];
    for (let i = 0; i < 8; i++) {
      let r = null;
      for (const h of HOSTS) { r = await one(h); if (r.ip) break; }
      list.push(r);
    }
    const ips = [...new Set(list.map(x => x.ip).filter(Boolean))];
    const label = ip => 'IP-' + String.fromCharCode(65 + ips.indexOf(ip)); // A, B, C... (không lộ IP thật)
    const mask = ip => ip ? ip.split('.').slice(0, 2).join('.') + '.x.x' : '';
    const lines = ['KIỂM TRA IP RA INTERNET (8 kết nối mới; IP được che, chỉ giữ nhãn A/B/...)'].concat(list.map((x, i) => '  #' + (i + 1) + ': ' + (x.ip ? label(x.ip) + ' (' + mask(x.ip) + ')' : '(không lấy được)') + '  [' + x.host + ', ' + x.ms + ' ms]' + (x.note ? ' ' + x.note : '')));
    lines.push('');
    if (!ips.length) lines.push('KẾT LUẬN: KHÔNG ĐO ĐƯỢC (không dịch vụ nào trả về IP) -> chưa kết luận gì về IP.');
    else if (ips.length > 1) lines.push('KẾT LUẬN: IP THAY ĐỔI giữa các kết nối (' + ips.length + ' IP khác nhau) -> mạng có nhiều đường ra (cân bằng tải/CGNAT/VPN).');
    else lines.push('KẾT LUẬN: IP ổn định (cả ' + list.filter(x => x.ip).length + '/8 lần đo cùng một IP).');
    resolver.log('NETTEST ' + (ips.length ? ips.length + ' IP khác nhau' : 'không đo được'));
    return lines.join('\n');
  },
  clearLog: () => { resolver.clearLog(); return true; },
  openLogFolder: () => { const p = resolver.logPath(); if (p) shell.showItemInFolder(p); return !!p; },
  logRenderer: msg => { resolver.log('UI ' + String(msg).slice(0, 400)); return true; },
  setWindowFullscreen: on => {
    if (!win || win.isDestroyed()) return false;
    if (on) { if (win.isFullScreen()) return false; win.setFullScreen(true); return true; } // true = do app tự vào, app sẽ tự thoát
    if (win.isFullScreen()) win.setFullScreen(false);
    return false;
  },
  voiceTyping: () => new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(false);
    // Bấm Win+H (Nhập bằng giọng nói của Windows) vào ô đang được chọn
    const ps = "Add-Type -Namespace W -Name K -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);';" +
      '[W.K]::keybd_event(0x5B,0,0,[UIntPtr]::Zero);[W.K]::keybd_event(0x48,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 60;' +
      '[W.K]::keybd_event(0x48,0,2,[UIntPtr]::Zero);[W.K]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)';
    const p = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', code => resolve(code === 0));
  }),
  skip: () => ctl.skip(),
  pause: () => ctl.pause(),
  resume: () => ctl.resume(),
  restart: () => ctl.restart(),
  setRepeat: on => ctl.setRepeat(on),
  seekTo: (p, d) => ctl.seekTo(p, d),
  playNow: id => ctl.playNow(id),
  remove: id => ctl.remove(id),
  react: id => { id = String(id || ''); if (!REACT_IDS.has(id)) return false; ctl.react(id); return true; },
  // Dán link: thêm bài theo link/mã video. -1 link sai · 0 đang phát · 1 đã thêm · 2 đã có · 3 đầy
  addLink: async url => {
    const id = parseVideoId(String(url || ''));
    if (!id) return -1;
    let m = null; try { m = await resolver.meta(id); } catch (e) { /* không lấy được tên: dùng tạm mã video */ }
    return ctl.addFromTv(id, m && m.title ? m.title : 'YouTube · ' + id, m && m.channel ? m.channel : '', m ? (Number(m.durationSec) | 0) : 0, false);
  },
  prioritize: id => ctl.prioritize(id),
  moveItem: (id, delta) => { const i = ctl.findQ(id); ctl.reorder(id, i + (Number(delta) < 0 ? -1 : 1)); },
  setVolume: v => ctl.setVolumeAbs(v),
  setDuck: (on, momentary) => ctl.setDuck(on, !!momentary),
  fadeOut: () => ctl.fadeOut(),
  changeVolume: d => ctl.changeVolume(d),
  setKaraoke: on => ctl.setKaraoke(on),
  // nhạc / video có sẵn trong máy (không cần mạng)
  localList: async () => ({ folders: library.folders, items: await library.list() }),
  localPickFiles: async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn nhạc / video trong máy', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Nhạc và video', extensions: Object.keys(MEDIA) }, { name: 'Tất cả file', extensions: ['*'] }]
    });
    return r.canceled ? 0 : library.addFiles(r.filePaths);
  },
  localPickFolder: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục nhạc / video', properties: ['openDirectory'] });
    return !r.canceled && r.filePaths[0] ? library.addFolder(r.filePaths[0]) : false;
  },
  // hình nền / video nền khi phát nhạc không có hình
  bgGet: () => bgInfo(),
  bgPick: async kind => {
    const img = kind === 'image';
    const r = await dialog.showOpenDialog(win, {
      title: img ? 'Chọn hình nền' : 'Chọn video nền', properties: ['openFile'],
      filters: [{ name: img ? 'Hình ảnh' : 'Video', extensions: img ? Object.keys(BG_IMAGE) : BG_VIDEO }]
    });
    if (r.canceled || !r.filePaths[0] || bgKindOf(r.filePaths[0]) !== (img ? 'image' : 'video')) return bgInfo();
    return bgApply(r.filePaths[0]);
  },
  bgUse: p => (typeof p === 'string' && path.isAbsolute(p) && bgKindOf(p) ? bgApply(p) : bgInfo()),
  bgClear: () => bgApply(''),
  getScreen: () => screenMode,
  setScreen: m => screenApply(m),
  // chọn một file nhạc/video rồi phát ngay (không cần thêm vào thư viện)
  localPlayPick: async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn nhạc / video để phát ngay', properties: ['openFile'],
      filters: [{ name: 'Nhạc và video', extensions: Object.keys(MEDIA) }, { name: 'Tất cả file', extensions: ['*'] }]
    });
    const f = r.canceled ? null : checkedLocal(r.filePaths[0]);
    return f ? ctl.playLocalNow(f) : -1;
  },
  localRemove: p => library.remove(String(p)),
  localAdd: (paths, priority) => enqueueLocal(paths, priority),
  localPlayNow: p => { const f = checkedLocal(p); return f ? ctl.playLocalNow(f) : 3; },
  /** Kéo thả: nhớ vào thư viện rồi cho vào hàng đợi (file đầu phát ngay nếu đang rảnh). */
  localDrop: async paths => {
    const r = await library.resolveDropped(Array.isArray(paths) ? paths.slice(0, 500) : []);
    const q = enqueueLocal(r.files.slice(0, 200), false);
    return { ...q, found: r.files.length, folders: r.folders, singles: r.singles };
  },
  // tải sẵn bài YouTube về máy (hộp thoại "Tải Sẵn Về Máy"). Tiến độ đẩy qua kênh 'dl-update' / 'dl-removed' / 'dl-library'.
  dlState: () => dl.state(),
  dlIds: () => dl.library.ids(),
  dlList: () => dl.library.entries(),
  // bài đã tải sẵn: 'phát ngay' / 'thêm vào hàng đợi' (controller tự dùng file trong máy cho mã này)
  dlPlayNow: id => { const e = dl.library.entries().find(x => x.videoId === String(id)); return e ? ctl.playYoutubeNow(e.videoId, e.title, '', 0) : 3; },
  dlAddQueue: (id, priority) => { const e = dl.library.entries().find(x => x.videoId === String(id)); return e ? ctl.addFromTv(e.videoId, e.title, '', 0, !!priority) : 3; },
  dlStart: scope => dl.start(scope && typeof scope === 'object' ? scope : {}),
  dlCancel: id => dl.cancel(String(id)),
  dlCancelAll: () => dl.cancelAll(),
  dlClear: id => dl.clear(String(id)),
  dlClearFinished: () => dl.clearFinished(),
  dlSetMode: m => dl.setMode(m),
  dlRescan: () => dl.rescan(),
  dlPickDir: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục lưu bài đã tải', defaultPath: dl.dir(), properties: ['openDirectory', 'createDirectory'] });
    return !r.canceled && r.filePaths[0] ? dl.setDir(r.filePaths[0]) : false;
  },
  dlResetDir: () => dl.resetDir(),
  dlOpenFolder: async () => {
    const d = dl.dir();
    try { require('fs').mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ }
    return (await shell.openPath(d)) === '';   // openPath trả chuỗi rỗng nếu thành công
  },
  // bảng hiệu ứng âm thanh riêng (file mp3 của bạn). Mọi thay đổi đều đẩy danh sách mới tới các cửa sổ qua kênh 'sfx-list'.
  sfxList: () => soundboard.list(),
  sfxPickFiles: async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn file âm thanh làm hiệu ứng', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Âm thanh', extensions: Object.keys(MEDIA).filter(e => MEDIA[e][0] === 'audio') }]
    });
    return r.canceled ? { added: [], skipped: 0, full: false } : sfxChanged(soundboard.addFiles(r.filePaths));
  },
  sfxAdd: paths => sfxChanged(soundboard.addFiles(Array.isArray(paths) ? paths.slice(0, 100) : [])),
  sfxPlay: id => playSfx(id),
  // nghe thử: trả gói phát về cho cửa sổ quản lý tự phát trên máy tính này (không gửi ra TV, không bị chống bấm dội)
  sfxPreview: id => soundboard.playPayload(id, f => proxy.localFile(f)),
  sfxStopAll: () => { ctl.sfxStop(); return true; },
  sfxUpdate: (id, patch) => { const r = soundboard.update(id, patch); if (r) sfxPush(); return r; },
  sfxRemove: id => { const r = soundboard.remove(id); if (r) sfxPush(); return r; },
  sfxMove: (id, to) => { const r = soundboard.move(id, to); if (r) sfxPush(); return r; },
  // kịch bản (bộ bài): đọc danh sách và chạy lá bài / nạp cả bộ vào hàng đợi
  decksList: () => decks.list(),
  deckRunCard: (deckId, cardId) => { const r = runAndMark(decks, deckId, cardId, deckEnv()); if (r.marked) livePush(); return r; },
  // chế độ dùng khi diễn ra buổi tiệc: bộ đang dùng, lá đã chạy, chạy lá kế tiếp (Space / Enter), đặt lại
  deckLive: () => decks.getLive(),
  deckSetActive: id => { const ok = decks.setActive(id); if (ok) livePush(); return ok; },
  deckRunNext: deckId => { const r = runNext(decks, deckId, deckEnv()); if (r.marked) livePush(); return r; },
  deckResetPlayed: deckId => { const ok = decks.resetPlayed(deckId); if (ok) livePush(); return ok; },
  deckQueueAll: deckId => queueDeck(decks.get(String(deckId)), deckEnv()),
  // kịch bản: quản lý bộ bài và lá bài (mọi thay đổi đều đẩy danh sách mới qua kênh 'decks-list')
  decksTemplates: () => Decks.templates(),
  deckCreate: (name, icon) => decksChanged(decks.create(name, icon)),
  deckFromTemplate: (key, name) => decksChanged(decks.createFromTemplate(String(key), name)),
  deckDuplicate: id => decksChanged(decks.duplicate(id)),
  deckUpdate: (id, patch) => { const r = decks.updateDeck(id, patch); if (r) decksPush(); return r; },
  deckRemove: id => { const r = decks.removeDeck(id); if (r) { decksPush(); livePush(); } return r; },
  deckMove: (id, to) => { const r = decks.moveDeck(id, to); if (r) decksPush(); return r; },
  cardAdd: (deckId, src, index) => decksChanged(decks.addCard(deckId, src, index)),
  deckAddCards: (deckId, srcs) => { const r = decks.addCards(deckId, Array.isArray(srcs) ? srcs.slice(0, 200) : []); if (r.added.length) decksPush(); return r; },
  cardAssign: (deckId, cardId, src) => { const r = decks.assignCard(deckId, cardId, src); if (r) decksPush(); return r; },
  // lưu hàng đợi hiện tại (cả bài đang phát nếu do người dùng thêm) thành bộ bài mới
  deckFromQueue: name => {
    const items = [];
    if (ctl.current && ctl.current.source === 'USER') items.push(ctl.current);
    for (const i of ctl.queue) items.push(i);
    return decksChanged(decks.createFromQueue(name, items.map(i => ({ videoId: i.videoId, title: i.title, channel: i.channel, durationSec: i.durationSec, local: i.local }))));
  },
  cardUpdate: (deckId, cardId, patch) => { const r = decks.updateCard(deckId, cardId, patch); if (r) decksPush(); return r; },
  cardRemove: (deckId, cardId) => { const r = decks.removeCard(deckId, cardId); if (r) { decksPush(); livePush(); } return r; },
  cardMove: (deckId, cardId, to) => { const r = decks.moveCard(deckId, cardId, to); if (r) decksPush(); return r; },
  // chữ chào mừng (gõ trên máy tính, hiện trên màn hình lớn)
  bannerInit: () => ({ list: banners.list(), cur: banners.current(), colors: BANNER_COLORS }),
  bannerSave: list => banners.saveList(list),
  bannerShow: b => banners.show(b),
  bannerHide: () => banners.hide(),
  getSettings: () => ({
    backend: settings.backend, maxHeight: settings.maxHeight, seedAutoplay: settings.seedAutoplay,
    gridCols: settings.gridCols, fullscreenSec: settings.fullscreenSec, qrHidden: settings.qrHidden,
    tickerMode: settings.tickerMode, tvOutput: settings.tvOutput, tvActive: !!(tv && tv.active()),
    duckLevel: settings.duckLevel, fadeInSec: settings.fadeInSec, fadeOutSec: settings.fadeOutSec, sfxDuck: settings.sfxDuck,
    dlDir: dl ? dl.dir() : '', dlMode: settings.dlMode
  }),
  setSetting: (k, v) => {
    const rule = SETTING_KEYS[k];
    if (!rule) throw new Error('Bad setting');
    if (rule === 'bool') settings[k] = !!v;
    else if (rule === 'int') settings[k] = Number(v) | 0;
    else if (rule.includes(v)) settings[k] = v;
    if (k === 'tvOutput') tv.sync();
    if (k === 'duckLevel') ctl.refreshGain();
    if (k === 'sfxDuck' && !settings.sfxDuck) ctl.setSfxDuck(false); // tắt tuỳ chọn khi đang hạ: trả nhạc ngay
    pushState();
  },
  setMaxHeight: h => { ctl.setMaxHeight(Number(h) || 720); pushState(); },
  resetPairing: () => { settings.token = newToken(); pushState(); },
  initial: () => ({ cats: Cats.load(store), favs: Favs.load(store), search: searchPayload(ctl.search) }),
  // tìm kiếm trên máy tính
  tvSearch: q => { q = clean(q, 200); if (q) tvSearch(q); },
  tvLoadMore: () => { tvLoadMore(); },
  doSearch: async raw => {
    const q = clean(raw, 200);
    if (!q) return null;
    if (q.includes('youtu') && parseVideoId(q)) {
      const id = parseVideoId(q);
      const m = await resolver.meta(id);
      ctl.addFromTv(id, m && m.title ? m.title : 'YouTube · ' + id, m ? m.channel : '', m ? m.durationSec : 0, false);
      return { link: true };
    }
    tvSearch(q);
    return { link: false };
  },
  addHit: (h, priority) => ctl.addFromTv(String(h.videoId), String(h.title || ''), String(h.channel || ''), Number(h.durationSec) | 0, !!priority),
  // thể loại
  catAdd: name => {
    const n = clean(name, 40);
    const list = Cats.load(store);
    if (!n || list.some(c => c.name.toLowerCase() === n.toLowerCase())) return -1;
    list.push({ name: n, q: n, custom: true });
    Cats.save(store, list); ctl.catsChanged();
    return list.length - 1;
  },
  catDelete: (idx, oldName) => {
    const list = Cats.load(store);
    if (!list[idx] || (oldName != null && list[idx].name !== oldName)) return false;
    list.splice(idx, 1); Cats.save(store, list); ctl.catsChanged();
    return true;
  },
  catsReset: () => {
    const list = Cats.load(store);
    const have = list.map(c => c.name);
    Cats.defaults().filter(c => !have.includes(c.name)).reverse().forEach(c => list.unshift(c));
    Cats.save(store, list); ctl.catsChanged();
  },
  // yêu thích (lưu chung, đồng bộ với điện thoại)
  favAdd: h => {
    const id = parseVideoId(h && h.videoId || '');
    if (!id) return false;
    const list = Favs.load(store);
    if (list.some(x => x.videoId === id)) return false;
    list.unshift({ videoId: id, title: clean(h.title, 200), channel: clean(h.channel, 100), durationSec: Math.max(0, Number(h.durationSec) | 0) });
    saveFavs(list);
    return true;
  },
  favMove: (id, delta) => {
    const list = Favs.load(store), i = list.findIndex(x => x.videoId === id);
    if (i < 0) return false;
    const j = i + (Number(delta) < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    saveFavs(list);
    return true;
  },
  playHitNow: h => ctl.playYoutubeNow(String(h.videoId), String(h.title || ''), String(h.channel || ''), Number(h.durationSec) | 0),
  favRemove: id => { const list = Favs.load(store).filter(x => x.videoId !== id); saveFavs(list); return true; }
};

function createTvWindow(display) {
  const b = display.bounds;
  const w = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, show: false, skipTaskbar: true,
    focusable: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, backgroundColor: '#000000', title: 'Youtube Player - TV',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  w.setMenu(null);
  w.setAlwaysOnTop(true, 'screen-saver'); // phủ cả thanh taskbar của màn hình ngoài
  w.loadURL('http://127.0.0.1:' + server.port + '/ui/tv.html');
  w.once('ready-to-show', () => { w.setBounds(b); w.showInactive(); }); // showInactive: không cướp phím của laptop
  w.webContents.on('before-input-event', (e) => e.preventDefault());
  return w;
}

function createDashboard() {
  win = new BrowserWindow({
    width: 1440, height: 860, minWidth: 1100, minHeight: 640, backgroundColor: '#08080c',
    title: 'Youtube Player', icon: path.join(__dirname, '..', 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.loadURL('http://127.0.0.1:' + server.port + '/ui/dashboard.html');
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; ctl.attachPlayer(false); });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  store = new Store(app.getPath('userData'));
  resolver.setLogDir(app.getPath('userData'));
  resolver.log('START v' + app.getVersion() + ' electron ' + process.versions.electron + ' ' + process.platform);
  settings = new Settings(store);
  searchSvc.setMaxMinutes(store.get('searchMaxMin', 0));   // 0 = không giới hạn thời lượng
  searchSvc.setStrictTitles(store.get('searchStrict', false));
  ctl = new Controller(settings, store, path.join(__dirname, 'seed.json'));
  banners = new Banners(store, b => broadcast('banner', b));
  library = new LocalLibrary(store);
  soundboard = new Soundboard(store);
  decks = new Decks(store, { sfxHas: id => !!soundboard.get(id) });
  dl = new DownloadService({
    settings, musicDir: app.getPath('music'),
    getFavs: () => Favs.load(store), getDecks: () => decks.list(),
    getQueueItems: () => [ctl.current, ...ctl.queue].filter(Boolean).map(i => ({ videoId: i.videoId, title: i.title, local: i.local }))
  });
  ctl.setDownloads(dl.library);
  try { await dl.library.scan(); } catch (e) { resolver.log('QUÉT THƯ MỤC TẢI LỖI ' + (e && e.message)); }   // quét trước khi phát để bài đã tải dùng được ngay
  dl.on('update', j => broadcast('dl-update', j));
  dl.on('removed', id => broadcast('dl-removed', id));
  dl.on('library', info => { ctl.noteDownloadsChanged(); broadcast('dl-library', info); pushState(); });
  proxy = new StreamProxy(() => 'http://127.0.0.1:' + server.port);
  server = new KaraokeServer({
    ctl, settings, store,
    // điện thoại remote: xem và chạy bộ bài; dùng lại đúng các hàm của cửa sổ máy tính nên dấu "đã chạy" cũng hiện bên đó ngay
    decksApi: {
      list: () => decks.list(), get: id => decks.get(id), live: () => decks.getLive(), liveOf: id => decks.liveOf(id),
      play: (deckId, cardId) => methods.deckRunCard(deckId, cardId),
      next: deckId => methods.deckRunNext(deckId),
      reset: deckId => methods.deckResetPlayed(deckId)
    },
    downloadedIds: () => dl.library.ids(),
    extraRoutes: (req, res, url) => proxy.route(req, res, url),
    webDir: path.join(__dirname, '..', 'web'),
    uiDir: path.join(__dirname, '..', 'renderer')
  });
  await server.listen();

  ipcMain.handle('ctl', async (_e, method, args) => {
    const fn = methods[method];
    if (!fn) throw new Error('Unknown method ' + method);
    return fn(...(Array.isArray(args) ? args : []));
  });

  for (const ev of ['ui', 'karaoke']) ctl.on(ev, () => pushState());
  ctl.on('search', s => broadcast('search', searchPayload(s)));
  ctl.on('cats', () => broadcast('cats', Cats.load(store)));
  ctl.on('favs', () => { broadcast('favs', Favs.load(store)); pushState(); });
  ctl.on('reaction', id => broadcast('reaction', id));
  ctl.on('sfx', id => playSfx(id));
  ctl.on('sfx-stop', () => broadcast('sfx-stop'));
  ctl.on('message', m => broadcast('message', m));
  ctl.on('volume', v => broadcast('volume', v));
  tv = new TvManager({
    screen, makeWindow: createTvWindow, getDash: () => win, ctl, getMode: () => settings.tvOutput
  });
  ctl.on('player', c => {
    let r = proxy.rewrite(c);
    if (r && r.type === 'load' && r.src && r.src.audioOnly) r = { ...r, bg: bgPayload() }; // nhạc không hình: kèm nền đã chọn
    tv.onCtlPlayer(r); tv.broadcastPlayer(r);
  });
  // Cửa sổ giữ trình phát báo trạng thái về bộ não
  // cửa sổ đang phát hiệu ứng báo số hiệu ứng còn chạy: >0 thì hạ nhạc (nếu bật tuỳ chọn), về 0 thì trả nhạc
  ipcMain.on('sfx-playing', (_e, d) => { if (settings.sfxDuck) ctl.setSfxDuck(Number(d && d.n) > 0); });
  ipcMain.on('player-event', (e, d) => { if (d && d.kind) tv.onPlayerEvent(e.sender.id, d); });
  ipcMain.on('player-ready', e => {
    if (win && e.sender.id === win.webContents.id) ctl.attachPlayer(true);
    tv.onPlayerReady(e.sender.id);
    if (screenMode !== 'LIVE') { try { e.sender.send('player', screenCmd()); } catch (x) { /* ignore */ } } // cửa sổ vừa mở (vd. mới cắm HDMI) giữ đúng chế độ màn hình
    // cửa sổ vừa mở (vd. mới cắm HDMI) phải hiện đúng chữ chào mừng đang bật
    const b = banners.current();
    if (b) { try { e.sender.send('banner', b); } catch (x) { /* ignore */ } }
  });
  // Màn hình thay đổi (cắm/rút HDMI, đổi độ phân giải...) -> đồng bộ cửa sổ TV (đợi 0,8 giây cho Windows ổn định)
  let syncT = null;
  const syncSoon = () => { clearTimeout(syncT); syncT = setTimeout(() => tv.sync(), 800); };
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, syncSoon);
  app.on('before-quit', () => tv.destroy());
  ctl.on('token', () => pushState());
  setInterval(pushState, 1000);

  ctl.start();
  createDashboard();
  win.on('move', syncSoon);
  win.on('moved', syncSoon);
  tv.sync();
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('activate', () => { if (!win) { createDashboard(); win.on('move', syncSoon); } });
});

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { try { if (dl) dl.stop(); ctl.stop(); store.flush(); server.close(); } catch (e) { /* ignore */ } });
