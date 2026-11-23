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
const methods = {
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
