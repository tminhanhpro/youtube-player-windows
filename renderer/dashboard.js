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
let shown = { q: '', n: 0, first: null, cols: 0 }, lastQueueSig = '', lastQr = null, shiftHeld = false;
let voiceWasPlaying = false, tvActive = false;

// ------------------------------------------------------------------ trình phát
const player = window.createPlayer($('vbox'), (kind, key, a, b) => bridge.send('player-event', { kind, key, a, b }));
bridge.on('player', c => player.command(c));

// ------------------------------------------------------------------ hiệu ứng cổ vũ + tin nhắn từ điện thoại
// Khi đã xuất ra màn hình lớn thì hiệu ứng chỉ chạy trên màn lớn (tránh chạy trùng ở cả hai nơi)
const fx = window.createFx($('fxl'));
bridge.on('reaction', id => { if (!tvActive) fx.react(id); });
bridge.on('message', m => { if (!tvActive) fx.message(m.sender, m.text); });

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
  d.className = 'dlg'; d.setAttribute('role', 'dialog');
  let html = '<h2>' + esc(o.title || '') + '</h2>';
  (o.lines || []).forEach(l => { html += '<p' + (l.style ? ' style="' + l.style + '"' : '') + '>' + esc(l.text || l) + '</p>'; });
  d.innerHTML = html;
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
bridge.on('state', s => { snap = s.snap; info = s.info; cfg = s.info.cfg || cfg; renderState(); });
bridge.on('search', s => { search = s; renderSearch(); });
bridge.on('cats', l => { const q = cats[selCat] && cats[selCat].q; cats = l; selCat = q == null ? -1 : cats.findIndex(c => c.q === q); renderCats(); });
bridge.on('favs', l => { favs = l; if (favMode) renderFavs(0); else refreshHearts(); });
bridge.on('volume', showVolume);
// Có màn hình lớn: tiếng ra màn lớn, khung nhỏ ở đây chỉ chạy hình (tắt tiếng) và không tự phóng to
bridge.on('tv-state', t => { tvActive = !!t.active; player.setMuted(tvActive); renderState(); });

