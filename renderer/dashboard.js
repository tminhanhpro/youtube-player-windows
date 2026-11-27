'use strict';
// Giao diện TV 3 cột (port từ MainActivity của bản Android):
// [QR + thể loại] [tìm kiếm + lưới kết quả] [đang phát + hàng đợi]
const $ = id => document.getElementById(id);
const bridge = window.ytp; // KHÔNG đặt tên trùng "ytp": contextBridge đã khai báo window.ytp, khai báo lại bằng const sẽ gây SyntaxError
const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const thumb = id => 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
document.querySelectorAll('[data-i]').forEach(el => { el.innerHTML = window.ICONS[el.dataset.i] || ''; });
$('remoteDot').innerHTML = window.ICONS.dot;

// ------------------------------------------------------------------ trạng thái
let snap = null, info = null, cfg = { gridCols: 3, fullscreenSec: 5, qrHidden: false, maxHeight: 720, backend: 'AUTO', seedAutoplay: true };
let cats = [], favs = [], search = { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null };
let selCat = -1, favMode = false, favSearchQuery = '', startedSearch = false;
let fullscreen = false, fsAt = 0, lastControlAt = Date.now(), dialogs = 0, savedFocus = null;
let dlSet = new Set(), dlVerSeen = null;   // mã các bài đã tải sẵn về máy (lấy lại khi snap.dlVer đổi)
let shown = { q: '', n: 0, first: null, cols: 0 }, lastQueueSig = '', lastQr = null, shiftHeld = false;
let voiceWasPlaying = false, tvActive = false, winFsByUs = false, voiceT = null;

// ------------------------------------------------------------------ trình phát
const player = window.createPlayer($('vbox'), (kind, key, a, b) => bridge.send('player-event', { kind, key, a, b }));
bridge.on('player', c => player.command(c));

// ------------------------------------------------------------------ hiệu ứng cổ vũ + tin nhắn từ điện thoại
// Khi đã xuất ra màn hình lớn thì hiệu ứng chỉ chạy trên màn lớn (tránh chạy trùng ở cả hai nơi)
const fx = window.createFx($('fxl'));
bridge.on('reaction', id => { if (!tvActive) fx.react(id); });
bridge.on('message', m => { if (!tvActive) fx.message(m.sender, m.text); });
// hiệu ứng âm thanh riêng: khi đã xuất ra TV thì chỉ phát trên TV (tránh phát trùng ở hai nơi)
const sfx = window.createSfx({ onChange: n => bridge.send('sfx-playing', { n }) }); // chỉ báo khi chính cửa sổ này phát (không xuất TV); khi có TV thì TV báo
const previewSfx = window.createSfx(); // nghe thử trong cửa sổ quản lý: luôn phát trên máy tính này, kể cả khi đang xuất ra TV
bridge.on('sfx', m => { if (!tvActive) sfx.play(m); });
bridge.on('sfx-stop', () => { sfx.stopAll(); previewSfx.stopAll(); });

// ------------------------------------------------------------------ tiện ích
let toastT = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200);
}

/** Hộp thoại: { title, lines[], input:{placeholder}, list:[{label,run}], buttons:[{label,primary,run}], focus } */
function modal(o) {
  const root = $('modal');
  const d = document.createElement('div');
  d.className = 'dlg' + (o.cls ? ' ' + o.cls : ''); d.setAttribute('role', 'dialog');
  let html = '<h2>' + esc(o.title || '') + '</h2>';
  (o.lines || []).forEach(l => { html += '<p' + (l.style ? ' style="' + l.style + '"' : '') + '>' + esc(l.text || l) + '</p>'; });
  d.innerHTML = html;
  if (o.pre != null) { const pre = document.createElement('pre'); pre.className = 'logpre'; pre.textContent = o.pre; d.appendChild(pre); setTimeout(() => { pre.scrollTop = pre.scrollHeight; }, 0); }
  let input = null;
  if (o.input) { input = document.createElement('input'); input.placeholder = o.input.placeholder || ''; d.appendChild(input); }
  const close = () => { root.hidden = true; root.innerHTML = ''; dialogs = Math.max(0, dialogs - 1); document.removeEventListener('keydown', onKey, true); lastControlAt = Date.now(); if (prevFocus && prevFocus.isConnected) prevFocus.focus(); };
  const prevFocus = document.activeElement;
  if (o.list) {
    const l = document.createElement('div'); l.className = 'dlist';
    o.list.forEach(it => { const b = document.createElement('button'); b.textContent = it.label; b.onclick = () => { close(); it.run && it.run(); }; l.appendChild(b); });
    d.appendChild(l);
  }
  const btns = document.createElement('div'); btns.className = 'dbtns';
  const made = (o.buttons || []).map(bt => {
    const b = document.createElement('button'); b.className = 'dbtn' + (bt.primary ? ' primary' : ''); b.textContent = bt.label;
    b.onclick = () => { const v = input ? input.value : null; close(); bt.run && bt.run(v); };
    btns.appendChild(b); return b;
  });
  if (made.length) d.appendChild(btns);
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.repeat && document.activeElement && document.activeElement.tagName === 'BUTTON' && d.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); } // đang giữ Enter (vừa mở hộp thoại bằng giữ OK): không bấm lặp vào nút
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && d.querySelector('.dlist') && document.activeElement && document.activeElement.tagName === 'BUTTON' && d.contains(document.activeElement)) {
      const bs = [...d.querySelectorAll('.dlist button, .dbtn')].filter(b => !b.disabled), i = bs.indexOf(document.activeElement);
      if (i >= 0) { e.preventDefault(); e.stopPropagation(); bs[Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus(); }
    }
    else if (e.key === 'Enter' && input && document.activeElement === input) { e.preventDefault(); e.stopPropagation(); const p = made.find((_, i) => o.buttons[i].primary) || made[0]; p && p.click(); }
  };
  document.addEventListener('keydown', onKey, true);
  root.innerHTML = ''; root.appendChild(d); root.hidden = false; dialogs++;
  setTimeout(() => {
    const first = d.querySelector('.dlist button');
    const f = input || (o.focus != null && made[o.focus]) || first || made[made.length - 1];
    f && f.focus();
  }, 0);
  return { close };
}

// ------------------------------------------------------------------ trạng thái từ tiến trình chính
bridge.on('state', s => { snap = s.snap; info = s.info; cfg = s.info.cfg || cfg; applyTheme(cfg.theme); renderState(); });
bridge.on('search', s => { search = s; renderSearch(); });
bridge.on('cats', l => { const q = cats[selCat] && cats[selCat].q; cats = l; selCat = q == null ? -1 : cats.findIndex(c => c.q === q); renderCats(); });
bridge.on('favs', l => { favs = l; if (favMode) { renderFavs(favFocus); favFocus = 0; } else refreshHearts(); });
bridge.on('volume', showVolume);
// Có màn hình lớn: tiếng ra màn lớn, khung nhỏ ở đây chỉ chạy hình (tắt tiếng) và không tự phóng to
bridge.on('tv-state', t => { tvActive = !!t.active; player.setMuted(tvActive); renderState(); });

// Nhãn "Đã tải": giữ một tập mã; số phiên bản trong trạng thái đổi thì hỏi lại danh sách, rồi vẽ lại nhãn tại chỗ.
function syncDl() {
  if (!snap || typeof snap.dlVer !== 'number' || snap.dlVer === dlVerSeen) return;
  dlVerSeen = snap.dlVer;
  bridge.call('dlIds').then(ids => {
    dlSet = new Set(Array.isArray(ids) ? ids : []);
    refreshDlBadges(); lastQueueSig = ''; if (snap) renderQueue();
  }).catch(() => { dlVerSeen = null; });
}
function refreshDlBadges() {
  document.querySelectorAll('.cardv[data-vid]').forEach(c => c.classList.toggle('dl', dlSet.has(c.dataset.vid)));
}

function renderState() {
  if (!snap || !info) return;
  syncDl();
  // đầu trang
  const rc = info.remoteConnected;
  $('remoteDot').className = 'ic dotic' + (rc ? ' on' : '');
  $('remote').className = 'remote' + (rc ? ' on' : '');
  $('remote').textContent = rc ? 'Remote Đã Kết Nối' + (info.who ? ' (' + info.who + ')' : '') : 'Chờ điện thoại kết nối';
  $('netText').textContent = info.net.text; $('netIcon').innerHTML = window.ICONS[info.net.icon] || window.ICONS.wifi;
  $('clock').textContent = new Date().toTimeString().slice(0, 5);
  // QR
  $('port').textContent = 'CỔNG ' + info.port;
  if (info.qr) {
    if (lastQr !== info.qr) { $('qr').src = info.qr; lastQr = info.qr; }
    $('qr').hidden = false; $('qrCap').textContent = 'Mở camera quét để điều khiển'; $('qrUrl').textContent = info.host;
  } else { $('qr').hidden = true; lastQr = null; $('qrCap').textContent = 'Hãy kết nối Wi-Fi/LAN để dùng mã QR'; $('qrUrl').textContent = ''; }
  $('qual').textContent = 'Tối đa ' + cfg.maxHeight + 'p · ' + cfg.backend;
  // lưới
  applyGrid();
  // đang phát
  const st = snap.state, np = snap.nowPlaying;
  const playing = st === 'PLAYING' || st === 'PAUSED';
  $('idle').textContent = playing ? '' : (
    snap.netWait ? 'Mất kết nối mạng, đang thử lại…' :
    st === 'ERROR' ? 'Không phát được bài này, đang chuyển bài…' + (snap.error && snap.error.detail ? '\n(' + snap.error.detail + ')' : '') :
    st === 'IDLE' ? 'Chưa phát bài nào\nChọn bài ở danh sách hoặc dùng điện thoại' :
    'Đang tải bài hát…');
  $('badge').textContent = (st === 'PAUSED' ? 'ĐANG TẠM DỪNG' : 'NOW PLAYING') + (snap.duck ? ' · MC NÓI' : '') + (tvActive ? ' · ĐANG XUẤT RA TV' : '');
  $('b-mc').classList.toggle('on', !!snap.duck);
  $('b-repeat').classList.toggle('on', !!snap.repeat); $('repLbl').textContent = snap.repeat ? 'Đang lặp lại bài này (bấm để tắt)' : 'Lặp lại';
  if (!volDrag && typeof snap.volume === 'number') $('volRange').value = snap.volume;
  $('mcLbl').textContent = snap.duck ? 'MC đang nói · bấm: nhạc lại (M)' : 'MC nói · hạ nhạc (M)';
  $('b-fade').classList.toggle('on', !!snap.fading);
  $('fadeLbl').textContent = snap.fading ? 'Đang tắt dần… bấm để huỷ' : 'Fade out (O)';
  $('playIc').innerHTML = window.ICONS[st === 'PAUSED' ? 'play' : 'pause'];
  $('title').textContent = np ? np.title : 'Chưa có bài hát';
  $('sub').textContent = np ? np.channel : '';
  $('tl').textContent = mmss(snap.positionMs); $('tr').textContent = mmss(snap.durationMs);
  $('barFill').style.width = (snap.durationMs > 0 ? Math.min(100, snap.positionMs * 100 / snap.durationMs) : 0) + '%';
  const h = player.height(); $('res').textContent = h ? h + 'p' : '';
  if (st === 'IDLE') exitFullscreen();
  // karaoke
  $('karaoke').classList.toggle('on', !!snap.karaoke);
  $('karaoke').setAttribute('aria-pressed', snap.karaoke ? 'true' : 'false');
  renderQueue();
  if (!startedSearch && cats.length && !search.query) { startedSearch = true; selectCat(0); }
}

