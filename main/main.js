'use strict';
const { app, BrowserWindow, ipcMain, Menu, shell, screen } = require('electron');
const path = require('path');
const QRCode = require('qrcode');

const { Store, Settings } = require('./store');
const { Controller } = require('./controller');
const { KaraokeServer } = require('./server');
const { Cats, Favs } = require('./data');
const { lanIp, newToken, netInfo, parseVideoId, clean } = require('./util');
const searchSvc = require('./search');
const resolver = require('./resolver');
const { StreamProxy } = require('./proxy');
const { TvManager } = require('./tv');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) { /* ignore */ } // link googlevideo gắn với IP lúc lấy link (yt-dlp -4) -> proxy cũng dùng IPv4

if (!app.requestSingleInstanceLock()) { app.quit(); }

let store, settings, ctl, server, proxy, tv, win = null;
let lastQrUrl = null, qrData = null;

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
  return { version: s.version, query: s.query, source: s.source, results: s.results.slice(0, 120), hasMore: s.hasMore, page: s.page, loading: s.loading, error: s.error };
}
function saveFavs(list) { Favs.save(store, list); ctl.bumpFavVersion(); ctl.emit('favs'); }

/** Các lệnh cửa sổ được phép gọi. */
const SETTING_KEYS = { backend: ['AUTO', 'STREAM', 'IFRAME'], seedAutoplay: 'bool', gridCols: [1, 2, 3], fullscreenSec: 'int', qrHidden: 'bool', tvOutput: ['AUTO', 'OFF'] };
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
  seekTo: (p, d) => ctl.seekTo(p, d),
  playNow: id => ctl.playNow(id),
  remove: id => ctl.remove(id),
  prioritize: id => ctl.prioritize(id),
  setVolume: v => ctl.setVolumeAbs(v),
  changeVolume: d => ctl.changeVolume(d),
  setKaraoke: on => ctl.setKaraoke(on),
  getSettings: () => ({
    backend: settings.backend, maxHeight: settings.maxHeight, seedAutoplay: settings.seedAutoplay,
    gridCols: settings.gridCols, fullscreenSec: settings.fullscreenSec, qrHidden: settings.qrHidden,
    tickerMode: settings.tickerMode, tvOutput: settings.tvOutput, tvActive: !!(tv && tv.active())
  }),
  setSetting: (k, v) => {
    const rule = SETTING_KEYS[k];
    if (!rule) throw new Error('Bad setting');
    if (rule === 'bool') settings[k] = !!v;
    else if (rule === 'int') settings[k] = Number(v) | 0;
    else if (rule.includes(v)) settings[k] = v;
    if (k === 'tvOutput') tv.sync();
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
  ctl = new Controller(settings, store, path.join(__dirname, 'seed.json'));
  proxy = new StreamProxy(() => 'http://127.0.0.1:' + server.port);
  server = new KaraokeServer({
    ctl, settings, store,
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
  ctl.on('message', m => broadcast('message', m));
  ctl.on('volume', v => broadcast('volume', v));
  tv = new TvManager({
    screen, makeWindow: createTvWindow, getDash: () => win, ctl, getMode: () => settings.tvOutput
  });
  ctl.on('player', c => { const r = proxy.rewrite(c); tv.onCtlPlayer(r); tv.broadcastPlayer(r); });
  // Cửa sổ giữ trình phát báo trạng thái về bộ não
  ipcMain.on('player-event', (e, d) => { if (d && d.kind) tv.onPlayerEvent(e.sender.id, d); });
  ipcMain.on('player-ready', e => {
    if (win && e.sender.id === win.webContents.id) ctl.attachPlayer(true);
    tv.onPlayerReady(e.sender.id);
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
app.on('before-quit', () => { try { ctl.stop(); store.flush(); server.close(); } catch (e) { /* ignore */ } });