function renderState() {
  if (!snap || !info) return;
  // đầu trang
  const rc = info.remoteConnected;
  $('remoteDot').className = 'ic dotic' + (rc ? ' on' : '');
  $('remote').className = 'remote' + (rc ? ' on' : '');
  $('remote').textContent = rc ? 'Remote Đã Kết Nối' + (info.who ? ' (' + info.who + ')' : '') : 'Chờ điện thoại kết nối';
  $('netText').textContent = info.net.text; $('netIcon').innerHTML = window.ICONS[info.net.icon] || window.ICONS.wifi;
  $('clock').textContent = new Date().toTimeString().slice(0, 5);
  // QR
  $('port').textContent = 'CỔNG ' + info.port;
  $('qrBody').hidden = !!cfg.qrHidden; $('qrToggle').textContent = cfg.qrHidden ? 'Hiện' : 'Ẩn';
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
    st === 'ERROR' ? 'Không phát được bài này, đang chuyển bài…' :
    st === 'IDLE' ? 'Chưa phát bài nào\nChọn bài ở danh sách hoặc dùng điện thoại' :
    'Đang tải bài hát…');
  $('badge').textContent = (st === 'PAUSED' ? 'ĐANG TẠM DỪNG' : 'NOW PLAYING') + (tvActive ? ' · ĐANG XUẤT RA TV' : '');
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
  const sig = items.map(i => i.itemId + i.title).join('|');
  if (sig === lastQueueSig) return;
  lastQueueSig = sig;
  const box = $('qlist');
  const fi = [...box.children].findIndex(c => c === document.activeElement);
  box.innerHTML = '';
  if (!items.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Chưa có bài nào chờ.\nChọn bài ở giữa hoặc dùng điện thoại để thêm.'; box.appendChild(e); return; }
  items.forEach((qi, i) => {
    const r = document.createElement('div');
    r.className = 'q'; r.tabIndex = 0; r.dataset.kind = 'queue';
    r.innerHTML = '<span class="n">' + (i + 1) + '</span><img src="' + esc(thumb(qi.videoId)) + '" alt=""><div class="i"><div class="t ell">' + esc(qi.title) +
      '</div><div class="a ell">' + (qi.addedBy ? 'Yêu cầu từ: ' + esc(qi.addedBy) : 'Tự động đề xuất') + '</div></div>' +
      (qi.durationSec > 0 ? '<span class="d">' + mmss(qi.durationSec * 1000) + '</span>' : '');
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

function makeCard(h, idx) {
  const c = document.createElement('div');
  c.className = 'cardv' + (isFav(h.videoId) ? ' fav' : ''); c.tabIndex = 0; c.dataset.kind = 'card'; c.dataset.vid = h.videoId;
  c.innerHTML = '<div class="th"><img loading="lazy" src="' + esc(thumb(h.videoId)) + '" alt="">' +
    (h.durationSec > 0 ? '<span class="dur">' + mmss(h.durationSec * 1000) + '</span>' : '') +
    '<span class="ic h">' + window.ICONS.heart + '</span></div><div class="tx"><div class="ct">' + esc(h.title) + '</div><div class="cc">' + esc(h.channel) + '</div></div>';
  c.onclick = e => addHit(h, e.shiftKey || shiftHeld);
  c._long = () => (favMode ? removeFav(h) : addFav(h));
  c.oncontextmenu = e => { e.preventDefault(); c._long(); };
  c._remove = () => { if (favMode) removeFav(h); };
  c.onfocus = () => { if (!favMode && idx >= (search.results.length - 4)) bridge.call('tvLoadMore'); };
  return c;
}

function renderSearch() {
  const sv = search;
  if (favMode) { if (sv.query === favSearchQuery) return; leaveFavMode(); }
  $('status').textContent =
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
  renderCats(); $('favBtn').classList.add('on'); renderFavs(0);
}
function leaveFavMode() {
  if (!favMode) return;
  favMode = false; $('favBtn').classList.remove('on');
  shown = { q: '', n: 0, first: null, cols: 0 }; $('grid').innerHTML = '';
}
function renderFavs(focusIdx) {
  const g = $('grid'); g.innerHTML = '';
  shown = { q: '\u0000fav', n: -1, first: null, cols: 0 };
  $('status').textContent = favs.length ? '❤ Yêu thích · ' + favs.length + ' bài · Enter: thêm vào danh sách phát · Chuột phải / giữ Enter: xoá khỏi Yêu thích'
    : 'Chưa có bài yêu thích. Khi tìm kiếm, bấm chuột phải (hoặc giữ Enter) trên bài hát để thêm vào đây.';
  favs.forEach((h, i) => g.appendChild(makeCard(h, i)));
  const t = g.children[Math.min(focusIdx, g.children.length - 1)];
  if (t && !fullscreen) t.focus(); else if (!g.children.length) $('favBtn').focus();
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
$('addCat').onclick = () => modal({
  title: 'Tạo thể loại mới (tên cũng là từ khoá tìm)', input: { placeholder: 'Ví dụ: Nhạc không lời' },
  buttons: [{ label: 'Tạo', primary: true, run: async v => { const i = await bridge.call('catAdd', [v || '']); if (i >= 0) setTimeout(() => selectCat(i), 100); } }, { label: 'Hủy' }]
});
$('qrToggle').onclick = () => bridge.call('setSetting', ['qrHidden', !cfg.qrHidden]);

// ------------------------------------------------------------------ karaoke, tìm kiếm, giọng nói
$('karaoke').onclick = async () => {
  const on = !(snap && snap.karaoke);
  await bridge.call('setKaraoke', [on]);
  toast(on ? 'Karaoke: BẬT — mọi tìm kiếm tự thêm chữ karaoke' : 'Karaoke: TẮT');
  const q = search.query.trim(); if (q) tvSearch(q);
};
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch($('q').value); $('q').blur(); } });
$('addSong').onclick = () => $('q').focus();

function resumeAfterVoice() {
  if (!voiceWasPlaying) return;
  voiceWasPlaying = false;
  [0, 400, 1200, 2500].forEach(d => setTimeout(() => bridge.call('resume'), d));
}
$('mic').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Máy này chưa hỗ trợ tìm bằng giọng nói — hãy gõ hoặc dùng điện thoại'); return; }
  voiceWasPlaying = !!(snap && snap.state === 'PLAYING');
  if (voiceWasPlaying) bridge.call('pause');
  const r = new SR(); r.lang = 'vi-VN'; r.interimResults = false; r.maxAlternatives = 1;
  toast('Nói tên bài hát hoặc ca sĩ…');
  r.onresult = e => { const t = e.results[0] && e.results[0][0] && e.results[0][0].transcript; if (t) { $('q').value = t; doSearch(t); } };
  r.onerror = () => { toast('Windows chưa nhận được giọng nói (cần mạng và micro) — hãy gõ hoặc dùng điện thoại'); resumeAfterVoice(); };
  r.onend = resumeAfterVoice;
  try { r.start(); } catch (e) { toast('Không bật được micro'); resumeAfterVoice(); }
};