// ------------------------------------------------------------------ hàng đợi
function renderQueue() {
  const items = snap.queue;
  $('qcount').textContent = items.length + ' bài';
  const total = items.reduce((a, b) => a + (b.durationSec || 0), 0), m = Math.floor(total / 60);
  $('qtotal').textContent = !items.length ? 'Hàng đợi trống' : total <= 0 ? 'Tổng thời gian: —' :
    m < 60 ? 'Tổng thời gian: ' + Math.max(1, m) + ' phút' : 'Tổng thời gian: ' + Math.floor(m / 60) + ' giờ ' + (m % 60) + ' phút';
  const sig = items.map(i => i.itemId + i.title + (!i.local && dlSet.has(i.videoId) ? '*' : '')).join('|');
  if (sig === lastQueueSig) return;
  lastQueueSig = sig;
  const box = $('qlist');
  const fi = [...box.children].findIndex(c => c === document.activeElement);
  box.innerHTML = '';
  if (!items.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Chưa có bài nào chờ.\nChọn bài ở giữa hoặc dùng điện thoại để thêm.'; box.appendChild(e); return; }
  items.forEach((qi, i) => {
    const r = document.createElement('div');
    r.className = 'q'; r.tabIndex = 0; r.dataset.kind = 'queue';
    r.innerHTML = '<span class="n">' + (i + 1) + '</span>' + (qi.local ? '<span class="lth">♪</span>' : '<img src="' + esc(thumb(qi.videoId)) + '" alt="">') + '<div class="i"><div class="t ell">' + esc(qi.title) +
      '</div><div class="a ell">' + (qi.local ? 'Trong máy' : (dlSet.has(qi.videoId) ? '<span class="dlq">⬇ Đã tải sẵn</span> · ' : '') + (qi.addedBy ? 'Yêu cầu từ: ' + esc(qi.addedBy) : 'Tự động đề xuất')) + '</div></div>' +
      '';
    const info = r.querySelector('.i');
    if (qi.durationSec > 0) r.querySelector('.a').insertAdjacentHTML('beforeend', ' · ' + mmss(qi.durationSec * 1000));
    const qa = document.createElement('div'); qa.className = 'qa';
    const qbtn = (cls, icon, title, fn, dis) => {
      const b = document.createElement('button'); b.className = cls + ' nav'; b.title = title; b.setAttribute('aria-label', title); b.disabled = !!dis;
      b.innerHTML = window.ICONS[icon]; b.onclick = e => { e.stopPropagation(); fn(); }; qa.appendChild(b);
    };
    qbtn('qp', 'play', 'Phát ngay', () => bridge.call('playNow', [qi.itemId]).catch(() => toast('Bài này không còn trong hàng đợi')));
    qbtn('qu', 'up', 'Dời lên', () => bridge.call('moveItem', [qi.itemId, -1]).catch(() => {}), i === 0);
    qbtn('qd', 'down', 'Dời xuống', () => bridge.call('moveItem', [qi.itemId, 1]).catch(() => {}), i === items.length - 1);
    qbtn('qx', 'trash', 'Xoá khỏi hàng đợi', () => r._remove());
    info.appendChild(qa);
    r.onclick = () => bridge.call('playNow', [qi.itemId]).catch(() => toast('Bài này không còn trong hàng đợi'));
    r._remove = () => bridge.call('remove', [qi.itemId]).then(() => toast('Đã xoá khỏi hàng đợi')).catch(() => {});
    r._long = r._remove;
    r.oncontextmenu = e => { e.preventDefault(); r._remove(); };
    box.appendChild(r);
  });
  if (fi >= 0 && box.children.length) box.children[Math.min(fi, box.children.length - 1)].focus();
}

// ------------------------------------------------------------------ lưới kết quả
const isFav = id => favs.some(f => f.videoId === id);
function applyGrid() {
  const cols = Math.min(3, Math.max(1, cfg.gridCols || 3));
  const g = $('grid');
  const cls = 'scroll grid' + (cols === 2 ? ' c2' : cols === 1 ? ' c1' : '');
  if (g.className !== cls) { g.className = cls; shown = { q: '', n: 0, first: null, cols }; if (favMode) renderFavs(0); else renderSearch(); }
}

// nút "Tải về" ngay trên thẻ kết quả tìm kiếm: đưa bài vào hàng tải (xem tiến độ ở nút Tải Sẵn Về Máy)
async function downloadNow(h, btn) {
  if (btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  try {
    const r = await bridge.call('dlStart', [{ type: 'ids', ids: [h.videoId], items: [{ videoId: h.videoId, title: h.title }] }]);
    toast(!r || r.error ? (r && r.error) || 'Không bắt đầu được việc tải' :
      r.added ? 'Đang tải về máy: ' + h.title :
      r.have ? 'Bài này đã tải sẵn rồi' : r.queued ? 'Bài này đang trong hàng tải' : 'Không tải được bài này');
  } catch (e) { toast('Lỗi: ' + e.message); }
  setTimeout(() => btn.classList.remove('busy'), 1500);
}
function makeCard(h, idx) {
  const c = document.createElement('div');
  c.className = 'cardv' + (isFav(h.videoId) ? ' fav' : '') + (dlSet.has(h.videoId) ? ' dl' : ''); c.tabIndex = 0; c.dataset.kind = 'card'; c.dataset.vid = h.videoId;
  c.innerHTML = '<div class="th"><img loading="lazy" src="' + esc(thumb(h.videoId)) + '" alt="">' +
    (h.durationSec > 0 ? '<span class="dur">' + mmss(h.durationSec * 1000) + '</span>' : '') +
    '<button class="dlnow" title="Tải bài này về máy" aria-label="Tải về máy" tabindex="-1"><span class="ic">' + window.ICONS.download + '</span></button>' +
    '<span class="ic h">' + window.ICONS.heart + '</span><span class="dlb" title="Đã tải sẵn về máy">⬇ Đã tải</span></div><div class="tx"><div class="ct">' + esc(h.title) + '</div><div class="cc">' + esc(h.channel) + '</div></div>';
  c.onclick = e => addHit(h, e.shiftKey || shiftHeld);
  const dlb = c.querySelector('.dlnow');
  dlb.onclick = e => { e.stopPropagation(); e.preventDefault(); downloadNow(h, dlb); };
  dlb.onmousedown = e => e.stopPropagation();
  c._long = () => openCardMenu(h);
  c.oncontextmenu = e => { e.preventDefault(); openCardMenu(h); };
  c._remove = () => { if (favMode) removeFav(h); };
  c.onfocus = () => { if (!favMode && idx >= (search.results.length - 4)) bridge.call('tvLoadMore'); };
  if (favMode) { // Yêu thích: cuối mỗi bài có nút phát / dời lên / dời xuống / xoá
    const qa = document.createElement('div'); qa.className = 'qa';
    const fb = (cls, icon, title, fn, dis) => {
      const b = document.createElement('button'); b.className = cls + ' nav'; b.title = title; b.setAttribute('aria-label', title); b.disabled = !!dis;
      b.innerHTML = window.ICONS[icon]; b.onclick = e => { e.stopPropagation(); fn(); }; b.onmousedown = e => e.stopPropagation(); qa.appendChild(b);
    };
    fb('qp', 'play', 'Phát ngay', async () => { await bridge.call('playHitNow', [h]); toast('Đang phát: ' + h.title); });
    fb('qu', 'up', 'Dời lên (đứng trước)', () => { favFocus = idx - 1; bridge.call('favMove', [h.videoId, -1]); }, idx === 0);
    fb('qd', 'down', 'Dời xuống (đứng sau)', () => { favFocus = idx + 1; bridge.call('favMove', [h.videoId, 1]); }, idx === favs.length - 1);
    fb('qx', 'trash', 'Xoá khỏi Yêu thích', () => removeFav(h));
    c.querySelector('.tx').appendChild(qa);
  }
  return c;
}

function chanStatus(sv) {
  const n = '“' + sv.channel + '”';
  return sv.loading && !sv.results.length ? 'Đang tìm bài của kênh ' + n + '…' :
    sv.error && !sv.results.length ? 'Không tìm được: ' + sv.error :
    !sv.results.length ? 'Không thấy bài nào của kênh ' + n :
    'Bài của kênh ' + n + ' · ' + sv.results.length + ' bài' + (sv.loading ? ' · đang tải thêm…' : '');
}
function renderSearch() {
  const sv = search;
  if (favMode) { if (sv.query === favSearchQuery) return; leaveFavMode(); }
  $('status').textContent = sv.channel ? chanStatus(sv) :
    sv.loading && !sv.results.length ? 'Đang tìm “' + sv.query + '”…' :
    sv.error && !sv.results.length ? 'Không tìm được: ' + sv.error :
    !sv.query ? 'Chọn thể loại bên trái hoặc gõ tên bài hát để tìm' :
    !sv.results.length ? 'Không có kết quả cho “' + sv.query + '”' :
    'Kết quả cho “' + sv.query + '”' + (sv.source === 'remote' ? ' · từ điện thoại' : '') + (sv.loading ? ' · đang tải thêm…' : '');
  if (document.activeElement !== $('q') && sv.query !== $('q').value) $('q').value = sv.query;
  if (sv.source === 'remote') syncCatToQuery(sv.query);
  const res = sv.results;
  const cols = Math.min(3, Math.max(1, cfg.gridCols || 3));
  const first = res[0] && res[0].videoId;
  if (sv.query === shown.q && res.length === shown.n && first === shown.first && shown.cols === cols) return;
  const append = sv.query === shown.q && shown.n > 0 && res.length > shown.n && first === shown.first && shown.cols === cols;
  const g = $('grid');
  let fIdx = [...g.children].indexOf(document.activeElement);
  if (!append) { g.innerHTML = ''; g.scrollTop = 0; }
  for (let i = append ? shown.n : 0; i < res.length; i++) g.appendChild(makeCard(res[i], i));
  shown = { q: sv.query, n: res.length, first, cols };
  if (fIdx >= 0 && g.children[fIdx]) g.children[fIdx].focus();
  // nếu chưa đầy khung thì tải thêm
  setTimeout(maybeMore, 50);
}
function maybeMore() {
  const g = $('grid');
  if (favMode || search.loading || !search.hasMore || !search.query) return;
  if (g.scrollHeight - g.scrollTop - g.clientHeight < 500) bridge.call('tvLoadMore');
}
$('grid').addEventListener('scroll', maybeMore);

// ------------------------------------------------------------------ menu của bài hát (chuột phải, hoặc giữ OK/Enter ≥ 0,6 giây)
function openCardMenu(h) {
  const fav = isFav(h.videoId);
  const items = [
    { label: fav ? 'Xoá khỏi Yêu thích' : 'Thêm vào Yêu thích', run: () => (fav ? removeFav(h) : addFav(h)) },
    h.channel ? { label: 'Xem bài của kênh này', run: () => searchChannel(h.channel) } : null,
    { label: 'Phát ngay', run: async () => { await bridge.call('playHitNow', [h]); toast('Đang phát: ' + h.title); } },
    { label: 'Thêm vào hàng đợi', run: () => addHit(h, false) },
    { label: 'Mở trang kênh trên YouTube', run: () => openChannelPage(h) }
  ].filter(Boolean);
  modal({ title: h.title, cls: 'cmenu', lines: h.channel ? [h.channel] : [], list: items, buttons: [{ label: 'ĐÓNG' }] });
}
function searchChannel(name) {
  name = String(name || '').trim(); if (!name) return;
  syncCatToQuery(name); leaveFavMode(); $('q').value = name;
  bridge.call('tvSearchChannel', [name]);
}
async function openChannelPage(h) {
  toast('Đang mở trang kênh…');
  try {
    const r = await bridge.call('openChannel', [h]);
    if (!r || !r.ok) toast('Không mở được trang kênh');
    else if (r.fallback) toast('Không lấy được link kênh, đã mở trang tìm kênh “' + (h.channel || '') + '”');
  } catch (e) { toast('Không mở được trang kênh'); }
}

async function addHit(h, priority) {
  const code = await bridge.call('addHit', [h, !!priority]);
  toast(code === 0 ? 'Đang phát: ' + h.title : code === 1 ? (priority ? 'Đã thêm lên đầu hàng đợi' : 'Đã thêm vào hàng đợi') : code === 2 ? 'Bài này đã có trong hàng đợi' : 'Hàng đợi đã đầy');
}

// ------------------------------------------------------------------ yêu thích
function refreshHearts() { document.querySelectorAll('.cardv').forEach(c => c.classList.toggle('fav', isFav(c.dataset.vid))); }
async function addFav(h) {
  if (isFav(h.videoId)) { toast('Bài này đã có trong Yêu thích'); return; }
  favs.unshift(h); refreshHearts();
  await bridge.call('favAdd', [h]);
  toast('❤ Đã thêm vào Yêu thích: ' + h.title);
}
async function removeFav(h) {
  const pos = favs.findIndex(f => f.videoId === h.videoId);
  if (pos < 0) return;
  favs.splice(pos, 1);
  await bridge.call('favRemove', [h.videoId]);
  toast('Đã xoá khỏi Yêu thích');
  if (favMode) renderFavs(pos);
}
function showFavorites() {
  favMode = true; favSearchQuery = search.query; selCat = -1;
  renderCats(); $('favBtn').classList.add('on'); $('homeBtn').classList.add('back'); $('homeBtn').title = 'Quay lại kết quả tìm kiếm'; renderFavs(0);
}
function leaveFavMode() {
  if (!favMode) return;
  favMode = false; $('favBtn').classList.remove('on'); $('homeBtn').classList.remove('back'); $('homeBtn').title = 'Về kết quả tìm kiếm';
  shown = { q: '', n: 0, first: null, cols: 0 }; $('grid').innerHTML = '';
}
let favFocus = 0;
function renderFavs(focusIdx) {
  const g = $('grid'); const keepTop = g.scrollTop; g.innerHTML = '';
  shown = { q: '\u0000fav', n: -1, first: null, cols: 0 };
  $('status').textContent = favs.length ? '❤ Yêu thích · ' + favs.length + ' bài · Enter: thêm vào danh sách phát · Chuột phải / giữ Enter: xoá khỏi Yêu thích'
    : 'Chưa có bài yêu thích. Khi tìm kiếm, bấm chuột phải (hoặc giữ Enter) trên bài hát để thêm vào đây.';
  favs.forEach((h, i) => g.appendChild(makeCard(h, i)));
  g.scrollTop = keepTop;
  const t = g.children[Math.min(focusIdx, g.children.length - 1)];
  if (t && !fullscreen) t.focus({ preventScroll: true }); else if (!g.children.length) $('favBtn').focus();
}
$('favBtn').onclick = showFavorites;

// ------------------------------------------------------------------ thể loại
function renderCats() {
  const box = $('cats');
  const fi = [...box.children].findIndex(c => c === document.activeElement || c.contains(document.activeElement));
  box.innerHTML = '';
  cats.forEach((ct, i) => {
    const r = document.createElement('div');
    r.className = 'cat' + (i === selCat ? ' sel' : ''); r.tabIndex = 0; r.dataset.kind = 'cat';
    r.innerHTML = '<span class="ic">' + window.ICONS.note + '</span><span class="nm ell">' + esc(ct.name) + '</span>';
    const del = document.createElement('button'); del.className = 'del nav'; del.textContent = 'Xoá';
    del.onclick = e => { e.stopPropagation(); confirmDeleteCat(i); };
    r.appendChild(del);
    r.onclick = () => selectCat(i);
    r._long = () => confirmDeleteCat(i); r._remove = r._long;
    r.oncontextmenu = e => { e.preventDefault(); confirmDeleteCat(i); };
    box.appendChild(r);
  });
  if (fi >= 0 && box.children.length) box.children[Math.min(fi, box.children.length - 1)].focus();
}
function selectCat(i) {
  const ct = cats[i]; if (!ct) return;
  closeCatMenu();
  selCat = i; renderCats(); $('q').value = ct.q; tvSearch(ct.q);
}
function syncCatToQuery(q) {
  const idx = cats.findIndex(c => c.q.toLowerCase() === String(q).trim().toLowerCase());
  if (idx !== selCat) { selCat = idx; renderCats(); }
}
function tvSearch(q) { leaveFavMode(); bridge.call('tvSearch', [q]); }
async function doSearch(raw) {
  const q = raw.trim(); if (!q) return;
  const r = await bridge.call('doSearch', [q]);
  if (r && r.link) toast('Đã thêm bài từ link'); else { syncCatToQuery(q); leaveFavMode(); }
}
function confirmDeleteCat(i) {
  const ct = cats[i]; if (!ct) return;
  modal({
    title: 'Xoá thể loại này?',
    lines: [{ text: '“' + ct.name + '”', style: 'color:#ff1744;font-weight:700;font-size:30px' }, 'Thể loại sẽ bị xoá khỏi danh mục.\nCó thể tạo lại hoặc khôi phục trong Cài đặt.'],
    buttons: [{ label: 'XOÁ', primary: true, run: async () => { await bridge.call('catDelete', [i, ct.name]); toast('Đã xoá thể loại “' + ct.name + '”'); } }, { label: 'GIỮ LẠI' }],
    focus: 1 // mặc định "GIỮ LẠI" để bấm nhầm Enter không bị xoá
  });
}
// nút "Danh Mục" trong ô tìm kiếm: xổ xuống gồm "Tạo Thể Loại Mới" + tất cả danh mục âm nhạc
function closeCatMenu() { $('catMenu').hidden = true; $('catBtn').setAttribute('aria-expanded', 'false'); }
function toggleCatMenu() {
  const open = $('catMenu').hidden;
  $('catMenu').hidden = !open; $('catBtn').setAttribute('aria-expanded', String(open));
  if (open) { const s = $('cats').querySelector('.cat.sel') || $('cats').querySelector('.cat'); if (s) s.scrollIntoView({ block: 'nearest' }); }
}
$('catBtn').onclick = toggleCatMenu;
document.addEventListener('mousedown', e => { if (!$('catMenu').hidden && !e.target.closest('.catwrap')) closeCatMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('catMenu').hidden) { e.preventDefault(); e.stopPropagation(); closeCatMenu(); $('catBtn').focus(); } }, true);
$('addCat').addEventListener('click', closeCatMenu);
$('addCat').onclick = () => modal({
  title: 'Tạo thể loại mới (tên cũng là từ khoá tìm)', input: { placeholder: 'Ví dụ: Nhạc không lời' },
  buttons: [{ label: 'Tạo', primary: true, run: async v => { const i = await bridge.call('catAdd', [v || '']); if (i >= 0) setTimeout(() => selectCat(i), 100); } }, { label: 'Hủy' }]
});
// nút QR trên đầu trang: bấm hiện popup mã QR (không chiếm chỗ của kết quả/hàng đợi)
function closeQrPop() { $('qrPop').hidden = true; $('qrBtn').setAttribute('aria-expanded', 'false'); }
$('qrBtn').onclick = () => { const open = $('qrPop').hidden; $('qrPop').hidden = !open; $('qrBtn').setAttribute('aria-expanded', String(open)); };
document.addEventListener('mousedown', e => { if (!$('qrPop').hidden && !e.target.closest('#qrPop, #qrBtn')) closeQrPop(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('qrPop').hidden) { e.preventDefault(); e.stopPropagation(); closeQrPop(); $('qrBtn').focus(); } }, true);

// ------------------------------------------------------------------ karaoke, tìm kiếm, giọng nói
$('karaoke').onclick = async () => {
  const on = !(snap && snap.karaoke);
  await bridge.call('setKaraoke', [on]);
  toast(on ? 'Karaoke: BẬT — mọi tìm kiếm tự thêm chữ karaoke' : 'Karaoke: TẮT');
  const q = search.query.trim(); if (q) tvSearch(q);
};
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch($('q').value); $('q').blur(); resumeAfterVoice(); } });
// icon góc trái trên cùng: đang ở Yêu thích thì quay về kết quả tìm kiếm trước đó
$('homeBtn').onclick = () => {
  closeCatMenu(); closeQrPop(); closeFxPop();
  if (favMode) { leaveFavMode(); $('q').value = search.query || ''; renderSearch(); syncCatToQuery(search.query); }
  const g = $('grid'); g.scrollTop = 0;
};
$('goSearch').onclick = () => { doSearch($('q').value); $('q').blur(); resumeAfterVoice(); };
// Dán Link: thêm bài YouTube bằng link / mã video vào hàng đợi (giống nút Dán link trên remote)
$('addSong').onclick = () => modal({
  title: 'Dán link YouTube', lines: ['Dán link YouTube hoặc mã video để thêm vào hàng đợi.'], input: { placeholder: 'https://www.youtube.com/watch?v=...' },
  buttons: [{ label: 'Thêm', primary: true, run: async v => {
    v = (v || '').trim(); if (!v) return;
    const code = await bridge.call('addLink', [v]);
    toast(code === -1 ? 'Link YouTube không hợp lệ' : code === 0 ? 'Đang phát bài vừa dán' : code === 1 ? 'Đã thêm vào hàng đợi' : code === 2 ? 'Bài này đã có trong hàng đợi' : 'Hàng đợi đã đầy');
  } }, { label: 'Hủy' }]
});

function resumeAfterVoice() {
  clearTimeout(voiceT);
  if (!voiceWasPlaying) return;
  voiceWasPlaying = false;
  [0, 400, 1200, 2500].forEach(d => setTimeout(() => bridge.call('resume'), d));
}
// Electron không có dịch vụ nhận giọng nói của Google (SpeechRecognition luôn báo lỗi mạng),
// nên nút micro mở "Nhập bằng giọng nói" có sẵn của Windows (Win+H) vào ô tìm kiếm.
$('mic').onclick = async () => {
  voiceWasPlaying = !!(snap && snap.state === 'PLAYING');
  if (voiceWasPlaying) bridge.call('pause');
  $('q').focus(); $('q').select();
  let ok = false;
  try { await new Promise(r => setTimeout(r, 200)); ok = await bridge.call('voiceTyping'); } catch (e) { ok = false; }
  if (ok) {
    toast('Nói tên bài hát/ca sĩ, xong bấm Enter để tìm');
    clearTimeout(voiceT); voiceT = setTimeout(resumeAfterVoice, 45000);
  } else {
    toast('Không mở được nhập giọng nói của Windows (cần Windows 10/11 và bật Nhận dạng giọng nói trực tuyến) — hãy gõ hoặc dùng điện thoại');
    resumeAfterVoice();
  }
};

// ------------------------------------------------------------------ nút điều khiển
$('b-back').onclick = () => bridge.call('seekTo', [null, -10000]);
$('b-fwd').onclick = () => bridge.call('seekTo', [null, 10000]);
$('b-next').onclick = () => bridge.call('skip');
$('b-play').onclick = () => bridge.call(snap && snap.state === 'PAUSED' ? 'resume' : 'pause');
$('b-mc').onclick = () => bridge.call('setDuck', [!(snap && snap.duck), false]);
async function doFadeOut() {
  const r = await bridge.call('fadeOut');
  toast(r === 'start' ? 'Đang tắt dần nhạc (' + (cfg.fadeOutSec || 4) + ' giây) — bấm lại để huỷ' : r === 'cancel' ? 'Đã huỷ tắt dần' : 'Chưa có nhạc đang phát');
}
$('b-fade').onclick = doFadeOut;
$('b-replay').onclick = async () => { if (!snap || !snap.nowPlaying) { toast('Chưa có bài đang phát'); return; } await bridge.call('seekTo', [0, 0]); if (snap.state === 'PAUSED') bridge.call('resume'); };
$('b-repeat').onclick = () => bridge.call('setRepeat', [!(snap && snap.repeat)]);
// thanh gạt âm lượng (chỉ đồng bộ từ máy khi không đang kéo)
let volDrag = false;
$('volRange').addEventListener('pointerdown', () => { volDrag = true; });
window.addEventListener('pointerup', () => { volDrag = false; });
$('volRange').addEventListener('input', () => bridge.call('setVolume', [Number($('volRange').value)]));
$('b-voldn').onclick = () => bridge.call('changeVolume', [-5]);
$('b-volup').onclick = () => bridge.call('changeVolume', [5]);
$('bar').onclick = e => {
  if (!snap || !(snap.durationMs > 0)) return;
  const r = $('bar').getBoundingClientRect();
  bridge.call('seekTo', [Math.round((e.clientX - r.left) / r.width * snap.durationMs), 0]);
};
$('fsBtn').onclick = () => { lastControlAt = Date.now(); enterFullscreen(); };

let volT = null;
function showVolume(v) {
  $('voltext').textContent = 'Âm lượng: ' + v + '%'; $('volfill').style.width = v + '%'; $('volbox').hidden = false;
  clearTimeout(volT); volT = setTimeout(() => { $('volbox').hidden = true; }, 1800);
}

// ------------------------------------------------------------------ cài đặt
async function showSettings() {
  const s = await bridge.call('getSettings');
  const again = fn => async () => { await fn(); showSettings(); };
  const nextOf = (arr, v) => arr[(arr.indexOf(v) + 1) % arr.length];
  modal({
    title: 'Cài đặt Youtube Player',
    list: [
      { label: 'Trình phát: ' + s.backend, run: again(() => bridge.call('setSetting', ['backend', nextOf(['AUTO', 'STREAM', 'IFRAME'], s.backend)])) },
      { label: 'Độ phân giải tối đa: ' + s.maxHeight + 'p', run: again(() => bridge.call('setMaxHeight', [nextOf([360, 480, 720, 1080], s.maxHeight)])) },
      { label: 'Tự phát bài gợi ý khi hàng đợi trống: ' + (s.seedAutoplay ? 'BẬT' : 'TẮT'), run: again(() => bridge.call('setSetting', ['seedAutoplay', !s.seedAutoplay])) },
      { label: 'Nhạc hạ còn khi MC nói: ' + s.duckLevel + '%', run: again(() => bridge.call('setSetting', ['duckLevel', nextOf([10, 20, 30, 40, 50], s.duckLevel)])) },
      { label: 'Tự hạ nhạc khi hiệu ứng riêng phát: ' + (s.sfxDuck ? 'BẬT' : 'TẮT'), run: again(() => bridge.call('setSetting', ['sfxDuck', !s.sfxDuck])) },
      { label: 'Nhạc vào dần đầu mỗi bài: ' + (s.fadeInSec === 0 ? 'TẮT' : s.fadeInSec + ' giây'), run: again(() => bridge.call('setSetting', ['fadeInSec', nextOf([0, 1, 2, 3, 5], s.fadeInSec)])) },
      { label: 'Thời gian fade out khi bấm nút: ' + s.fadeOutSec + ' giây', run: again(() => bridge.call('setSetting', ['fadeOutSec', nextOf([2, 3, 5, 8, 10], s.fadeOutSec)])) },
      { label: 'Số bài mỗi hàng kết quả: ' + s.gridCols, run: again(() => bridge.call('setSetting', ['gridCols', s.gridCols === 3 ? 2 : s.gridCols === 2 ? 1 : 3])) },
      { label: 'Tự phóng lớn video sau: ' + (s.fullscreenSec === 0 ? 'TẮT' : s.fullscreenSec + ' giây'), run: again(() => { lastControlAt = Date.now(); return bridge.call('setSetting', ['fullscreenSec', nextOf([3, 5, 10, 15, 30, 60, 0], s.fullscreenSec)]); }) },
      { label: 'Xuất ra màn hình ngoài (HDMI): ' + (s.tvOutput === 'OFF' ? 'TẮT' : 'TỰ ĐỘNG') + (tvActive ? ' · đang xuất' : ''), run: again(() => bridge.call('setSetting', ['tvOutput', s.tvOutput === 'OFF' ? 'AUTO' : 'OFF'])) },
      { label: 'Báo cáo lỗi / nhật ký phát video', run: showReport },
      { label: 'Khôi phục 5 thể loại mặc định', run: async () => { await bridge.call('catsReset'); selCat = -1; toast('Đã khôi phục các thể loại mặc định'); } },
      { label: 'Đặt lại ghép nối (ngắt mọi điện thoại)', run: () => modal({
        title: 'Đặt lại ghép nối?', lines: ['Tất cả điện thoại đã kết nối sẽ bị ngắt. Quét lại mã QR để kết nối.'],
        buttons: [{ label: 'Đặt lại', primary: true, run: () => bridge.call('resetPairing') }, { label: 'Hủy' }] }) },
      { label: 'Xong' }
    ]
  });
}
async function showReport() {
  let r;
  try { r = await bridge.call('getReport'); } catch (e) { r = { text: 'Không đọc được nhật ký: ' + e.message, path: '' }; }
  modal({
    title: 'Báo cáo lỗi', pre: r.text, lines: [{ text: 'File nhật ký: ' + (r.path || '?'), style: 'font-size:1rem' }],
    buttons: [
      { label: 'Sao chép', primary: true, run: () => { navigator.clipboard.writeText(r.text + '\n\nFile: ' + r.path).then(() => toast('Đã sao chép báo cáo'), () => toast('Không sao chép được')); } },
      { label: 'Mở thư mục', run: () => bridge.call('openLogFolder') },
      { label: 'Kiểm tra IP mạng', run: async () => { toast('Đang kiểm tra (khoảng 10 giây)…'); let t; try { t = await bridge.call('netTest'); } catch (e) { t = 'Lỗi: ' + e.message; } modal({ title: 'Kiểm tra IP mạng', pre: t, buttons: [{ label: 'Sao chép', primary: true, run: () => navigator.clipboard.writeText(t).then(() => toast('Đã sao chép')) }, { label: 'Đóng' }] }); } },
      { label: 'Xóa nhật ký', run: async () => { await bridge.call('clearLog'); toast('Đã xóa nhật ký'); } },
      { label: 'Đóng' }
    ], focus: 0
  });
}
window.addEventListener('error', e => { try { bridge.call('logRenderer', ['JS ' + e.message + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno]); } catch (x) { /* ignore */ } });
window.addEventListener('unhandledrejection', e => { try { bridge.call('logRenderer', ['JS promise: ' + (e.reason && e.reason.message || e.reason)]); } catch (x) { /* ignore */ } });
$('gear').onclick = showSettings;

// ------------------------------------------------------------------ chế độ sáng / tối
let theme = 'dark';
function applyTheme(t) {
  t = t === 'light' ? 'light' : 'dark';
  if (t === theme && $('themeIc').innerHTML) return;
  theme = t;
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
  // biểu tượng và nhãn cho biết bấm vào sẽ chuyển sang chế độ nào
  $('themeIc').innerHTML = window.ICONS[t === 'light' ? 'moon' : 'sun'] || '';
  $('themeLbl').textContent = t === 'light' ? 'Chế độ tối' : 'Chế độ sáng';
  $('themeBtn').setAttribute('aria-label', $('themeLbl').textContent);
}
$('themeBtn').onclick = () => {
  lastControlAt = Date.now();
  const next = theme === 'light' ? 'dark' : 'light';
  applyTheme(next); cfg.theme = next;
  bridge.call('setSetting', ['theme', next]).catch(() => {});
};
applyTheme('dark');
bridge.call('getSettings').then(s => applyTheme(s && s.theme)).catch(() => {});

// ------------------------------------------------------------------ phóng to / thu nhỏ video
function enterFullscreen() {
  if (fullscreen || !snap) return;
  if (snap.state !== 'PLAYING' && snap.state !== 'PAUSED') return;
  fullscreen = true; fsAt = Date.now(); savedFocus = document.activeElement;
  $('count').hidden = true; $('vbox').classList.add('full'); document.body.style.cursor = 'none';
  bridge.call('setWindowFullscreen', [true]).then(r => { winFsByUs = !!r; }).catch(() => {});
}
function exitFullscreen() {
  if (!fullscreen) return;
  fullscreen = false; lastControlAt = Date.now();
  $('vbox').classList.remove('full'); document.body.style.cursor = '';
  if (winFsByUs) { winFsByUs = false; bridge.call('setWindowFullscreen', [false]).catch(() => {}); }
  const t = savedFocus && savedFocus.isConnected ? savedFocus : $('grid').firstElementChild || $('fsBtn');
  setTimeout(() => t && t.focus && t.focus(), 0);
}
/** Tự phóng to sau N giây không thao tác; 5 giây cuối đếm ngược 5→0 giữa video nhỏ. */
setInterval(() => {
  const sec = cfg.fullscreenSec;
  const eligible = sec > 0 && !tvActive && !fullscreen && snap && snap.state === 'PLAYING' && dialogs === 0 && document.activeElement !== $('q') && !document.hidden;
  const c = $('count');
  if (!eligible) { c.hidden = true; return; }
  const remain = sec * 1000 - (Date.now() - lastControlAt);
  if (remain < -300) { c.hidden = true; enterFullscreen(); }
  else if (remain <= 5000) { const n = Math.max(0, Math.floor((remain + 999) / 1000)); if (c.textContent !== String(n)) c.textContent = n; c.hidden = false; }
  else c.hidden = true;
}, 200);

// ------------------------------------------------------------------ bàn phím / chuột
let lastMouse = { x: 0, y: 0 }, enterT0 = null;
function activity() { lastControlAt = Date.now(); if (!$('count').hidden) $('count').hidden = true; }
document.addEventListener('mousemove', e => {
  const moved = Math.abs(e.clientX - lastMouse.x) + Math.abs(e.clientY - lastMouse.y) > 8;
  lastMouse = { x: e.clientX, y: e.clientY };
  if (!moved) return;
  activity();
  if (fullscreen && Date.now() - fsAt > 800) exitFullscreen();
});
document.addEventListener('mousedown', () => { activity(); if (fullscreen && Date.now() - fsAt > 300) exitFullscreen(); });
document.addEventListener('wheel', activity, { passive: true });

const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
function navigate(dir) {
  const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const els = [...document.querySelectorAll('.nav, .cardv, .q, .cat, #q')].filter(visible);
  if (!els.length) return;
  if (!cur || !els.includes(cur)) { (document.querySelector('.cardv') || els[0]).focus(); return; }
  const cr = cur.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
  let best = null, bs = 1e12;
  for (const el of els) {
    if (el === cur || cur.contains(el) || el.contains(cur)) continue;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const dx = x - cx, dy = y - cy;
    let ok = false, score = 0;
    if (dir === 'right') { ok = dx > 4; score = dx + 3 * Math.abs(dy); }
    else if (dir === 'left') { ok = dx < -4; score = -dx + 3 * Math.abs(dy); }
    else if (dir === 'down') { ok = dy > 4; score = dy + 3 * Math.abs(dx); }
    else { ok = dy < -4; score = -dy + 3 * Math.abs(dx); }
    if (ok && score < bs) { bs = score; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
}

document.addEventListener('keydown', e => {
  shiftHeld = e.shiftKey;
  if (dialogs > 0) return;
  activity();
  const inInput = e.target === $('q');
  if (e.key === 'MediaPlayPause') { bridge.call(snap && snap.state === 'PAUSED' ? 'resume' : 'pause'); if (fullscreen) exitFullscreen(); return; }
  if (e.key === 'MediaTrackNext') { bridge.call('skip'); return; }
  if (!inInput && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); mcKeyDown(e); return; }
  if (!inInput && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); if (!e.repeat) doFadeOut(); return; }
  if (!inInput && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); if (!e.repeat) toggleBannerKey(); return; }
  if (!inInput && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.length === 1 && e.key >= '1' && e.key <= '9') { e.preventDefault(); if (!e.repeat) sfxKey(Number(e.key)); return; } // chạy cả khi đang phóng lớn, không thoát phóng lớn
  if (fullscreen) { e.preventDefault(); if (Date.now() - fsAt > 150) exitFullscreen(); return; }
  if (inInput) {
    if (e.key === 'Escape') { $('q').blur(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); navigate('down'); }
    return;
  }
  if ((e.key === 'f' || e.key === 'F' || e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (snap && (snap.state === 'PLAYING' || snap.state === 'PAUSED')) enterFullscreen(); else toast('Chưa có video đang phát');
    return;
  }
  if (e.key === '/' || (e.ctrlKey && (e.key === 'f' || e.key === 'k'))) { e.preventDefault(); $('q').focus(); $('q').select(); return; }
  if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); bridge.call(snap && snap.state === 'PAUSED' ? 'resume' : 'pause'); return; }
  if (e.key === '+' || e.key === '=') { bridge.call('changeVolume', [5]); return; }
  if (e.key === '-') { bridge.call('changeVolume', [-5]); return; }
  if (e.key === 'ArrowRight' && e.ctrlKey) { bridge.call('seekTo', [null, 10000]); return; }
  if (e.key === 'ArrowLeft' && e.ctrlKey) { bridge.call('seekTo', [null, -10000]); return; }
  if (e.key.startsWith('Arrow') && !e.ctrlKey) { e.preventDefault(); navigate(e.key.slice(5).toLowerCase()); return; }
  if (e.key === 'Delete' && e.target._remove) { e.preventDefault(); e.target._remove(); return; }
  if (e.key === 'Enter' && e.target._long) {
    // Enter: chọn; giữ Enter ≥ 0,6 giây: hành động "giữ OK" (thêm/xoá Yêu thích, xoá bài/thể loại)
    e.preventDefault();
    if (!e.repeat) enterT0 = { t: Date.now(), el: e.target, done: false };
    else if (enterT0 && !enterT0.done && Date.now() - enterT0.t > 600) { enterT0.done = true; e.target._long(); }
    return;
  }
  if (e.key === 'Enter' && e.target.click && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('keyup', e => {
  shiftHeld = e.shiftKey;
  if (e.key === 'Enter' && enterT0) {
    const o = enterT0; enterT0 = null;
    if (!o.done && dialogs === 0 && o.el.isConnected) o.el.click();
  }
});
window.addEventListener('blur', () => { shiftHeld = false; mcKeyRelease(true); });

// ------------------------------------------------------------------ phím M cho MC: giữ = nhạc nhỏ khi giữ, bấm nhanh (<0,35 giây) = bật/tắt
let mcKey = null;
function mcKeyDown(e) {
  if (e.repeat) { // gửi lại tín hiệu "còn giữ" định kỳ để hẹn giờ an toàn không tự nhả khi MC nói lâu
    if (mcKey && mcKey.momentary && Date.now() - mcKey.beat > 10000) { mcKey.beat = Date.now(); bridge.call('setDuck', [true, true]); }
    return;
  }
  const wasOn = !!(snap && snap.duck);
  mcKey = { t: Date.now(), momentary: !wasOn, beat: Date.now() };
  bridge.call('setDuck', [!wasOn, !wasOn]);
}
function mcKeyRelease(forced) {
  if (!mcKey) return;
  const k = mcKey; mcKey = null;
  if (!k.momentary) return;                                   // lần bấm này là để TẮT -> đã tắt từ lúc bấm
  if (forced || Date.now() - k.t > 350) bridge.call('setDuck', [false, false]); // giữ rồi thả (hoặc mất focus) -> trả nhạc
  else bridge.call('setDuck', [true, false]);                 // bấm nhanh -> giữ trạng thái bật cho tới lần bấm sau
}
document.addEventListener('keyup', e => { if (e.key === 'm' || e.key === 'M') mcKeyRelease(false); });

// ------------------------------------------------------------------ chữ chào mừng (gõ trên máy tính, hiện trên màn hình lớn)
// Hiện ở cả khung phát này (xem trước) lẫn cửa sổ TV; tự ẩn do tiến trình chính hẹn giờ (event 'banner' với null).
const banner = window.createBanner($('vbox'));
const bnr = { list: [], colors: ['#ffffff'], live: null, last: null, refresh: null };
const B_SIZES = ['Nhỏ', 'Vừa', 'Lớn', 'Rất lớn', 'Cực lớn'];
const B_POS = [['center', 'Giữa'], ['top', 'Trên'], ['bottom', 'Dưới']];
const B_HIDE = [[0, 'Giữ đến khi ẩn'], [10, '10 giây'], [30, '30 giây'], [60, '1 phút'], [120, '2 phút']];
const B_BLANK = () => ({ text: '', color: bnr.colors[0], size: 4, pos: 'center', hideSec: 0 });

function applyBanner(b) {
  bnr.live = b || null;
  if (b) { banner.show(b); bnr.last = { text: b.text, color: b.color, size: b.size, pos: b.pos, hideSec: b.hideSec }; } else banner.hide();
  $('bnrBtn').classList.toggle('on', !!b);
  $('bnrLbl').textContent = b ? 'Đang hiện · bấm để sửa/ẩn' : 'Chữ Chào Mừng';
  if (bnr.refresh) bnr.refresh();
}
bridge.on('banner', applyBanner);

async function showBanner(b) {
  const r = await bridge.call('bannerShow', [b]);
  if (!r) toast('Hãy gõ chữ trước khi hiện');
  return !!r;
}
const hideBanner = () => bridge.call('bannerHide');
/** Phím W: đang hiện thì ẩn; chưa hiện thì hiện lại chữ gần nhất (chưa có thì mở hộp soạn chữ). */
function toggleBannerKey() {
  if (bnr.live) { hideBanner(); toast('Đã ẩn chữ chào mừng'); }
  else if (bnr.last && bnr.last.text) { showBanner(bnr.last); toast('Đã hiện: ' + bnr.last.text.split('\n')[0]); }
  else openBannerDialog();
}
$('bnrBtn').onclick = () => openBannerDialog();

function openBannerDialog() {
  const root = $('modal');
  if (!root.hidden) return;
  const prevFocus = document.activeElement;
  let list = bnr.list.map(t => ({ ...t }));
  let sel = list.length ? 0 : -1;
  let d = sel >= 0 ? { ...list[0] } : B_BLANK();
  let armDel = false;

  const dlg = document.createElement('div');
  dlg.className = 'dlg bdlg'; dlg.setAttribute('role', 'dialog');
  dlg.innerHTML =
    '<h2>Chữ chào mừng trên màn hình lớn</h2>' +
    '<div class="bcols"><div class="bleft"><div class="blbl">MẪU ĐÃ LƯU</div><div class="blist"></div><button class="dbtn" data-r="new">+ Mẫu mới</button></div>' +
    '<div class="bright"><div class="bprev"><div class="bph">Xem trước</div></div>' +
    '<textarea rows="3" maxlength="130" placeholder="Gõ chữ chào mừng, ví dụ: Chúc mừng đám cưới Lan &amp; Minh (tối đa 3 dòng)"></textarea>' +
    '<div class="brow"><span class="blbl">MÀU</span><span data-r="colors" class="brow" style="margin:0"></span></div>' +
    '<div class="brow"><span class="blbl">CỠ CHỮ</span><span data-r="sizes" class="brow" style="margin:0"></span></div>' +
    '<div class="brow"><span class="blbl">VỊ TRÍ</span><span data-r="pos" class="brow" style="margin:0"></span></div>' +
    '<div class="brow"><span class="blbl">TỰ ẨN SAU</span><span data-r="hide" class="brow" style="margin:0"></span></div></div></div>' +
    '<div class="bstat"></div><div class="dbtns"></div>';
  const q = s => dlg.querySelector(s);
  const ta = q('textarea'), listEl = q('.blist'), stat = q('.bstat'), prev = q('.bprev');
  const pv = window.createBanner(prev);
  ta.value = d.text;

  const btn = (cls, label, on, extra) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = on; if (extra) extra(b); return b; };
  const clone = () => ({ text: ta.value, color: d.color, size: d.size, pos: d.pos, hideSec: d.hideSec });

  function drawPreview() {
    d.text = ta.value;
    q('.bph').hidden = !!d.text.trim();
    if (d.text.trim()) pv.show(d, true); else pv.hide();
  }
  function drawList() {
    listEl.textContent = '';
    if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Chưa có mẫu nào. Gõ chữ rồi bấm "Lưu mẫu".'; listEl.appendChild(e); }
    list.forEach((t, i) => {
      const b = document.createElement('button'); b.className = 'bitem' + (i === sel ? ' sel' : '');
      const dot = document.createElement('i'); dot.style.background = t.color;
      const sp = document.createElement('span'); sp.textContent = t.text.split('\n').join(' · ');
      b.append(dot, sp);
      b.onclick = () => { sel = i; d = { ...list[i] }; ta.value = d.text; armDel = false; drawAll(); };
      listEl.appendChild(b);
    });
  }
  function drawOpts() {
    const fill = (key, items, cur, set) => {
      const box = q('[data-r="' + key + '"]'); box.textContent = '';
      items.forEach(([v, label]) => box.appendChild(btn('opt' + (v === cur ? ' sel' : ''), label, () => { set(v); drawOpts(); drawPreview(); })));
    };
    const cb = q('[data-r="colors"]'); cb.textContent = '';
    bnr.colors.forEach(c => cb.appendChild(btn('sw' + (c === d.color ? ' sel' : ''), '', () => { d.color = c; drawOpts(); drawPreview(); }, b => { b.style.background = c; b.title = c; b.setAttribute('aria-label', 'Màu ' + c); })));
    const ci = document.createElement('input'); ci.type = 'color'; ci.className = 'bcol'; ci.value = d.color; ci.title = 'Chọn màu khác';
    ci.oninput = () => { d.color = ci.value; cb.querySelectorAll('.sw').forEach(s => s.classList.remove('sel')); drawPreview(); };
    cb.appendChild(ci);
    fill('sizes', B_SIZES.map((l, i) => [i + 1, l]), d.size, v => { d.size = v; });
    fill('pos', B_POS, d.pos, v => { d.pos = v; });
    fill('hide', B_HIDE, d.hideSec, v => { d.hideSec = v; });
  }
  function drawStat() {
    const live = bnr.live;
    stat.className = 'bstat' + (live ? ' live' : '');
    stat.textContent = live ? '● ĐANG HIỆN trên màn hình: “' + live.text.split('\n').join(' · ') + '”' : 'Chưa hiện chữ nào trên màn hình.';
    hideBtn.disabled = !live;
  }
  function drawBtns() { delBtn.disabled = sel < 0; delBtn.textContent = armDel ? 'BẤM LẠI ĐỂ XOÁ' : 'XOÁ MẪU'; }
  function drawAll() { drawList(); drawOpts(); drawPreview(); drawBtns(); drawStat(); }

  async function persist(next, msg) {
    try { list = await bridge.call('bannerSave', [next]); bnr.list = list.map(t => ({ ...t })); } catch (e) { stat.textContent = 'Không lưu được: ' + e.message; return; }
    drawList(); drawBtns(); stat.className = 'bstat'; stat.textContent = msg;
  }

  const showBtn = btn('dbtn primary', 'HIỆN LÊN MÀN HÌNH', async () => { d.text = ta.value; if (await showBanner(clone())) drawStat(); });
  const hideBtn = btn('dbtn', 'ẨN CHỮ', () => hideBanner());
  const saveBtn = btn('dbtn', 'LƯU MẪU', async () => {
    d.text = ta.value; if (!d.text.trim()) { stat.className = 'bstat'; stat.textContent = 'Hãy gõ chữ trước khi lưu.'; return; }
    const next = list.map(t => ({ ...t }));
    if (sel >= 0) next[sel] = clone(); else { if (next.length >= 30) { stat.textContent = 'Tối đa 30 mẫu, hãy xoá bớt.'; return; } next.push(clone()); sel = next.length - 1; }
    await persist(next, sel >= 0 ? 'Đã lưu mẫu.' : '');
    drawList();
  });
  const delBtn = btn('dbtn', 'XOÁ MẪU', async () => {
    if (sel < 0) return;
    if (!armDel) { armDel = true; drawBtns(); return; }
    armDel = false;
    const next = list.filter((_, i) => i !== sel);
    sel = next.length ? Math.min(sel, next.length - 1) : -1;
    await persist(next, 'Đã xoá mẫu.');
    d = sel >= 0 ? { ...list[sel] } : B_BLANK(); ta.value = d.text; drawAll(); stat.className = 'bstat'; stat.textContent = 'Đã xoá mẫu.';
  });
  const closeBtn = btn('dbtn', 'ĐÓNG', () => close());
  q('.dbtns').append(showBtn, hideBtn, saveBtn, delBtn, closeBtn);
  q('[data-r="new"]').onclick = () => { sel = -1; d = B_BLANK(); ta.value = ''; armDel = false; drawAll(); ta.focus(); };

  ta.addEventListener('input', () => {
    // tối đa 3 dòng
    const lines = ta.value.split('\n'); if (lines.length > 3) ta.value = lines.slice(0, 3).join('\n');
    drawPreview();
  });
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); showBtn.click(); }
  };
  function close() {
    bnr.refresh = null; document.removeEventListener('keydown', onKey, true);
    root.hidden = true; root.innerHTML = ''; dialogs = Math.max(0, dialogs - 1); lastControlAt = Date.now();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  }
  document.addEventListener('keydown', onKey, true);
  bnr.refresh = drawStat;
  root.innerHTML = ''; root.appendChild(dlg); root.hidden = false; dialogs++;
  drawAll();
  setTimeout(() => ta.focus(), 0);
}