// ------------------------------------------------------------------ nút điều khiển
$('b-back').onclick = () => bridge.call('seekTo', [null, -10000]);
$('b-fwd').onclick = () => bridge.call('seekTo', [null, 10000]);
$('b-next').onclick = () => bridge.call('skip');
$('b-play').onclick = () => bridge.call(snap && snap.state === 'PAUSED' ? 'resume' : 'pause');
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
      { label: 'Số bài mỗi hàng kết quả: ' + s.gridCols, run: again(() => bridge.call('setSetting', ['gridCols', s.gridCols === 3 ? 2 : s.gridCols === 2 ? 1 : 3])) },
      { label: 'Tự phóng lớn video sau: ' + (s.fullscreenSec === 0 ? 'TẮT' : s.fullscreenSec + ' giây'), run: again(() => { lastControlAt = Date.now(); return bridge.call('setSetting', ['fullscreenSec', nextOf([3, 5, 10, 15, 30, 60, 0], s.fullscreenSec)]); }) },
      { label: 'Xuất ra màn hình ngoài (HDMI): ' + (s.tvOutput === 'OFF' ? 'TẮT' : 'TỰ ĐỘNG') + (tvActive ? ' · đang xuất' : ''), run: again(() => bridge.call('setSetting', ['tvOutput', s.tvOutput === 'OFF' ? 'AUTO' : 'OFF'])) },
      { label: 'Khôi phục 5 thể loại mặc định', run: async () => { await bridge.call('catsReset'); selCat = -1; toast('Đã khôi phục các thể loại mặc định'); } },
      { label: 'Đặt lại ghép nối (ngắt mọi điện thoại)', run: () => modal({
        title: 'Đặt lại ghép nối?', lines: ['Tất cả điện thoại đã kết nối sẽ bị ngắt. Quét lại mã QR để kết nối.'],
        buttons: [{ label: 'Đặt lại', primary: true, run: () => bridge.call('resetPairing') }, { label: 'Hủy' }] }) },
      { label: 'Xong' }
    ]
  });
}
$('gear').onclick = showSettings;

// ------------------------------------------------------------------ phóng to / thu nhỏ video
function enterFullscreen() {
  if (fullscreen || !snap) return;
  if (snap.state !== 'PLAYING' && snap.state !== 'PAUSED') return;
  fullscreen = true; fsAt = Date.now(); savedFocus = document.activeElement;
  $('count').hidden = true; $('vbox').classList.add('full'); document.body.style.cursor = 'none';
}
function exitFullscreen() {
  if (!fullscreen) return;
  fullscreen = false; lastControlAt = Date.now();
  $('vbox').classList.remove('full'); document.body.style.cursor = '';
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
window.addEventListener('blur', () => { shiftHeld = false; });

// ------------------------------------------------------------------ khởi động
(async () => {
  const init = await bridge.call('initial');
  cats = init.cats; favs = init.favs; search = init.search;
  renderCats(); renderSearch();
  bridge.send('player-ready');
})();