// ------------------------------------------------------------------ nhạc / video có sẵn trong máy
const L_EXTS = 'mp3, m4a, wav, flac, ogg, opus, aac · mp4, mkv, webm, mov, m4v';
const lnorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/đ/g, 'd');
const fmtSize = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? Math.round(b / 1048576) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
/** Câu thông báo sau khi thêm file trong máy vào hàng đợi (r = kết quả từ tiến trình chính). */
function localResultText(r) {
  const n = (r.played || 0) + (r.added || 0);
  const parts = [];
  if (n) parts.push('Đã thêm ' + n + ' bài từ máy' + (r.played ? ' (đang phát bài đầu)' : ''));
  if (r.dup) parts.push(r.dup + ' bài đã có trong hàng đợi');
  if (r.full) parts.push('hàng đợi đầy');
  if (r.bad) parts.push(r.bad + ' file không dùng được');
  return parts.join(' · ') || 'Không có file nhạc/video nào';
}

function openLibraryDialog() {
  const root = $('modal');
  if (!root.hidden) return;
  const prevFocus = document.activeElement;
  let items = [], folders = [], filter = '', loading = true, msg = '';
  const dlg = document.createElement('div');
  dlg.className = 'dlg ldlg'; dlg.setAttribute('role', 'dialog');
  dlg.innerHTML =
    '<h2>Nhạc &amp; video trong máy</h2>' +
    '<div class="ltool"><button class="dbtn primary" data-r="playPick" title="Chọn một video hoặc bài nhạc bất kỳ trong máy và phát ngay, không cần thêm vào thư viện">▶ Chọn &amp; phát ngay…</button><button class="dbtn" data-r="addFiles">+ Thêm file…</button><button class="dbtn" data-r="addFolder">+ Thêm thư mục…</button>' +
    '<span class="lhint">Hoặc kéo thả file / thư mục vào cửa sổ. Phát được: ' + L_EXTS + '</span></div>' +
    '<div class="lbg"><span class="lbgt">Nền khi phát nhạc (mp3...):</span><span class="lbgname ell"></span>' +
    '<button class="lbtn" data-r="bgImg">🖼 Chọn hình…</button><button class="lbtn" data-r="bgVid">🎞 Chọn video…</button><button class="lbtn" data-r="bgOff">Bỏ nền</button></div>' +
    '<div class="lfold"></div>' +
    '<input class="lfilter" type="text" placeholder="Lọc theo tên bài hoặc tên thư mục" autocomplete="off" spellcheck="false">' +
    '<div class="llist"></div><div class="bstat"></div><div class="dbtns"></div>';
  const q = s => dlg.querySelector(s);
  const listEl = q('.llist'), foldEl = q('.lfold'), stat = q('.bstat'), fi = q('.lfilter');
  const bgName = q('.lbgname'), bgOffBtn = q('[data-r="bgOff"]');
  let bg = null;
  function drawBg() {
    bgName.textContent = bg ? (bg.type === 'video' ? '🎞 ' : '🖼 ') + bg.name : 'Chưa chọn (dùng nền tím có nốt nhạc)';
    bgName.title = bg ? bg.file : '';
    bgOffBtn.disabled = !bg;
  }
  const setBgState = (b, note) => { bg = b || null; drawBg(); if (note) setMsg(note); };

  const matches = () => { const f = lnorm(filter).trim(); return !f ? items : items.filter(it => lnorm(it.name + ' ' + it.dir).includes(f)); };
  const setMsg = t => { msg = t; drawStat(); };

  function drawFolders() {
    foldEl.textContent = '';
    if (!folders.length) { const e = document.createElement('span'); e.className = 'lhint'; e.textContent = 'Chưa có thư mục nào. Bấm "Thêm thư mục" để chọn nơi chứa nhạc của bạn.'; foldEl.appendChild(e); return; }
    folders.forEach(p => {
      const c = document.createElement('span'); c.className = 'lchip';
      const t = document.createElement('span'); t.className = 'ell'; t.textContent = '📁 ' + (p.split(/[\\/]/).filter(Boolean).pop() || p); t.title = p;
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Bỏ thư mục này khỏi thư viện (không xoá file)'; x.setAttribute('aria-label', 'Bỏ thư mục ' + p);
      x.onclick = async () => { await bridge.call('localRemove', [p]); await reload('Đã bỏ thư mục khỏi thư viện'); };
      c.append(t, x); foldEl.appendChild(c);
    });
  }
  function drawList() {
    listEl.textContent = '';
    if (loading) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Đang quét thư viện…'; listEl.appendChild(e); return; }
    const m = matches();
    if (!m.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = items.length ? 'Không có bài nào khớp bộ lọc.' : 'Thư viện trống. Thêm file hoặc thư mục nhạc, video để bắt đầu.'; listEl.appendChild(e); return; }
    m.slice(0, 300).forEach(it => {
      const r = document.createElement('div'); r.className = 'lrow';
      const ic = document.createElement('span'); ic.className = 'lic'; ic.textContent = it.kind === 'video' ? '🎬' : '♪';
      const tx = document.createElement('div'); tx.className = 'ltx';
      const nm = document.createElement('div'); nm.className = 'lnm ell'; nm.textContent = it.name; nm.title = it.path;
      const sb = document.createElement('div'); sb.className = 'lsb ell'; sb.textContent = it.dir + ' · ' + fmtSize(it.size);
      tx.append(nm, sb);
      const play = document.createElement('button'); play.className = 'lbtn red'; play.textContent = '▶ Phát ngay';
      play.onclick = async () => { await bridge.call('localPlayNow', [it.path]); setMsg('Đang phát: ' + it.name); };
      const add = document.createElement('button'); add.className = 'lbtn'; add.textContent = '+ Hàng đợi';
      add.onclick = async () => { const res = await bridge.call('localAdd', [[it.path], false]); setMsg(localResultText(res)); };
      r.append(ic, tx, play, add);
      if (it.kind === 'video') {
        const mb = document.createElement('button'); mb.className = 'lbtn'; mb.textContent = 'Làm nền'; mb.title = 'Dùng video này làm nền khi phát nhạc (tắt tiếng, lặp lại)';
        mb.onclick = async () => { const b = await bridge.call('bgUse', [it.path]); setBgState(b, b ? 'Đã đặt video nền: ' + b.name : ''); };
        r.appendChild(mb);
      }
      if (it.single) {
        const x = document.createElement('button'); x.className = 'lbtn'; x.textContent = '✕'; x.title = 'Bỏ file này khỏi thư viện (không xoá file)'; x.setAttribute('aria-label', 'Bỏ file ' + it.name);
        x.onclick = async () => { await bridge.call('localRemove', [it.path]); await reload('Đã bỏ file khỏi thư viện'); };
        r.appendChild(x);
      }
      listEl.appendChild(r);
    });
  }
  function drawStat() {
    const m = matches();
    stat.className = 'bstat';
    stat.textContent = msg || (loading ? '' : items.length + ' bài trong thư viện' + (filter.trim() ? ' · ' + m.length + ' khớp bộ lọc' : '') + (m.length > 300 ? ' · hiện 300 bài đầu, gõ để lọc thêm' : ''));
    addAll.disabled = loading || !m.length;
    addAll.textContent = filter.trim() ? 'THÊM ' + Math.min(m.length, 200) + ' BÀI ĐANG LỌC VÀO HÀNG ĐỢI' : 'THÊM TẤT CẢ VÀO HÀNG ĐỢI' + (m.length ? ' (' + Math.min(m.length, 200) + ')' : '');
  }
  async function reload(note) {
    loading = true; drawList(); drawStat();
    try { const r = await bridge.call('localList'); items = r.items; folders = r.folders; } catch (e) { items = []; setMsg('Không đọc được thư viện: ' + e.message); }
    loading = false; msg = note || ''; drawFolders(); drawList(); drawStat();
  }

  const btn = (label, cls, on) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = on; return b; };
  const addAll = btn('', 'dbtn primary', async () => {
    const res = await bridge.call('localAdd', [matches().slice(0, 200).map(i => i.path), false]); setMsg(localResultText(res));
  });
  q('.dbtns').append(addAll, btn('ĐÓNG', 'dbtn', () => close()));
  q('[data-r="addFiles"]').onclick = async () => { const n = await bridge.call('localPickFiles'); await reload(n ? 'Đã thêm ' + n + ' file vào thư viện' : ''); };
  q('[data-r="addFolder"]').onclick = async () => { const ok = await bridge.call('localPickFolder'); await reload(ok ? 'Đã thêm thư mục vào thư viện' : ''); };
  q('[data-r="playPick"]').onclick = async () => {
    const c = await bridge.call('localPlayPick');
    if (c === 0) { setMsg('Đang phát file vừa chọn'); close(); } else if (c === 3) setMsg('Hàng đợi đầy, không phát được'); else if (c > 0) setMsg('Không phát được file này');
  };
  q('[data-r="bgImg"]').onclick = async () => { const b = await bridge.call('bgPick', ['image']); setBgState(b, b ? 'Đã đặt hình nền: ' + b.name : ''); };
  q('[data-r="bgVid"]').onclick = async () => { const b = await bridge.call('bgPick', ['video']); setBgState(b, b ? 'Đã đặt video nền: ' + b.name : ''); };
  bgOffBtn.onclick = async () => { await bridge.call('bgClear'); setBgState(null, 'Đã bỏ nền, trở về nền mặc định'); };
  fi.addEventListener('input', () => { filter = fi.value; msg = ''; drawList(); drawStat(); });

  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    root.hidden = true; root.innerHTML = ''; dialogs = Math.max(0, dialogs - 1); lastControlAt = Date.now();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  }
  document.addEventListener('keydown', onKey, true);
  root.innerHTML = ''; root.appendChild(dlg); root.hidden = false; dialogs++;
  drawFolders(); drawList(); drawStat(); drawBg();
  setTimeout(() => fi.focus(), 0);
  reload();
  bridge.call('bgGet').then(b => { bg = b || null; drawBg(); }).catch(() => {});
}
$('libBtn').onclick = openLibraryDialog;

// ------------------------------------------------------------------ bảng hiệu ứng âm thanh riêng: cửa sổ quản lý
// Thêm file (nút hoặc kéo thả), đổi tên, biểu tượng, âm lượng riêng, nghe thử, xoá, sắp xếp (kéo ≡ hoặc nút ▲▼).
const SFX_MAX = 40; // phải khớp MAX_ITEMS trong main/sfx.js
const SFX_EMOJI = ['👏', '🎉', '🎊', '🥳', '🎂', '🍰', '🎈', '🎁', '🍾', '🥂', '💐', '💍', '👰', '🤵', '❤️', '💕', '😍', '😂', '🔥', '⭐', '🎵', '🎤', '🥁', '🎺', '📣', '🔔', '🚨', '👍', '🙌', '💃', '🕺', '🔊'];
let sfxDlg = null; // đang mở cửa sổ quản lý: { addPaths(paths), setList(list) }
let sfxItems = [];  // bản sao danh sách hiệu ứng (theo đúng thứ tự trong bảng) để phím 1–9 phát nhanh
bridge.on('sfx-list', l => { sfxItems = Array.isArray(l) ? l : []; if (sfxDlg) sfxDlg.setList(l); });

/** Phím 1–9: phát hiệu ứng thứ n trong bảng. Hiện tên ở giữa dưới màn hình cho MC biết đã bấm trúng. */
async function sfxKey(n) {
  const it = sfxItems[n - 1];
  if (!it) { toast('Chưa có hiệu ứng số ' + n + ' (thêm ở nút Hiệu Ứng Riêng)'); return; }
  const ok = await bridge.call('sfxPlay', [it.id]);
  if (ok) { toast(n + ' · ' + it.icon + ' ' + it.name); return; }
  try { sfxItems = await bridge.call('sfxList'); } catch (e) { /* giữ bản cũ */ }
  const now = sfxItems.find(x => x.id === it.id);
  if (!now) toast('Hiệu ứng số ' + n + ' đã bị xoá');
  else if (now.missing) toast('Không phát được "' + now.name + '": file đã bị xoá hoặc di chuyển');
  // còn lại: bấm dội trong 150ms, bỏ qua lặng lẽ
}

function openSfxDialog() {
  const root = $('modal');
  if (!root.hidden) return;
  const prevFocus = document.activeElement;
  let items = [], msg = '', pickIcon = null, delId = null, delT = null, dragId = null;
  const dlg = document.createElement('div');
  dlg.className = 'dlg sdlg'; dlg.setAttribute('role', 'dialog');
  dlg.innerHTML =
    '<h2>Hiệu ứng âm thanh của bạn</h2>' +
    '<div class="ltool"><button class="dbtn" data-r="add">+ Thêm file…</button><button class="dbtn" data-r="stop" title="Dừng mọi hiệu ứng đang phát (trên TV và trên máy tính)">■ Dừng hết</button>' +
    '<button class="dbtn" data-r="duck" title="Khi một hiệu ứng đang phát, nhạc nền tự nhỏ lại rồi trở lại. Mức hạ giống nút MC (chỉnh trong Cài đặt)"></button></div>' +
    '<div class="lhint shint">Phím <b>1–9</b> trên máy tính phát 9 hiệu ứng đầu · kéo thả file nhạc vào đây để thêm · kéo ≡ để sắp xếp · tối đa ' + SFX_MAX + ' nút · ▶ nghe thử chỉ phát trên máy tính</div>' +
    '<div class="slist"></div><div class="bstat"></div><div class="dbtns"></div>';
  const q = s => dlg.querySelector(s);
  const listEl = q('.slist'), stat = q('.bstat'), addBtn = q('[data-r="add"]');

  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sbtn = (k, label, title, on, cls) => { const b = mk('button', 'sbtn' + (cls ? ' ' + cls : ''), label); b.dataset.k = k; b.title = title; b.setAttribute('aria-label', title); b.onclick = on; return b; };
  const setMsg = t => { msg = t; drawStat(); };
  const apply = r => { if (!r) return; const i = items.findIndex(x => x.id === r.id); if (i >= 0) items[i] = { ...items[i], ...r }; drawStat(); };

  function drawStat() {
    const miss = items.filter(x => x.missing).length;
    stat.textContent = msg || (items.length + ' / ' + SFX_MAX + ' hiệu ứng' + (miss ? ' · ' + miss + ' file không còn trên máy (màu đỏ)' : ''));
    addBtn.disabled = items.length >= SFX_MAX;
  }

  async function preview(id) {
    let m = null;
    try { m = await bridge.call('sfxPreview', [id]); } catch (e) { /* bỏ qua */ }
    if (!m) { setMsg('Không phát được: file đã bị xoá hoặc di chuyển'); return; }
    previewSfx.stopAll(); previewSfx.play(m);
  }

  async function move(id, to) {
    const i = items.findIndex(x => x.id === id);
    if (i < 0 || to < 0 || to >= items.length || to === i) return;
    const [it] = items.splice(i, 1); items.splice(to, 0, it);   // đổi ngay trên màn hình, rồi mới báo tiến trình chính
    draw();
    await bridge.call('sfxMove', [id, to]);
  }

  function draw() {
    const ae = document.activeElement;
    const keep = ae && listEl.contains(ae) && ae.closest('.srow') ? [ae.closest('.srow').dataset.id, ae.dataset.k] : null;
    listEl.textContent = '';
    if (!items.length) { listEl.appendChild(mk('div', 'empty', 'Chưa có hiệu ứng nào.\nBấm "Thêm file" hoặc kéo thả file vỗ tay, reo hò, lời mời cô dâu chú rể... vào đây.')); return; }
    items.forEach((it, i) => {
      const row = mk('div', 'srow' + (it.missing ? ' miss' : '')); row.dataset.id = it.id;
      const num = mk('span', 'snum', i < 9 ? String(i + 1) : ''); if (i < 9) num.title = 'Bấm phím ' + (i + 1) + ' trên máy tính để phát';
      const grip = mk('span', 'sgrip', '≡'); grip.title = 'Kéo để đổi thứ tự';
      grip.onmousedown = () => { row.draggable = true; }; grip.onmouseup = () => { row.draggable = false; };
      row.addEventListener('dragstart', e => { dragId = it.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-sfx', it.id); row.classList.add('drag'); });
      row.addEventListener('dragend', () => { row.draggable = false; dragId = null; listEl.querySelectorAll('.above,.below,.drag').forEach(r => r.classList.remove('above', 'below', 'drag')); });
      row.addEventListener('dragover', e => {
        if (!dragId) return;
        e.preventDefault();
        const rc = row.getBoundingClientRect(), up = e.clientY < rc.top + rc.height / 2;
        listEl.querySelectorAll('.above,.below').forEach(r => r.classList.remove('above', 'below'));
        row.classList.add(up ? 'above' : 'below');
      });
      row.addEventListener('drop', e => {
        if (!dragId) return;
        e.preventDefault();
        const rc = row.getBoundingClientRect(), up = e.clientY < rc.top + rc.height / 2;
        const from = items.findIndex(x => x.id === dragId), pos = up ? i : i + 1;
        const id = dragId; dragId = null;
        move(id, pos > from ? pos - 1 : pos);
      });

      const ib = mk('button', 'sicon' + (pickIcon === it.id ? ' sel' : ''), it.icon); ib.dataset.k = 'icon'; ib.title = 'Đổi biểu tượng'; ib.setAttribute('aria-label', 'Đổi biểu tượng của ' + it.name);
      ib.onclick = () => { pickIcon = pickIcon === it.id ? null : it.id; draw(); };

      const nm = mk('input', 'sname'); nm.type = 'text'; nm.value = it.name; nm.maxLength = 24; nm.dataset.k = 'name'; nm.spellcheck = false; nm.autocomplete = 'off';
      nm.title = it.missing ? 'Không tìm thấy file: ' + it.file : it.file; nm.setAttribute('aria-label', 'Tên hiệu ứng');
      nm.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } };
      nm.onchange = async () => { const r = await bridge.call('sfxUpdate', [it.id, { name: nm.value }]); apply(r); if (r) nm.value = r.name; };

      const vol = mk('input', 'svol'); vol.type = 'range'; vol.min = 0; vol.max = 100; vol.step = 1; vol.value = it.vol; vol.dataset.k = 'vol'; vol.setAttribute('aria-label', 'Âm lượng của ' + it.name);
      const vl = mk('span', 'svl', it.vol + '%');
      vol.oninput = () => { vl.textContent = vol.value + '%'; };
      vol.onchange = async () => { const r = await bridge.call('sfxUpdate', [it.id, { vol: Number(vol.value) }]); apply(r); if (r && !it.missing) preview(it.id); };

      const pl = sbtn('play', '▶', 'Nghe thử (chỉ phát trên máy tính)', () => preview(it.id), 'red'); pl.disabled = !!it.missing;
      const up = sbtn('up', '▲', 'Đưa lên', () => move(it.id, i - 1)); up.disabled = i === 0;
      const dn = sbtn('down', '▼', 'Đưa xuống', () => move(it.id, i + 1)); dn.disabled = i === items.length - 1;
      const armed = delId === it.id;
      const del = sbtn('del', armed ? 'Xoá?' : '✕', armed ? 'Bấm lần nữa để xoá' : 'Xoá hiệu ứng này (không xoá file trên máy)', async () => {
        if (!armed) { delId = it.id; clearTimeout(delT); delT = setTimeout(() => { delId = null; draw(); }, 3000); draw(); return; }
        clearTimeout(delT); delId = null;
        const ok = await bridge.call('sfxRemove', [it.id]);
        if (ok) { items = items.filter(x => x.id !== it.id); if (pickIcon === it.id) pickIcon = null; draw(); setMsg('Đã xoá "' + it.name + '" (file trên máy vẫn còn)'); }
      }, armed ? 'warn' : '');

      row.append(num, grip, ib, nm, vol, vl, pl, up, dn, del);
      listEl.appendChild(row);

      if (pickIcon === it.id) {
        const pk = mk('div', 'spick');
        const choose = async ic => { pickIcon = null; const r = await bridge.call('sfxUpdate', [it.id, { icon: ic }]); apply(r); draw(); };
        SFX_EMOJI.forEach(ic => { const b = mk('button', '', ic); b.onclick = () => choose(ic); pk.appendChild(b); });
        const ci = mk('input'); ci.type = 'text'; ci.placeholder = 'Hoặc gõ emoji khác (Win + .) rồi Enter'; ci.setAttribute('aria-label', 'Emoji tuỳ chọn');
        ci.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (ci.value.trim()) choose(ci.value); } };
        pk.appendChild(ci);
        listEl.appendChild(pk);
      }
    });
    if (keep) { const t = listEl.querySelector('.srow[data-id="' + keep[0] + '"] [data-k="' + keep[1] + '"]'); if (t && !t.disabled) t.focus(); }
  }

  function reportAdd(r) {
    if (!r) return '';
    const parts = [];
    if (r.added && r.added.length) parts.push('Đã thêm ' + r.added.length + ' hiệu ứng');
    if (r.skipped) parts.push(r.skipped + ' file bị bỏ qua (không phải file âm thanh, đã có sẵn, hoặc không đọc được)');
    if (r.full) parts.push('bảng đã đủ ' + SFX_MAX + ' nút');
    return parts.join(' · ');
  }
  async function reload(note) {
    try { items = await bridge.call('sfxList'); } catch (e) { items = []; note = 'Không đọc được danh sách: ' + e.message; }
    msg = note || ''; draw(); drawStat();
  }
  async function addPaths(paths) { const r = await bridge.call('sfxAdd', [paths]); await reload(reportAdd(r)); }

  addBtn.onclick = async () => { const r = await bridge.call('sfxPickFiles'); await reload(reportAdd(r)); };
  q('[data-r="stop"]').onclick = () => { bridge.call('sfxStopAll'); };
  const duckBtn = q('[data-r="duck"]');
  let duckOn = false;
  const drawDuck = () => { duckBtn.textContent = 'Tự hạ nhạc khi hiệu ứng phát: ' + (duckOn ? 'BẬT' : 'TẮT'); duckBtn.classList.toggle('on', duckOn); };
  drawDuck();
  bridge.call('getSettings').then(s => { duckOn = !!s.sfxDuck; drawDuck(); }).catch(() => {});
  duckBtn.onclick = async () => { duckOn = !duckOn; drawDuck(); await bridge.call('setSetting', ['sfxDuck', duckOn]); };
  const close = () => {
    clearTimeout(delT); previewSfx.stopAll(); sfxDlg = null;
    document.removeEventListener('keydown', onKey, true);
    root.hidden = true; root.innerHTML = ''; dialogs = Math.max(0, dialogs - 1); lastControlAt = Date.now();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  };
  const onKey = e => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    const a = document.activeElement; if (a && dlg.contains(a) && a.blur) a.blur(); // chốt tên đang gõ dở trước khi đóng
    close();
  };
  q('.dbtns').appendChild(Object.assign(mk('button', 'dbtn', 'ĐÓNG'), { onclick: close }));
  sfxDlg = {
    addPaths,
    setList(l) {
      items = Array.isArray(l) ? l : [];
      const a = document.activeElement;
      if (a && listEl.contains(a) && a.tagName === 'INPUT') { drawStat(); return; } // đang gõ tên / kéo âm lượng: không vẽ lại kẻo mất con trỏ
      draw(); drawStat();
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.innerHTML = ''; root.appendChild(dlg); root.hidden = false; dialogs++;
  draw(); drawStat();
  setTimeout(() => addBtn.focus(), 0);
  reload();
}
$('sfxBtn').onclick = openSfxDialog;

// ------------------------------------------------------------------ kịch bản (bộ bài): cửa sổ quản lý
// Trái: các bộ bài (mỗi buổi tiệc một bộ). Phải: các lá bài của bộ đang chọn.
// Tạo bộ trống / từ mẫu, nhân bản, đổi tên, biểu tượng, xoá 2 bước, sắp xếp bằng nút hoặc kéo ≡ (cả bộ lẫn lá).
const DECK_MAX = 30, CARD_MAX = 60; // phải khớp MAX_DECKS, MAX_CARDS trong main/decks.js
const DECK_EMOJI = ['🎬', '💒', '🎂', '👶', '🎉', '🥂', '🎤', '🎄', '🎓', '💐', '🏆', '🎁', '👰', '🤵', '🍰', '🎵', '📣', '⭐'];
const CARD_KIND = { empty: 'Ô trống', sfx: 'Hiệu ứng', local: 'Nhạc trong máy', yt: 'YouTube', banner: 'Chữ chào mừng' };
let deckDlg = null; // đang mở cửa sổ Kịch Bản: { setList(list) }

function openDeckDialog() {
  const root = $('modal');
  if (!root.hidden) return;
  const prevFocus = document.activeElement;
  let decks = [], selId = null, msg = '', pick = null, picker = null, armed = null, armT = null, drag = null, showTpl = false, templates = [];
  let mode = 'edit', live = { deckId: null, played: [], last: null, next: null }, liveMsg = { text: '', kind: '' }, liveBusy = false, liveScrolledTo = null, gridTop = 0; // chế độ dùng khi diễn ra buổi tiệc
  const dlg = document.createElement('div');
  dlg.className = 'dlg kdlg'; dlg.setAttribute('role', 'dialog'); dlg.tabIndex = -1;
  dlg.innerHTML =
    '<div class="kmanage"><h2>Kịch bản các buổi tiệc</h2>' +
    '<div class="lhint shint">Mỗi <b>bộ bài</b> là một buổi tiệc, mỗi <b>lá bài</b> là một việc cần làm trong buổi đó (đón khách, cắt bánh...) · kéo ≡ để sắp xếp · bấm ✕ hai lần để xoá</div>' +
    '<div class="kbody"><div class="kleft"><div class="ltool"><button class="dbtn" data-r="new">+ Bộ mới</button><button class="dbtn" data-r="tpl">Từ mẫu…</button></div>' +
    '<div class="ltool"><button class="dbtn" data-r="fromq" title="Biến các bài đang xếp trong hàng đợi (kể cả bài đang phát) thành một bộ bài mới, giữ đúng thứ tự">Lưu hàng đợi thành bộ</button></div>' +
    '<div class="ktpl" hidden></div><div class="klist kdecks"></div></div>' +
    '<div class="kright"></div></div></div><div class="klive" hidden></div><div class="bstat"></div><div class="dbtns"></div>';
  const q = s => dlg.querySelector(s);
  const manageEl = q('.kmanage'), liveEl = q('.klive'), decksEl = q('.kdecks'), rightEl = q('.kright'), tplEl = q('.ktpl'), stat = q('.bstat'), newBtn = q('[data-r="new"]'), tplBtn = q('[data-r="tpl"]'), fromqBtn = q('[data-r="fromq"]');

  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sbtn = (k, label, title, on, cls) => { const b = mk('button', 'sbtn' + (cls ? ' ' + cls : ''), label); b.dataset.k = k; b.title = title; b.setAttribute('aria-label', title); b.onclick = on; return b; };
  const cur = () => decks.find(d => d.id === selId) || null;
  const setMsg = t => { msg = t; drawStat(); };
  const arm = key => { armed = key; clearTimeout(armT); armT = setTimeout(() => { armed = null; drawAll(); }, 3000); drawAll(); };
  const disarm = () => { clearTimeout(armT); armed = null; };

  function drawStat() {
    if (mode === 'live') { // chế độ dùng: dòng kết quả của lần bấm gần nhất
      stat.className = 'bstat' + (liveMsg.text ? ' lv-' + liveMsg.kind : '');
      stat.textContent = liveMsg.text || 'Space hoặc Enter: chạy lá kế tiếp · bấm vào một lá để chạy lá đó (bấm lại sẽ chạy lại) · phím 1–9, M, O vẫn dùng như ngoài màn hình chính';
      return;
    }
    stat.className = 'bstat';
    const d = cur(), miss = d ? d.cards.filter(c => c.missing).length : 0;
    stat.textContent = msg || (decks.length + ' / ' + DECK_MAX + ' bộ bài' + (d ? ' · bộ này ' + d.cards.length + ' / ' + CARD_MAX + ' lá' + (miss ? ' · ' + miss + ' lá bị mất file hoặc hiệu ứng (màu đỏ)' : '') : ''));
    newBtn.disabled = tplBtn.disabled = fromqBtn.disabled = decks.length >= DECK_MAX;
  }

  // ---- kéo thả sắp xếp: dùng chung cho bộ bài (kind 'deck') và lá bài (kind 'card')
  function sortable(row, kind, id, list, onDrop) {
    const grip = mk('span', 'sgrip', '≡'); grip.title = 'Kéo để đổi thứ tự';
    grip.onmousedown = () => { row.draggable = true; }; grip.onmouseup = () => { row.draggable = false; };
    row.addEventListener('dragstart', e => { drag = { kind, id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-deck', id); row.classList.add('drag'); });
    row.addEventListener('dragend', () => { row.draggable = false; drag = null; dlg.querySelectorAll('.above,.below,.drag').forEach(r => r.classList.remove('above', 'below', 'drag')); });
    row.addEventListener('dragover', e => {
      if (!drag || drag.kind !== kind) return;
      e.preventDefault();
      const rc = row.getBoundingClientRect(), up = e.clientY < rc.top + rc.height / 2;
      list.querySelectorAll('.above,.below').forEach(r => r.classList.remove('above', 'below'));
      row.classList.add(up ? 'above' : 'below');
    });
    row.addEventListener('drop', e => {
      if (!drag || drag.kind !== kind) return;
      e.preventDefault();
      const rc = row.getBoundingClientRect(), up = e.clientY < rc.top + rc.height / 2;
      const dragged = drag.id; drag = null;
      onDrop(dragged, up);
    });
    return grip;
  }

  function iconPicker(emojis, onChoose) {
    const pk = mk('div', 'spick');
    emojis.forEach(ic => { const b = mk('button', '', ic); b.onclick = () => onChoose(ic); pk.appendChild(b); });
    const df = mk('button', 'kdef', 'Mặc định'); df.onclick = () => onChoose(''); pk.appendChild(df);
    const ci = mk('input'); ci.type = 'text'; ci.placeholder = 'Hoặc gõ emoji khác (Win + .) rồi Enter'; ci.setAttribute('aria-label', 'Emoji tuỳ chọn');
    ci.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (ci.value.trim()) onChoose(ci.value); } };
    pk.appendChild(ci);
    return pk;
  }

  // ---- danh sách bộ bài (cột trái)
  async function moveDeck(id, to) {
    const i = decks.findIndex(x => x.id === id);
    if (i < 0 || to < 0 || to >= decks.length || to === i) return;
    const [it] = decks.splice(i, 1); decks.splice(to, 0, it);
    drawAll();
    await bridge.call('deckMove', [id, to]);
  }
  function drawDecks() {
    const ae = document.activeElement;
    const keep = ae && decksEl.contains(ae) && ae.closest('.krow') ? [ae.closest('.krow').dataset.id, ae.dataset.k] : null;
    decksEl.textContent = '';
    if (!decks.length) { decksEl.appendChild(mk('div', 'empty', 'Chưa có bộ bài nào.\nBấm \"Bộ mới\" hoặc \"Từ mẫu\" (Đám cưới, Sinh nhật, Thôi nôi).')); return; }
    decks.forEach((d, i) => {
      const row = mk('div', 'krow' + (d.id === selId ? ' sel' : '')); row.dataset.id = d.id;
      const grip = sortable(row, 'deck', d.id, decksEl, (id, up) => { const from = decks.findIndex(x => x.id === id), pos = up ? i : i + 1; moveDeck(id, pos > from ? pos - 1 : pos); });
      const pickBtn = mk('span', 'kic', d.icon);
      const body = mk('button', 'kname', d.name); body.dataset.k = 'open'; body.title = 'Mở bộ bài này';
      body.onclick = () => { selId = d.id; pick = null; picker = null; disarm(); msg = ''; drawAll(); };
      const act = d.id === live.deckId ? mk('span', 'kact', '▶') : null; if (act) act.title = 'Bộ đang dùng';
      const cnt = mk('span', 'kcnt' + (d.missingCount ? ' bad' : ''), String(d.cards.length)); cnt.title = d.cards.length + ' lá bài' + (d.missingCount ? ', ' + d.missingCount + ' lá bị mất' : '');
      const up = sbtn('up', '▲', 'Đưa bộ bài lên', () => moveDeck(d.id, i - 1)); up.disabled = i === 0;
      const dn = sbtn('down', '▼', 'Đưa bộ bài xuống', () => moveDeck(d.id, i + 1)); dn.disabled = i === decks.length - 1;
      row.append(grip, pickBtn, body); if (act) row.appendChild(act); row.append(cnt, up, dn);
      decksEl.appendChild(row);
    });
    if (keep) { const t = decksEl.querySelector('.krow[data-id="' + keep[0] + '"] [data-k="' + keep[1] + '"]'); if (t && !t.disabled) t.focus(); }
  }

  // ---- các lá bài của bộ đang chọn (cột phải)
  async function moveCard(deckId, id, to) {
    const d = decks.find(x => x.id === deckId); if (!d) return;
    const i = d.cards.findIndex(x => x.id === id);
    if (i < 0 || to < 0 || to >= d.cards.length || to === i) return;
    const [it] = d.cards.splice(i, 1); d.cards.splice(to, 0, it);
    drawAll();
    await bridge.call('cardMove', [deckId, id, to]);
  }
  function drawRight() {
    const ae = document.activeElement;
    const keep = ae && rightEl.contains(ae) && ae.closest('.kcrow') ? [ae.closest('.kcrow').dataset.id, ae.dataset.k] : null;
    rightEl.textContent = '';
    const d = cur();
    if (!d) { rightEl.appendChild(mk('div', 'empty', decks.length ? 'Chọn một bộ bài ở bên trái.' : '')); return; }
    if (picker) { drawPicker(d); return; }

    // đầu bộ bài: biểu tượng, tên, nhân bản, xoá
    const head = mk('div', 'khead');
    const ib = mk('button', 'sicon' + (pick && pick.k === 'deck' ? ' sel' : ''), d.icon); ib.dataset.k = 'dicon'; ib.title = 'Đổi biểu tượng bộ bài'; ib.setAttribute('aria-label', 'Đổi biểu tượng của bộ ' + d.name);
    ib.onclick = () => { pick = pick && pick.k === 'deck' ? null : { k: 'deck', id: d.id }; drawRight(); };
    const nm = mk('input', 'sname'); nm.type = 'text'; nm.value = d.name; nm.maxLength = 40; nm.dataset.k = 'dname'; nm.spellcheck = false; nm.autocomplete = 'off'; nm.setAttribute('aria-label', 'Tên bộ bài');
    nm.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } };
    nm.onchange = async () => { const r = await bridge.call('deckUpdate', [d.id, { name: nm.value }]); if (r) nm.value = r.name; };
    const dup = mk('button', 'dbtn', 'Nhân bản'); dup.dataset.k = 'ddup'; dup.title = 'Tạo bản sao của cả bộ bài này'; dup.disabled = decks.length >= DECK_MAX;
    dup.onclick = async () => { const r = await bridge.call('deckDuplicate', [d.id]); if (r && r.deck) { selId = r.deck.id; pick = null; await reload('Đã nhân bản thành \"' + r.deck.name + '\"'); } else setMsg('Không nhân bản được: đã đủ ' + DECK_MAX + ' bộ bài'); };
    const dArmed = armed === 'd:' + d.id;
    const del = mk('button', 'dbtn' + (dArmed ? ' primary' : ''), dArmed ? 'Xoá bộ?' : 'Xoá bộ'); del.dataset.k = 'ddel'; del.title = dArmed ? 'Bấm lần nữa để xoá cả bộ bài' : 'Xoá cả bộ bài này (không xoá file nhạc trên máy)';
    del.onclick = async () => {
      if (!dArmed) { arm('d:' + d.id); return; }
      disarm();
      const name = d.name, i0 = decks.findIndex(x => x.id === d.id); // tính vị trí trước: danh sách mới có thể được đẩy về trước khi lệnh trả kết quả
      const ok = await bridge.call('deckRemove', [d.id]);
      if (ok) { decks = decks.filter(x => x.id !== d.id); selId = decks.length ? decks[Math.max(0, Math.min(i0, decks.length - 1))].id : null; pick = null; drawAll(); setMsg('Đã xoá bộ \"' + name + '\"'); }
    };
    const isAct = d.id === live.deckId;
    const use = mk('button', 'dbtn primary', isAct ? '▶ Mở chế độ dùng' : '▶ Dùng bộ này'); use.dataset.k = 'duse'; use.disabled = !d.cards.length;
    use.title = d.cards.length ? 'Mở các lá bài thành lưới nút lớn để dùng khi buổi tiệc diễn ra (Space / Enter chạy lá kế tiếp)' : 'Bộ bài chưa có lá nào';
    use.onclick = () => enterLive(d.id);
    head.append(ib, nm, use, dup, del);
    rightEl.appendChild(head);
    if (pick && pick.k === 'deck') rightEl.appendChild(iconPicker(DECK_EMOJI.concat(SFX_EMOJI.filter(e => !DECK_EMOJI.includes(e))), async ic => { pick = null; await bridge.call('deckUpdate', [d.id, { icon: ic }]); }));

    // lá bài
    const tool = mk('div', 'ltool');
    const add = mk('button', 'dbtn', '+ Thêm ô trống'); add.dataset.k = 'cadd'; add.disabled = d.cards.length >= CARD_MAX; add.title = 'Thêm một lá bài có tên nhưng chưa gán nhạc';
    add.onclick = async () => {
      const r = await bridge.call('cardAdd', [d.id, { type: 'empty', label: 'Ô mới' }]);
      if (r && r.card) { pick = null; await reload(''); const inp = rightEl.querySelector('.kcrow[data-id="' + r.card.id + '"] input.sname'); if (inp) { inp.focus(); inp.select(); } }
      else setMsg(r && r.reason === 'FULL' ? 'Bộ bài đã đủ ' + CARD_MAX + ' lá' : 'Không thêm được lá bài');
    };
    const more = mk('button', 'dbtn primary', '+ Thêm lá bài…'); more.dataset.k = 'cpick'; more.disabled = d.cards.length >= CARD_MAX; more.title = 'Chọn hiệu ứng, nhạc trong máy, bài Yêu thích hoặc chữ chào mừng để thêm vào bộ bài';
    more.onclick = () => openPicker(null);
    const qall = mk('button', 'dbtn', 'Nạp cả bộ vào hàng đợi'); qall.dataset.k = 'cqueue';
    const hasMusic = d.cards.some(c => c.type === 'local' || c.type === 'yt');
    qall.disabled = !hasMusic;
    qall.title = hasMusic ? 'Đưa các lá nhạc trong máy và YouTube vào hàng đợi theo đúng thứ tự lá bài (hiệu ứng, chữ và ô trống được bỏ qua)' : 'Bộ bài chưa có lá nhạc nào';
    qall.onclick = async () => { const r = await bridge.call('deckQueueAll', [d.id]); setMsg(r && r.msg ? r.msg : 'Không nạp được'); };
    tool.append(more, add, qall);
    rightEl.appendChild(tool);

    const list = mk('div', 'klist kcards');
    rightEl.appendChild(list);
    if (!d.cards.length) list.appendChild(mk('div', 'empty', 'Bộ bài này chưa có lá bài nào.\nBấm \"Thêm ô trống\" để tạo từng việc cần làm, ví dụ Đón khách, Cắt bánh, Mời rượu.'));
    d.cards.forEach((c, i) => {
      const row = mk('div', 'kcrow' + (c.missing ? ' miss' : '')); row.dataset.id = c.id;
      const num = mk('span', 'snum', String(i + 1));
      const grip = sortable(row, 'card', c.id, list, (id, up) => { const from = d.cards.findIndex(x => x.id === id), pos = up ? i : i + 1; moveCard(d.id, id, pos > from ? pos - 1 : pos); });
      const cb = mk('button', 'sicon' + (pick && pick.k === 'card' && pick.id === c.id ? ' sel' : ''), c.icon); cb.dataset.k = 'icon'; cb.title = 'Đổi biểu tượng'; cb.setAttribute('aria-label', 'Đổi biểu tượng của ' + c.label);
      cb.onclick = () => { pick = pick && pick.k === 'card' && pick.id === c.id ? null : { k: 'card', id: c.id }; drawRight(); };
      const ln = mk('input', 'sname'); ln.type = 'text'; ln.value = c.label; ln.maxLength = 30; ln.dataset.k = 'name'; ln.spellcheck = false; ln.autocomplete = 'off'; ln.setAttribute('aria-label', 'Tên lá bài');
      ln.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ln.blur(); } };
      ln.onchange = async () => { const r = await bridge.call('cardUpdate', [d.id, c.id, { label: ln.value }]); if (r) ln.value = r.label; };
      const kind = mk('button', 'kkind' + (c.type === 'empty' ? ' none' : ''), c.type === 'empty' ? 'Gán nội dung…' : (c.missing ? 'Bị mất' : CARD_KIND[c.type] || c.type)); kind.dataset.k = 'assign';
      kind.title = (c.type === 'empty' ? 'Bấm để gán nhạc, hiệu ứng hoặc chữ cho ô này' : 'Bấm để đổi nội dung · ' + (c.missing ? 'mất file hoặc hiệu ứng của lá bài này' : c.type === 'local' ? c.file : c.type === 'yt' ? c.title : c.type === 'banner' ? c.banner.text.replace(/\n/g, ' / ') : ''));
      kind.setAttribute('aria-label', (c.type === 'empty' ? 'Gán nội dung cho ' : 'Đổi nội dung của ') + c.label);
      kind.onclick = () => openPicker(c.id);
      row.append(num, grip, cb, ln, kind);
      if (c.type === 'local' || c.type === 'yt') {
        const md = mk('button', 'kmode' + (c.mode === 'queue' ? ' q' : ''), c.mode === 'queue' ? 'Vào hàng đợi' : 'Phát ngay'); md.dataset.k = 'mode'; md.title = 'Bấm để đổi: phát ngay hay chỉ thêm vào hàng đợi';
        md.onclick = async () => { await bridge.call('cardUpdate', [d.id, c.id, { mode: c.mode === 'queue' ? 'now' : 'queue' }]); };
        row.appendChild(md);
      } else row.appendChild(mk('span', 'kmode none')); // giữ các cột thẳng hàng
      const pl = sbtn('play', '▶', 'Phát / chạy lá bài này ngay', async () => {
        try { const r = await bridge.call('deckRunCard', [d.id, c.id]); setMsg(r && r.msg ? r.msg : 'Đã chạy lá bài'); } catch (e) { setMsg('Không chạy được: ' + (e && e.message || 'lỗi không rõ')); }
      }, 'red'); pl.disabled = c.type === 'empty' || !!c.missing;
      const up = sbtn('up', '▲', 'Đưa lá bài lên', () => moveCard(d.id, c.id, i - 1)); up.disabled = i === 0;
      const dn = sbtn('down', '▼', 'Đưa lá bài xuống', () => moveCard(d.id, c.id, i + 1)); dn.disabled = i === d.cards.length - 1;
      const cArmed = armed === 'c:' + c.id;
      const rm = sbtn('del', cArmed ? 'Xoá?' : '✕', cArmed ? 'Bấm lần nữa để xoá lá bài' : 'Xoá lá bài này', async () => {
        if (!cArmed) { arm('c:' + c.id); return; }
        disarm();
        const ok = await bridge.call('cardRemove', [d.id, c.id]);
        if (ok) { d.cards = d.cards.filter(x => x.id !== c.id); if (pick && pick.id === c.id) pick = null; drawAll(); setMsg('Đã xoá lá \"' + c.label + '\"'); }
      }, cArmed ? 'warn' : '');
      row.append(pl, up, dn, rm);
      list.appendChild(row);
      if (pick && pick.k === 'card' && pick.id === c.id) list.appendChild(iconPicker(SFX_EMOJI, async ic => { pick = null; await bridge.call('cardUpdate', [d.id, c.id, { icon: ic }]); }));
    });
    if (keep) { const t = rightEl.querySelector('.kcrow[data-id="' + keep[0] + '"] [data-k="' + keep[1] + '"]'); if (t && !t.disabled) t.focus(); }
  }


  // ---- bảng chọn nguồn: thêm nhiều lá một lúc, hoặc gán nội dung cho một ô (target)
  const TABS = [['sfx', 'Hiệu ứng'], ['local', 'Nhạc trong máy'], ['fav', 'Yêu thích'], ['banner', 'Chữ chào mừng']];
  const PICK_CAP = 200; // số dòng vẽ tối đa (thư viện nhạc có thể có hàng nghìn bài, gõ để lọc)
  const firstLine = t => String(t || '').split('\n')[0];
  function openPicker(target) {
    picker = { target, tab: 'sfx', sel: new Map(), filter: '', data: {}, loading: {} };
    pick = null; drawAll(); loadTab('sfx');
  }
  async function loadTab(tab) {
    if (!picker || picker.data[tab] || picker.loading[tab]) return;
    const mine = picker;
    if (tab === 'fav') { mine.data.fav = favs.map(f => ({ key: 'y:' + f.videoId, name: f.title, sub: f.channel || 'YouTube', src: { type: 'yt', videoId: f.videoId, title: f.title, channel: f.channel, durationSec: f.durationSec, label: f.title, mode: 'now' } })); if (picker === mine) drawAll(); return; }
    mine.loading[tab] = true; drawAll();
    let items = [];
    try {
      if (tab === 'sfx') items = (await bridge.call('sfxList')).map(x => ({ key: 's:' + x.id, name: x.name, sub: x.missing ? 'Không tìm thấy file' : 'Hiệu ứng', icon: x.icon, missing: !!x.missing, src: { type: 'sfx', sfxId: x.id, label: x.name, icon: x.icon } }));
      else if (tab === 'local') items = (await bridge.call('localList')).items.map(x => ({ key: 'l:' + x.path, name: x.name, sub: (x.kind === 'video' ? 'Video' : 'Nhạc') + (x.dir ? ' · ' + x.dir : ''), src: { type: 'local', file: x.path, label: x.name, mode: 'now' } }));
      else items = (await bridge.call('bannerInit')).list.map((b, i) => ({ key: 'b:' + i + ':' + b.text, name: firstLine(b.text), sub: b.text.includes('\n') ? b.text.replace(/\n/g, ' / ') : 'Chữ chào mừng', src: { type: 'banner', banner: b, label: firstLine(b.text) } }));
    } catch (e) { items = []; if (picker === mine) msg = 'Không đọc được danh sách: ' + e.message; }
    mine.loading[tab] = false; mine.data[tab] = items;
    if (picker === mine) drawAll();
  }
  function drawPicker(d) {
    const P = picker, tgt = P.target ? d.cards.find(c => c.id === P.target) : null;
    if (P.target && !tgt) { picker = null; drawRight(); return; } // ô đã bị xoá
    const head = mk('div', 'khead');
    const back = mk('button', 'dbtn', '← Quay lại'); back.dataset.k = 'pback'; back.onclick = () => { picker = null; drawAll(); };
    head.append(back, mk('div', 'kptitle', tgt ? 'Gán nội dung cho ô \"' + tgt.label + '\"' : 'Thêm lá bài vào bộ \"' + d.name + '\"'));
    rightEl.appendChild(head);
    const tabs = mk('div', 'ktabs');
    TABS.forEach(([k, label]) => { const b = mk('button', 'ktab' + (P.tab === k ? ' on' : ''), label); b.dataset.k = 'tab-' + k; b.onclick = () => { P.tab = k; P.filter = ''; drawAll(); loadTab(k); }; tabs.appendChild(b); });
    rightEl.appendChild(tabs);
    const fi = mk('input', 'lfilter'); fi.type = 'text'; fi.dataset.k = 'pfilter'; fi.placeholder = 'Gõ để lọc theo tên…'; fi.value = P.filter; fi.spellcheck = false; fi.autocomplete = 'off'; fi.setAttribute('aria-label', 'Lọc danh sách');
    fi.oninput = () => { P.filter = fi.value; drawList(); };
    rightEl.appendChild(fi);
    const list = mk('div', 'klist kpickl'); rightEl.appendChild(list);
    const foot = mk('div', 'kpfoot'); rightEl.appendChild(foot);
    const go = mk('button', 'dbtn primary'); go.dataset.k = 'pgo'; foot.appendChild(go);
    const note = mk('span', 'kpnote'); foot.appendChild(note);

    function drawList() {
      list.textContent = '';
      const items = P.data[P.tab];
      if (P.loading[P.tab] || !items) { list.appendChild(mk('div', 'empty', 'Đang đọc danh sách…')); }
      else {
        const f = P.filter.trim().toLowerCase();
        const hit = f ? items.filter(x => (x.name + ' ' + x.sub).toLowerCase().includes(f)) : items;
        if (!hit.length) list.appendChild(mk('div', 'empty', items.length ? 'Không có mục nào khớp.' : ({ sfx: 'Chưa có hiệu ứng nào (thêm ở nút Hiệu Ứng Riêng).', local: 'Thư viện nhạc trong máy đang trống (thêm ở nút Nhạc Trong Máy).', fav: 'Chưa có bài Yêu thích nào.', banner: 'Chưa có mẫu chữ chào mừng nào (tạo ở nút Chữ Chào Mừng).' })[P.tab]));
        hit.slice(0, PICK_CAP).forEach(it => {
          const row = mk('div', 'kprow' + (P.sel.has(it.key) ? ' on' : '') + (it.missing ? ' miss' : '')); row.dataset.key = it.key;
          const ck = mk('input'); ck.type = 'checkbox'; ck.checked = P.sel.has(it.key); ck.disabled = !!it.missing; ck.dataset.k = 'chk'; ck.setAttribute('aria-label', 'Chọn ' + it.name);
          const toggle = () => {
            if (it.missing) return;
            if (P.sel.has(it.key)) P.sel.delete(it.key);
            else { if (P.target) P.sel.clear(); P.sel.set(it.key, it.src); }
            drawList();
          };
          ck.onclick = e => { e.stopPropagation(); toggle(); };
          row.onclick = toggle;
          const tx = mk('div', 'ltx'); tx.append(mk('div', 'lnm', (it.icon ? it.icon + ' ' : '') + it.name), mk('div', 'lsb', it.sub));
          row.append(ck, tx);
          list.appendChild(row);
        });
        if (hit.length > PICK_CAP) list.appendChild(mk('div', 'lhint', 'Đang hiện ' + PICK_CAP + ' / ' + hit.length + ' mục đầu — gõ vào ô lọc để tìm.'));
      }
      const n = P.sel.size, room = CARD_MAX - d.cards.length;
      go.textContent = tgt ? 'Gán' : (n ? 'Thêm ' + n + ' lá' : 'Thêm');
      go.disabled = !n || (!tgt && room <= 0);
      note.textContent = tgt ? (n ? '' : 'Chọn một mục để gán') : (n > room ? 'Bộ chỉ còn chỗ cho ' + room + ' lá, phần dư sẽ bị bỏ' : (n ? '' : 'Tích chọn một hoặc nhiều mục (có thể đổi thẻ để chọn thêm)'));
    }
    go.onclick = async () => {
      if (!P.sel.size) return;
      const srcs = [...P.sel.values()];
      if (tgt) {
        const r = await bridge.call('cardAssign', [d.id, tgt.id, srcs[0]]);
        picker = null;
        await reload(r ? 'Đã gán \"' + (r.label || tgt.label) + '\" ← ' + (CARD_KIND[r.type] || r.type).toLowerCase() : 'Không gán được: nội dung không hợp lệ');
        return;
      }
      const r = await bridge.call('deckAddCards', [d.id, srcs]);
      const parts = [];
      if (r.added.length) parts.push('Đã thêm ' + r.added.length + ' lá bài');
      if (r.full) parts.push('bộ đã đủ ' + CARD_MAX + ' lá, bỏ ' + r.full + ' mục');
      if (r.skipped) parts.push(r.skipped + ' mục không hợp lệ');
      picker = null;
      await reload(parts.join(' · ') || 'Không thêm được lá bài nào');
    };
    drawList();
  }

  function drawTpl() {
    tplEl.hidden = !showTpl; tplEl.textContent = '';
    if (!showTpl) return;
    templates.forEach(t => {
      const b = mk('button', 'ktplb', t.icon + ' ' + t.name + ' (' + t.count + ' ô)'); b.dataset.k = 'tpl-' + t.key;
      b.onclick = async () => {
        showTpl = false;
        const r = await bridge.call('deckFromTemplate', [t.key]);
        if (r && r.deck) { selId = r.deck.id; pick = null; await reload('Đã tạo bộ \"' + r.deck.name + '\" từ mẫu: bạn chỉ việc gán nhạc vào các ô'); } else { drawTpl(); setMsg('Không tạo được: đã đủ ' + DECK_MAX + ' bộ bài'); }
      };
      tplEl.appendChild(b);
    });
  }

  function drawAll() {
    if (mode === 'live' && !liveDeck()) { mode = 'edit'; if (!decks.some(d => d.id === selId)) selId = decks.length ? decks[0].id : null; } // bộ đang dùng không còn nữa
    manageEl.hidden = mode === 'live'; liveEl.hidden = mode !== 'live';
    if (mode === 'live') drawLive(); else { drawDecks(); drawRight(); drawTpl(); }
    drawStat();
  }
  async function reload(note) {
    try { decks = await bridge.call('decksList'); } catch (e) { decks = []; note = 'Không đọc được danh sách: ' + e.message; }
    await fetchLive();
    if (!decks.some(d => d.id === selId)) selId = decks.length ? decks[0].id : null;
    msg = note || ''; drawAll();
  }

  // ---- chế độ dùng khi diễn ra buổi tiệc: lá bài thành lưới nút lớn, Space / Enter chạy lá kế tiếp
  async function fetchLive() { try { const l = await bridge.call('deckLive'); if (l && typeof l === 'object') live = l; } catch (e) { /* giữ trạng thái cũ */ } }
  const liveDeck = () => (live.deckId ? decks.find(d => d.id === live.deckId) || null : null);
  const noMouseFocus = b => { b.addEventListener('mousedown', e => e.preventDefault()); return b; }; // bấm chuột không giữ focus, để Space / Enter luôn là "lá kế tiếp"
  const cardSub = c => (c.missing ? 'Bị mất' : c.type === 'empty' ? 'Chưa gán nội dung' : (CARD_KIND[c.type] || c.type) + (c.type === 'local' || c.type === 'yt' ? ' · ' + (c.mode === 'queue' ? 'vào hàng đợi' : 'phát ngay') : ''));
  function showRun(r, err) {
    if (!r) liveMsg = { text: 'Không chạy được: ' + ((err && err.message) || 'lỗi không rõ'), kind: 'bad' };
    else liveMsg = { text: (r.msg || '') + (r.ok && r.done ? ' · Đã chạy hết bộ bài' : ''), kind: r.ok ? 'ok' : r.marked ? 'info' : 'bad' };
    drawAll();
  }
  async function liveNext() {
    const d = liveDeck(); if (!d || liveBusy) return;
    liveBusy = true;
    try { showRun(await bridge.call('deckRunNext', [d.id])); } catch (e) { showRun(null, e); } finally { liveBusy = false; }
  }
  async function liveRun(c) {
    const d = liveDeck(); if (!d || liveBusy) return;
    liveBusy = true;
    try { showRun(await bridge.call('deckRunCard', [d.id, c.id])); } catch (e) { showRun(null, e); } finally { liveBusy = false; }
  }
  async function enterLive(id) {
    const ok = await bridge.call('deckSetActive', [id]);
    if (!ok) { setMsg('Bộ bài không còn'); return; }
    await fetchLive(); if (live.deckId !== id) live = { ...live, deckId: id };
    mode = 'live'; liveMsg = { text: '', kind: '' }; liveScrolledTo = null; gridTop = 0; pick = null; picker = null; disarm(); drawAll(); dlg.focus();
  }
  async function leaveLive(stop) {
    const d = liveDeck(); if (d) selId = d.id;
    disarm(); mode = 'edit'; msg = ''; pick = null; picker = null;
    if (stop) { try { await bridge.call('sfxStopAll'); if (snap && snap.state === 'PLAYING') await bridge.call('pause'); } catch (e) { /* bỏ qua */ } try { await bridge.call('deckSetActive', [null]); } catch (e) { /* bỏ qua */ } live = { deckId: null, played: [], last: null, next: null }; }
    drawAll();
  }
  function drawLive() {
    const d = liveDeck(); if (!d) return;
    const played = new Set(live.played), ae = document.activeElement;
    const keep = ae && liveEl.contains(ae) && ae.dataset.k ? ae.dataset.k : null;
    liveEl.textContent = '';
    const head = mk('div', 'lvhead');
    head.append(mk('span', 'lvic', d.icon), mk('div', 'lvtitle ell', d.name));
    if (decks.length > 1) {
      const sel = mk('select', 'lvsel'); sel.dataset.k = 'lvsel'; sel.setAttribute('aria-label', 'Chọn bộ bài đang dùng'); sel.title = 'Đổi sang bộ bài khác (dấu đã chạy của mỗi bộ được giữ riêng)';
      decks.forEach(x => { const o = mk('option', '', x.icon + ' ' + x.name); o.value = x.id; if (x.id === d.id) o.selected = true; sel.appendChild(o); });
      sel.onchange = async () => { const ok = await bridge.call('deckSetActive', [sel.value]); await fetchLive(); if (!ok) liveMsg = { text: 'Bộ bài không còn', kind: 'bad' }; else liveMsg = { text: '', kind: '' }; liveScrolledTo = null; gridTop = 0; drawAll(); dlg.focus(); };
      head.appendChild(sel);
    }
    const unusable = d.cards.filter(c => !played.has(c.id) && (c.type === 'empty' || c.missing)).length;
    head.appendChild(mk('div', 'lvprog', played.size + ' / ' + d.cards.length + ' lá đã chạy'));
    liveEl.appendChild(head);

    // nút lớn "Kế tiếp"
    const nx = d.cards.find(c => c.id === live.next) || null;
    const nb = noMouseFocus(mk('button', 'lvnext' + (nx ? '' : ' off'))); nb.dataset.k = 'next';
    if (nx) {
      nb.append(mk('span', 'lvnk', '▶ KẾ TIẾP'), mk('span', 'lvni', nx.icon), mk('span', 'lvnn ell', nx.label), mk('span', 'lvnh', 'Space / Enter'));
      nb.setAttribute('aria-label', 'Chạy lá kế tiếp: ' + nx.label); nb.onclick = liveNext;
    } else {
      nb.disabled = true;
      nb.appendChild(mk('span', 'lvnn ell', !d.cards.length ? 'Bộ bài chưa có lá nào: bấm Chỉnh sửa để thêm' : unusable ? 'Còn ' + unusable + ' lá chưa dùng được (ô trống hoặc mất file): bấm Chỉnh sửa để gán lại' : '✓ Đã chạy hết bộ bài · bấm Đặt lại để chạy lại từ đầu'));
    }
    liveEl.appendChild(nb);

    // lưới lá bài
    const grid = mk('div', 'lvgrid');
    grid.addEventListener('scroll', () => { gridTop = grid.scrollTop; });
    let nextTile = null;
    d.cards.forEach((c, i) => {
      const isDone = played.has(c.id), isNext = c.id === live.next;
      const b = noMouseFocus(mk('button', 'lvcard' + (isDone ? ' done' : '') + (isNext ? ' next' : '') + (c.id === live.last ? ' last' : '') + (c.missing ? ' miss' : '') + (c.type === 'empty' ? ' none' : '')));
      b.dataset.id = c.id;
      b.setAttribute('aria-label', 'Chạy ' + c.label + (isDone ? ' (đã chạy)' : '') + (isNext ? ' (kế tiếp)' : '') + ' · ' + cardSub(c));
      b.append(mk('span', 'lvcnum', String(i + 1)), mk('span', 'lvci', c.icon), mk('span', 'lvcn', c.label), mk('span', 'lvck', cardSub(c)));
      if (isNext) b.appendChild(mk('span', 'lvtag', 'KẾ TIẾP')); else if (isDone) b.appendChild(mk('span', 'lvtag', '✓ ĐÃ CHẠY'));
      b.onclick = () => { liveRun(c); };
      if (isNext) nextTile = b;
      grid.appendChild(b);
    });
    if (!d.cards.length) grid.appendChild(mk('div', 'empty', 'Bộ bài này chưa có lá bài nào.'));
    liveEl.appendChild(grid);
    grid.scrollTop = gridTop;
    if (nextTile && live.next !== liveScrolledTo) { liveScrolledTo = live.next; nextTile.scrollIntoView({ block: 'nearest' }); gridTop = grid.scrollTop; } // lá kế tiếp đổi thì cuộn tới

    // thanh dưới: chỉnh sửa / đặt lại / ngừng dùng
    const bar = mk('div', 'lvbar');
    const edit = noMouseFocus(mk('button', 'dbtn', '✎ Chỉnh sửa bộ bài')); edit.dataset.k = 'lvedit'; edit.title = 'Quay lại màn hình sắp xếp, thêm, gán nhạc cho các lá bài';
    edit.onclick = () => leaveLive(false);
    const rArmed = armed === 'reset';
    const reset = noMouseFocus(mk('button', 'dbtn' + (rArmed ? ' primary' : ''), rArmed ? 'Đặt lại?' : '↺ Đặt lại')); reset.dataset.k = 'lvreset'; reset.disabled = !live.played.length && !rArmed;
    reset.title = rArmed ? 'Bấm lần nữa để xoá hết dấu "đã chạy"' : 'Xoá dấu "đã chạy" để chạy lại từ lá đầu tiên (không dừng nhạc đang phát)';
    reset.onclick = async () => {
      if (!rArmed) { arm('reset'); return; }
      disarm(); await bridge.call('deckResetPlayed', [d.id]);
      await fetchLive();
      liveMsg = { text: 'Đã đặt lại: chạy lại từ lá đầu tiên', kind: 'info' }; liveScrolledTo = null; gridTop = 0; drawAll();
    };
    const stop = noMouseFocus(mk('button', 'dbtn', 'Ngừng dùng')); stop.dataset.k = 'lvstop'; stop.title = 'Thôi chế độ dùng và dừng nhạc/hiệu ứng đang phát (bấm Phát để nghe tiếp). Lần sau mở Kịch Bản sẽ vào danh sách bộ bài, dấu đã chạy vẫn được giữ';
    stop.onclick = () => leaveLive(true);
    bar.append(edit, reset, mk('div', 'grow'), stop);
    liveEl.appendChild(bar);

    if (keep) { const t = liveEl.querySelector('[data-k="' + keep + '"]'); if (t && !t.disabled) t.focus(); }
    if (!dlg.contains(document.activeElement) || document.activeElement === document.body) dlg.focus(); // mất focus thì về cửa sổ để Space / Enter vẫn chạy
  }

  newBtn.onclick = async () => {
    const r = await bridge.call('deckCreate', ['Bộ bài mới']);
    if (r && r.deck) {
      selId = r.deck.id; pick = null; showTpl = false; await reload('');
      const inp = rightEl.querySelector('input[data-k="dname"]'); if (inp) { inp.focus(); inp.select(); }
    } else setMsg('Đã đủ ' + DECK_MAX + ' bộ bài');
  };
  tplBtn.onclick = () => { showTpl = !showTpl; drawTpl(); };
  fromqBtn.onclick = async () => {
    const t = new Date();
    const r = await bridge.call('deckFromQueue', ['Hàng đợi ' + t.getDate() + '/' + (t.getMonth() + 1)]);
    if (r && r.deck) {
      selId = r.deck.id; pick = null; picker = null; showTpl = false;
      const parts = ['Đã lưu ' + r.added + ' bài thành bộ \"' + r.deck.name + '\"'];
      if (r.dup) parts.push(r.dup + ' bài trùng chỉ lấy một lần');
      if (r.skipped) parts.push(r.skipped + ' bài không lưu được');
      if (r.truncated) parts.push('quá ' + CARD_MAX + ' lá, bỏ ' + r.truncated + ' bài cuối');
      await reload(parts.join(' · '));
    } else setMsg(r && r.reason === 'FULL' ? 'Đã đủ ' + DECK_MAX + ' bộ bài' : 'Hàng đợi đang trống, chưa có gì để lưu');
  };

  const close = () => {
    clearTimeout(armT); deckDlg = null;
    document.removeEventListener('keydown', onKey, true);
    root.hidden = true; root.innerHTML = ''; dialogs = Math.max(0, dialogs - 1); lastControlAt = Date.now();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  };
  // Phím trong chế độ dùng: Space / Enter = lá kế tiếp; 1–9, M, O, W vẫn như ngoài màn hình chính (cửa sổ này che mất các phím đó)
  function liveKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    const k = e.key, eat = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ' || k === 'Enter') {
      if (tag === 'BUTTON' || e.shiftKey) return false; // nút đang được chọn bằng bàn phím (Tab) tự xử lý phím này
      eat(); if (!e.repeat) liveNext(); return true;
    }
    if (e.shiftKey) return false;
    if (k.length === 1 && k >= '1' && k <= '9') { eat(); if (!e.repeat) sfxKey(Number(k)); return true; }
    if (k === 'm' || k === 'M') { eat(); mcKeyDown(e); return true; }
    if (k === 'o' || k === 'O') { eat(); if (!e.repeat) doFadeOut(); return true; }
    if (k === 'w' || k === 'W') {
      eat();
      if (!e.repeat) { if (bnr.live || (bnr.last && bnr.last.text)) toggleBannerKey(); else toast('Chưa có chữ chào mừng nào để hiện/ẩn'); }
      return true;
    }
    return false;
  }
  const onKey = e => {
    if (mode === 'live' && liveKey(e)) return;
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    const a = document.activeElement; if (a && dlg.contains(a) && a.blur) a.blur(); // chốt tên đang gõ dở trước khi đóng
    if (picker) { picker = null; drawAll(); return; } // đang ở bảng chọn nguồn: Esc quay lại danh sách lá bài
    close();
  };
  q('.dbtns').appendChild(Object.assign(mk('button', 'dbtn', 'ĐÓNG'), { onclick: close }));
  deckDlg = {
    setLive(l) {
      live = l && typeof l === 'object' && Array.isArray(l.played) ? l : { deckId: null, played: [], last: null, next: null };
      const a = document.activeElement;
      if (mode === 'edit' && a && dlg.contains(a) && a.tagName === 'INPUT') { drawStat(); return; } // đang gõ tên: không vẽ lại kẻo mất con trỏ
      drawAll();
    },
    setList(l) {
      decks = Array.isArray(l) ? l : [];
      if (!decks.some(d => d.id === selId)) selId = decks.length ? decks[0].id : null;
      const a = document.activeElement;
      if (a && dlg.contains(a) && a.tagName === 'INPUT') { drawStat(); return; } // đang gõ tên: không vẽ lại kẻo mất con trỏ
      drawAll();
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.innerHTML = ''; root.appendChild(dlg); root.hidden = false; dialogs++;
  drawAll();
  setTimeout(() => { if (mode === 'edit') newBtn.focus(); }, 0);
  bridge.call('decksTemplates').then(t => { templates = Array.isArray(t) ? t : []; drawTpl(); }).catch(() => {});
  // "mở ra là dùng": đang có bộ được chọn dùng thì vào thẳng lưới nút lớn
  reload().then(() => { if (liveDeck()) { mode = 'live'; drawAll(); dlg.focus(); } });
}
bridge.on('decks-list', l => { if (deckDlg) deckDlg.setList(l); });
bridge.on('decks-live', l => { if (deckDlg) deckDlg.setLive(l); });
$('deckBtn').onclick = openDeckDialog;

// ------------------------------------------------------------------ tải sẵn bài YouTube về máy
// Hộp thoại: thư mục + kiểu tải, phạm vi (Yêu thích / hàng đợi / từng bộ bài, "đã tải x/y"), tiến độ từng bài, huỷ.
// Tiến độ do tiến trình chính đẩy qua 'dl-update' / 'dl-removed' / 'dl-library'.
let dlDlg = null; // đang mở hộp "Tải Sẵn Về Máy"
const fmtSpeed = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB/s' : Math.max(1, Math.round(b / 1024)) + ' KB/s';
const fmtEta = s => s == null || !isFinite(s) ? '' : s >= 60 ? Math.floor(s / 60) + ' phút ' + (Math.round(s) % 60) + ' giây' : Math.round(s) + ' giây';
function dlJobText(j) {
  if (j.status === 'queued') return 'Đang chờ';
  if (j.status === 'downloading') {
    const parts = [j.attempt > 0 ? 'Thử lại lần ' + (j.attempt + 1) : 'Đang tải'];
    if (j.total) parts.push(fmtSize(j.bytes) + ' / ' + fmtSize(j.total)); else if (j.bytes) parts.push(fmtSize(j.bytes));
    if (j.speed) parts.push(fmtSpeed(j.speed));
    const e = fmtEta(j.eta); if (e) parts.push('còn ' + e);
    return parts.join(' · ');
  }
  if (j.status === 'done') return 'Đã tải xong' + (j.lite ? ' (bản gộp sẵn, chất lượng thấp)' : j.mode === 'audio' ? ' (chỉ tiếng)' : '');
  if (j.status === 'canceled') return 'Đã huỷ';
  return 'Lỗi: ' + (j.error || 'không rõ');
}

function openDownloadDialog() {
  const root = $('modal');
  if (!root.hidden) return;
  const prevFocus = document.activeElement;
  let st = null, msg = '';
  const jobs = new Map(), rows = new Map();
  const dlg = document.createElement('div');
  dlg.className = 'dlg ddlg'; dlg.setAttribute('role', 'dialog');
  dlg.innerHTML =
    '<h2>Tải sẵn về máy</h2>' +
    '<div class="lhint">Bài đã tải sẽ phát từ file trong máy, không cần mạng. Bài nào mất file thì app tự phát trực tuyến.</div>' +
    '<div class="dldir"><span class="dlpath ell"></span><button class="dbtn" data-r="pick">Đổi thư mục…</button><button class="dbtn" data-r="reset">Mặc định</button><button class="dbtn" data-r="open">Mở thư mục</button><button class="dbtn" data-r="scan">Quét lại</button></div>' +
    '<div class="dlmode"><span class="lhint">Kiểu tải:</span><button class="dbtn" data-m="video">Hình + tiếng</button><button class="dbtn" data-m="audio">Chỉ tiếng (m4a)</button></div>' +
    '<div class="dlwarn" hidden></div>' +
    '<div class="dlsec">PHẠM VI TẢI</div><div class="dlscopes"></div>' +
    '<div class="dlsec"><span class="dlhave">BÀI ĐÃ TẢI SẴN</span><span class="grow"></span><button class="dbtn" data-r="addAll">+ Thêm tất cả vào hàng đợi</button></div>' +
    '<input class="lfilter dlfilter" type="text" placeholder="Lọc theo tên bài đã tải…" spellcheck="false" autocomplete="off"><div class="dlhaveList"></div>' +
    '<div class="dlsec"><span class="dlhead">TIẾN ĐỘ</span><span class="grow"></span><button class="dbtn" data-r="cancelAll">Huỷ tất cả</button><button class="dbtn" data-r="clearDone">Xoá dòng đã xong</button></div>' +
    '<div class="dljobs"></div><div class="bstat"></div><div class="dbtns"></div>';
  const q = s => dlg.querySelector(s);
  const pathEl = q('.dlpath'), warnEl = q('.dlwarn'), scopesEl = q('.dlscopes'), jobsEl = q('.dljobs'), stat = q('.bstat'), head = q('.dlhead');
  const btn = (label, cls, on) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = on; return b; };
  const setMsg = t => { msg = t; stat.textContent = msg; };

  function startText(r) {
    if (!r || r.error) return (r && r.error) || 'Không bắt đầu được';
    const parts = [];
    if (r.added) parts.push('đã thêm ' + r.added + ' bài vào hàng tải');
    if (r.have) parts.push(r.have + ' bài đã có sẵn');
    if (r.queued) parts.push(r.queued + ' bài đang trong hàng tải');
    if (r.bad) parts.push(r.bad + ' mã không hợp lệ');
    return parts.join(' · ') || 'Phạm vi này chưa có bài YouTube nào';
  }
  async function start(scope) { try { setMsg(startText(await bridge.call('dlStart', [scope]))); } catch (e) { setMsg('Lỗi: ' + e.message); } }

  function drawTop() {
    if (!st) return;
    pathEl.textContent = '📁 ' + st.dir; pathEl.title = st.dir;
    q('[data-r="reset"]').hidden = !st.custom;
    dlg.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode));
    const warn = st.mode === 'video' && st.ffmpeg === false;
    warnEl.hidden = !warn;
    if (warn) warnEl.textContent = 'Chưa có ffmpeg nên không ghép được hình và tiếng chất lượng cao: app chỉ tải bản gộp sẵn, thường chỉ 360p. Muốn hình đẹp hơn, đặt ffmpeg.exe vào thư mục bin cạnh yt-dlp.exe; hoặc chọn "Chỉ tiếng" nếu chỉ cần nhạc.';
  }
  function scopeRow(name, p, scope) {
    const r = document.createElement('div'); r.className = 'dlrow';
    const nm = document.createElement('div'); nm.className = 'dlnm ell'; nm.textContent = name; nm.title = name;
    const full = p.total > 0 && p.done >= p.total;
    const cnt = document.createElement('span'); cnt.className = 'dlcnt' + (full ? ' full' : ''); cnt.textContent = 'đã tải ' + p.done + '/' + p.total;
    const go = document.createElement('button'); go.className = 'lbtn red'; go.dataset.scope = scope.type + (scope.id || '');
    go.textContent = !p.total ? 'Trống' : full ? 'Đã đủ' : p.done ? 'Tải phần còn thiếu' : 'Tải về';
    go.disabled = !p.total || full; go.onclick = () => start(scope);
    r.append(nm, cnt, go); return r;
  }
  function drawScopes() {
    scopesEl.textContent = '';
    if (!st) return;
    const sc = st.scopes || {};
    scopesEl.appendChild(scopeRow('♥ Yêu thích', sc.favs || { done: 0, total: 0 }, { type: 'favs' }));
    scopesEl.appendChild(scopeRow('Hàng đợi hiện tại', sc.queue || { done: 0, total: 0 }, { type: 'queue' }));
    (sc.decks || []).forEach(d => scopesEl.appendChild(scopeRow('Bộ bài: ' + d.name, d, { type: 'deck', id: d.id })));
    if (!(sc.decks || []).length) { const e = document.createElement('div'); e.className = 'lhint'; e.style.padding = '6px 10px'; e.textContent = 'Chưa có bộ bài nào có bài YouTube (tạo ở mục Kịch Bản).'; scopesEl.appendChild(e); }
  }
  function drawHead() {
    const c = { queued: 0, downloading: 0, done: 0, error: 0, canceled: 0 };
    jobs.forEach(j => { c[j.status] = (c[j.status] || 0) + 1; });
    const active = c.queued + c.downloading, finished = c.done + c.error + c.canceled;
    head.textContent = 'TIẾN ĐỘ' + (jobs.size ? ' · ' + (active ? active + ' đang chờ/tải · ' : '') + c.done + ' xong' + (c.error ? ' · ' + c.error + ' lỗi' : '') : '');
    q('[data-r="cancelAll"]').disabled = !active;
    q('[data-r="clearDone"]').disabled = !finished;
    if (!jobs.size && !rows.size) { jobsEl.textContent = ''; const e = document.createElement('div'); e.className = 'empty'; e.dataset.empty = '1'; e.textContent = 'Chưa có bài nào đang tải. Bấm "Tải về" ở một phạm vi phía trên.'; jobsEl.appendChild(e); }
  }
  function drawJob(j) {
    jobs.set(j.id, j);
    const empty = jobsEl.querySelector('[data-empty]'); if (empty) empty.remove();
    let r = rows.get(j.id);
    if (!r) {
      r = document.createElement('div'); r.dataset.id = j.id;
      r.innerHTML = '<div class="djtx"><div class="djnm ell"></div><div class="djst ell"></div></div><div class="djbar"><i></i></div><span class="djpct"></span><button class="lbtn"></button>';
      r.querySelector('button').onclick = () => {
        const cur = jobs.get(j.id); if (!cur) return;
        bridge.call(cur.status === 'queued' || cur.status === 'downloading' ? 'dlCancel' : 'dlClear', [j.id]);
      };
      rows.set(j.id, r); jobsEl.appendChild(r);
    }
    r.className = 'djrow ' + j.status;
    const nm = r.querySelector('.djnm'); nm.textContent = j.title || j.id; nm.title = (j.title || '') + ' [' + j.id + ']';
    const sb = r.querySelector('.djst'); sb.textContent = dlJobText(j); sb.title = sb.textContent;
    r.querySelector('.djbar i').style.width = Math.max(0, Math.min(100, j.percent || 0)) + '%';
    r.querySelector('.djpct').textContent = j.status === 'queued' || j.status === 'canceled' ? '' : Math.round(j.percent || 0) + '%';
    const b = r.querySelector('button'), live = j.status === 'queued' || j.status === 'downloading';
    b.textContent = live ? 'Huỷ' : '✕'; b.title = live ? 'Huỷ bài này' : 'Xoá dòng này khỏi danh sách (không xoá file đã tải)';
    b.setAttribute('aria-label', (live ? 'Huỷ ' : 'Xoá dòng ') + (j.title || j.id));
    drawHead();
  }
  function removeJob(id) { jobs.delete(id); const r = rows.get(id); if (r) { r.remove(); rows.delete(id); } drawHead(); }
  // ---- danh sách bài đã tải sẵn: phát ngay / thêm vào hàng đợi
  let have = [];
  const haveEl = q('.dlhaveList'), haveHead = q('.dlhave'), filterEl = q('.dlfilter');
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const haveMatches = () => { const f = norm(filterEl.value).trim(); return f ? have.filter(h => norm(h.title).includes(f)) : have; };
  const addText = c => c === 0 ? 'Đang phát bài đầu tiên' : c === 1 ? 'Đã thêm vào hàng đợi' : c === 2 ? 'Bài này đã có trong hàng đợi' : 'Hàng đợi đầy';
  function drawHave() {
    const m = haveMatches();
    haveHead.textContent = 'BÀI ĐÃ TẢI SẴN · ' + have.length + ' bài' + (m.length !== have.length ? ' (khớp ' + m.length + ')' : '');
    q('[data-r="addAll"]').disabled = !m.length;
    haveEl.textContent = '';
    if (!m.length) { const e = document.createElement('div'); e.className = 'lhint'; e.style.padding = '6px 10px'; e.textContent = have.length ? 'Không có bài nào khớp bộ lọc.' : 'Chưa có bài nào tải sẵn trong thư mục này.'; haveEl.appendChild(e); return; }
    m.slice(0, 300).forEach(h => {
      const r = document.createElement('div'); r.className = 'lrow';
      const ic = document.createElement('span'); ic.className = 'lic'; ic.textContent = h.kind === 'video' ? '🎬' : '♪';
      const tx = document.createElement('div'); tx.className = 'ltx';
      const nm = document.createElement('div'); nm.className = 'lnm ell'; nm.textContent = h.title; nm.title = h.title + ' [' + h.videoId + ']';
      const sb = document.createElement('div'); sb.className = 'lsb ell'; sb.textContent = (h.kind === 'video' ? 'Hình + tiếng' : 'Chỉ tiếng') + ' · ' + fmtSize(h.size);
      tx.append(nm, sb);
      const play = document.createElement('button'); play.className = 'lbtn red'; play.textContent = '▶ Phát ngay';
      play.onclick = async () => { const c = await bridge.call('dlPlayNow', [h.videoId]); setMsg(c === 3 ? 'Hàng đợi đầy' : 'Đang phát: ' + h.title); };
      const add = document.createElement('button'); add.className = 'lbtn'; add.textContent = '+ Hàng đợi';
      add.onclick = async () => { setMsg(addText(await bridge.call('dlAddQueue', [h.videoId, false]))); };
      r.append(ic, tx, play, add); haveEl.appendChild(r);
    });
  }
  async function loadHave() { try { have = await bridge.call('dlList') || []; } catch (e) { have = []; } drawHave(); }
  filterEl.oninput = drawHave;
  q('[data-r="addAll"]').onclick = async () => {
    const m = haveMatches().slice(0, 200); let added = 0, dup = 0, full = 0, played = 0;
    for (const h of m) { const c = await bridge.call('dlAddQueue', [h.videoId, false]); if (c === 0) played++; else if (c === 1) added++; else if (c === 2) dup++; else full++; }
    const n = added + played;
    setMsg((n ? 'Đã thêm ' + n + ' bài vào hàng đợi' + (played ? ' (đang phát bài đầu)' : '') : 'Không thêm được bài nào') + (dup ? ' · ' + dup + ' bài đã có trong hàng đợi' : '') + (full ? ' · hàng đợi đầy' : ''));
  };
  function setLibrary(info) { if (!st) return; st = { ...st, dir: info.dir, defaultDir: info.defaultDir, custom: info.custom, count: info.count, scopes: info.scopes }; drawTop(); drawScopes(); loadHave(); }
  async function load() {
    try { st = await bridge.call('dlState'); } catch (e) { setMsg('Không đọc được trạng thái tải: ' + e.message); return; }
    (st.jobs || []).forEach(drawJob); drawTop(); drawScopes(); drawHead(); loadHave();
    if (!msg) stat.textContent = st.count + ' bài đã tải sẵn trong thư mục này';
  }

  q('[data-r="pick"]').onclick = async () => { const ok = await bridge.call('dlPickDir'); setMsg(ok ? 'Đã đổi thư mục tải' : ''); };
  q('[data-r="reset"]').onclick = async () => { await bridge.call('dlResetDir'); setMsg('Đã về thư mục mặc định'); };
  q('[data-r="open"]').onclick = async () => { const ok = await bridge.call('dlOpenFolder'); if (!ok) setMsg('Không mở được thư mục'); };
  q('[data-r="scan"]').onclick = async () => { const n = await bridge.call('dlRescan'); setMsg('Đã quét lại: ' + n + ' bài đã tải sẵn'); };
  q('[data-r="cancelAll"]').onclick = () => bridge.call('dlCancelAll');
  q('[data-r="clearDone"]').onclick = () => bridge.call('dlClearFinished');
  dlg.querySelectorAll('[data-m]').forEach(b => { b.onclick = async () => { await bridge.call('dlSetMode', [b.dataset.m]); if (st) { st.mode = b.dataset.m; drawTop(); } setMsg(b.dataset.m === 'audio' ? 'Từ bài tải kế tiếp: chỉ tải tiếng (m4a)' : 'Từ bài tải kế tiếp: tải hình + tiếng'); }; });
  q('.dbtns').append(btn('ĐÓNG', 'dbtn primary', () => close()));

  const offs = [bridge.on('dl-update', drawJob), bridge.on('dl-removed', removeJob), bridge.on('dl-library', setLibrary)];
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  function close() {
    offs.forEach(f => { try { f && f(); } catch (e) { /* ignore */ } });
    document.removeEventListener('keydown', onKey, true); dlDlg = null;
    root.hidden = true; root.innerHTML = ''; dialogs = Math.max(0, dialogs - 1); lastControlAt = Date.now();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  }
  document.addEventListener('keydown', onKey, true);
  root.innerHTML = ''; root.appendChild(dlg); root.hidden = false; dialogs++;
  dlDlg = { close };
  drawHead();
  setTimeout(() => { const f = dlg.querySelector('.dlrow .lbtn:not(:disabled)') || dlg.querySelector('.dbtns .dbtn'); f && f.focus(); }, 0);
  load();
}
$('dlBtn').onclick = openDownloadDialog;

// kéo thả file / thư mục vào cửa sổ: nhớ vào thư viện + cho vào hàng đợi (file đầu phát ngay nếu đang rảnh)
// Luôn chặn hành vi mặc định, nếu không Electron sẽ mở thẳng file đó thay cho app.
let dragN = 0;
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
document.addEventListener('dragenter', e => {
  e.preventDefault();
  if (hasFiles(e) && !deckDlg && !dlDlg) { dragN++; $('dropHint').textContent = sfxDlg ? 'Thả file âm thanh vào đây để thêm làm hiệu ứng' : 'Thả file nhạc / video hoặc thư mục vào đây'; $('dropHint').hidden = false; }
});
document.addEventListener('dragleave', e => { e.preventDefault(); if (hasFiles(e)) { dragN = Math.max(0, dragN - 1); if (!dragN) $('dropHint').hidden = true; } });
document.addEventListener('dragover', e => { e.preventDefault(); });
document.addEventListener('drop', async e => {
  e.preventDefault(); dragN = 0; $('dropHint').hidden = true;
  if (!hasFiles(e)) return;
  const paths = [...e.dataTransfer.files].map(f => bridge.pathFor(f)).filter(Boolean);
  if (!paths.length) { toast('Không đọc được đường dẫn file vừa thả'); return; }
  if (deckDlg) { toast('Đang mở Kịch Bản: đóng cửa sổ này rồi hãy thả file nhạc'); return; }
  if (dlDlg) { toast('Đang mở Tải Sẵn Về Máy: đóng cửa sổ này rồi hãy thả file nhạc'); return; }
  if (sfxDlg) { await sfxDlg.addPaths(paths); return; } // đang mở bảng hiệu ứng: file thả vào là thêm hiệu ứng, không vào hàng đợi
  const r = await bridge.call('localDrop', [paths]);
  toast(localResultText(r) + (r.folders ? ' · đã nhớ ' + r.folders + ' thư mục' : ''));
  lastControlAt = Date.now();
});

// ------------------------------------------------------------------ khởi động
(async () => {
  const init = await bridge.call('initial');
  cats = init.cats; favs = init.favs; search = init.search;
  renderCats(); renderSearch();
  try { sfxItems = await bridge.call('sfxList'); } catch (e) { /* bỏ qua */ }
  try { const bi = await bridge.call('bannerInit'); bnr.list = bi.list; bnr.colors = bi.colors; bnr.last = bi.list[0] || null; if (bi.cur) applyBanner(bi.cur); } catch (e) { /* bỏ qua */ }
  bridge.send('player-ready');
})();


// ------------------------------------------------------------------ video/hình chờ + điều khiển TV/LED
function drawBgName(b) {
  $('bgName').textContent = b ? (b.type === 'video' ? '🎞 ' : '🖼 ') + b.name : 'Chưa chọn (nền mặc định)';
  $('bgName').title = b ? b.file : '';
  $('bgOff').disabled = !b;
}
bridge.on('bg', drawBgName);
bridge.call('bgGet').then(drawBgName).catch(() => {});
$('bgVid').onclick = async () => { const b = await bridge.call('bgPick', ['video']); drawBgName(b); if (b && b.type === 'video') toast('Đã đặt video chờ: ' + b.name); };
$('bgImg').onclick = async () => { const b = await bridge.call('bgPick', ['image']); drawBgName(b); if (b && b.type === 'image') toast('Đã đặt hình chờ: ' + b.name); };
$('bgOff').onclick = async () => { await bridge.call('bgClear'); drawBgName(null); toast('Đã bỏ video/hình chờ, về nền mặc định'); };

// HIỆU ỨNG: bảng thả hiệu ứng cổ vũ (tim, pháo hoa, vỗ tay...) lên màn hình TV/LED
(function () {
  const grid = $('fxGrid');
  (window.REACTIONS || []).forEach(([id, e, name]) => {
    const b = document.createElement('button'); b.className = 'fxb nav'; b.type = 'button'; b.title = name; b.setAttribute('aria-label', name);
    b.innerHTML = '<span class="e">' + e + '</span><span class="l">' + esc(name) + '</span>';
    b.onclick = () => bridge.call('react', [id]); grid.appendChild(b);
  });
})();
function closeFxPop() { $('fxPop').hidden = true; $('scrFx').setAttribute('aria-expanded', 'false'); }
$('scrFx').onclick = () => { const open = $('fxPop').hidden; $('fxPop').hidden = !open; $('scrFx').setAttribute('aria-expanded', String(open)); if (open) { const f = $('fxGrid').querySelector('.fxb'); f && f.focus({ preventScroll: true }); } };
$('fxClose').onclick = () => { closeFxPop(); $('scrFx').focus(); };
document.addEventListener('mousedown', e => { if (!$('fxPop').hidden && !e.target.closest('#fxPop, #scrFx')) closeFxPop(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('fxPop').hidden) { e.preventDefault(); e.stopPropagation(); closeFxPop(); $('scrFx').focus(); } }, true);

let screenMode = 'LIVE';
function drawScreen(m) {
  screenMode = m || 'LIVE';
  $('scrOn').classList.toggle('on', screenMode === 'LIVE');
  $('scrStandby').classList.toggle('on', screenMode === 'STANDBY');
  $('scrOff').classList.toggle('on', screenMode === 'BLACK');
}
bridge.on('screen', drawScreen);
bridge.call('getScreen').then(drawScreen).catch(() => {});
$('scrOn').onclick = async () => {
  const s = await bridge.call('getSettings');
  if (s.tvOutput === 'OFF') await bridge.call('setSetting', ['tvOutput', 'AUTO']);
  drawScreen(await bridge.call('setScreen', ['LIVE']));
  toast(tvActive ? 'Đã mở TV/LED: đang hiện hình đang phát' : 'Đã bật xuất ra TV/LED. Cắm HDMI ở chế độ Mở rộng (Windows + P) để hiện hình.');
};
$('scrStandby').onclick = async () => { drawScreen(await bridge.call('setScreen', ['STANDBY'])); toast('TV/LED đang hiện màn hình chờ (nhạc vẫn phát)'); };
$('scrOff').onclick = async () => { drawScreen(await bridge.call('setScreen', ['BLACK'])); toast('Đã tắt hình trên TV/LED (nhạc vẫn phát). Bấm MỞ TV/LED để hiện lại'); };

// Icon tròn ở đầu trang: bấm = bấm nút tương ứng ở cột trái (kể cả khi cột trái đang ẩn); đồng bộ trạng thái sáng
document.querySelectorAll('.tbtn').forEach(t => {
  const src = $(t.dataset.for);
  t.onclick = () => src.click();
  const sync = () => t.classList.toggle('on', src.classList.contains('on'));
  new MutationObserver(sync).observe(src, { attributes: true, attributeFilter: ['class'] }); sync();
});
