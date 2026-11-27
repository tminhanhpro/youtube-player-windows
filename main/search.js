'use strict';
const { ID_RE } = require('./util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CLIENT_VER = '2.20260105.01.00';

function parseDur(t) {
  if (!t) return -1;
  let total = 0;
  for (const p of String(t).split(':')) {
    const n = parseInt(p.trim(), 10);
    if (Number.isNaN(n)) return -1;
    total = total * 60 + n;
  }
  return total;
}

// Giống YouTube nhưng bỏ Shorts/video dọc: giữ mọi video dài hơn 60 giây, kể cả tuyển tập và playlist gộp dài cả giờ.
// Bộ lọc tuỳ chọn (mặc định TẮT): MAX_SEC (đổi searchMaxMin trong settings.json) và STRICT (searchStrict) để bớt tuyển tập.
let MAX_SEC = 0, STRICT = false;
function setMaxMinutes(m) { const n = Number(m); MAX_SEC = n > 0 ? Math.round(n * 60) : 0; }
function setStrictTitles(on) { STRICT = on === true; }
const DUR_RE = /^\d{1,2}(:\d{2}){1,2}$/;
const okDur = d => d > 60 && (!MAX_SEC || d <= MAX_SEC);
const fold = t => String(t || '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/đ/g, 'd');
const COMP_RE = /\b(playlist|tuyen tap|tuyen chon|nonstop|non stop|full album|compilation|tong hop|top ?\d+|\d+ ?(gio|tieng|hours?|hrs?)|\d+ (bai|songs?|tracks?)|mix)\b/;
const okTitle = t => !STRICT || !COMP_RE.test(fold(t));

function add(out, seen, tok, id, title, ch, dur) {
  if (tok) tok.raw = (tok.raw || 0) + 1;
  if (ID_RE.test(id || '') && okDur(dur) && okTitle(title) && !seen.has(id)) { seen.add(id); out.push({ videoId: id, title: title || '', channel: ch || '', durationSec: dur }); }
}

/** Kiểu hiển thị mới của YouTube (lockupViewModel): chỉ nhận loại VIDEO, bỏ playlist/mix/kênh. */
function fromLockup(v, out, seen, tok) {
  if (!v || v.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return;
  let dur = -1;
  const find = o => {
    if (dur >= 0 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(find); return; }
    if (typeof o.text === 'string' && DUR_RE.test(o.text.trim())) { dur = parseDur(o.text.trim()); return; }
    for (const k of Object.keys(o)) find(o[k]);
  };
  find(v.contentImage);
  const md = v.metadata && v.metadata.lockupMetadataViewModel;
  const title = md && md.title && md.title.content;
  let ch = '';
  try { ch = md.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.content; } catch (e) { /* không có tên kênh */ }
  add(out, seen, tok, v.contentId, title, ch, dur);
}

/** Duyệt JSON của YouTube lấy video + token trang kế. */
function walk(o, out, seen, tok) {
  if (Array.isArray(o)) { for (const x of o) walk(x, out, seen, tok); return; }
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (k === 'videoRenderer' && v && typeof v === 'object') {
      const url = (((v.navigationEndpoint || {}).commandMetadata || {}).webCommandMetadata || {}).url || '';
      const dur = parseDur(v.lengthText && v.lengthText.simpleText);
      const title = (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text) || '';
      const ch = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text) || '';
      if (/^\/shorts\//.test(url)) { if (tok) tok.raw = (tok.raw || 0) + 1; continue; }   // Shorts (video dọc) lọt vào dạng videoRenderer
      add(out, seen, tok, v.videoId, title, ch, dur);
    } else if (k === 'lockupViewModel' && v && typeof v === 'object') {
      fromLockup(v, out, seen, tok);
    } else if (k === 'continuationCommand' && v && v.token) {
      tok.token = v.token;
    } else walk(v, out, seen, tok);
  }
}

async function postInnertube(body, ver) {
  ver = ver || CLIENT_VER;
  const ctx = { client: { clientName: 'WEB', clientVersion: ver, hl: 'vi', gl: 'VN' } };
  const r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'user-agent': UA, origin: 'https://www.youtube.com',
      'x-youtube-client-name': '1', 'x-youtube-client-version': ver, cookie: 'CONSENT=YES+1; SOCS=CAI'
    },
    body: JSON.stringify({ context: ctx, ...body }),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function htmlSearch(q) {
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgIQAQ%3D%3D&hl=vi&gl=VN';
  const r = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'vi-VN,vi;q=0.9,en;q=0.6', cookie: 'CONSENT=YES+1; SOCS=CAI' },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const html = await r.text();
  let key = 'ytInitialData = ';
  let i = html.indexOf(key);
  if (i < 0) { key = 'ytInitialData"] = '; i = html.indexOf(key); }
  if (i < 0) throw new Error('ytInitialData not found');
  const start = i + key.length;
  const end = html.indexOf(';</script>', start);
  if (end < 0) throw new Error('bad page');
  const out = [], tok = {};
  walk(JSON.parse(html.substring(start, end)), out, new Set(), tok);
  const vm = /"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/.exec(html);
  return { out, token: tok.token || null, ver: vm ? vm[1] : null, raw: tok.raw || 0 };
}

const sessions = new Map(); // q -> { created, pages: [hits[]], token, done, busy }
const PER_PAGE = 12, MAX_LOTS = 4;   // mỗi lần cuộn gom ít nhất ~12 bài (sau khi lọc), tối đa 4 lô của YouTube

function dbg(msg) { try { require('./resolver').log('TÌM KIẾM ' + msg); } catch (e) { /* ignore */ } }

/** Lấy một lô kết quả của YouTube. Trả về { list, raw } (raw = số video trước khi lọc). */
async function fetchLot(s, q) {
  const out = [], tok = {};
  if (!s.started) {
    let why = '';
    try { walk(await postInnertube({ query: q, params: 'EgIQAQ==' }, s.ver), out, new Set(), tok); } catch (e) { why = String(e && e.message || e); out.length = 0; tok.raw = 0; tok.token = null; }
    if (!tok.raw) {
      // Innertube không dùng được: đọc trang kết quả (HTML), lấy luôn token + phiên bản client để cuộn tiếp
      const h = await htmlSearch(q);
      out.push(...h.out); tok.token = h.token; tok.raw = h.raw; if (h.ver) s.ver = h.ver; s.html = true;
      dbg('"' + q + '": innertube lỗi/trống (' + (why || 'không có kết quả') + '), dùng trang HTML: ' + h.raw + ' video, ' + out.length + ' sau lọc, token ' + (h.token ? 'có' : 'KHÔNG'));
    }
    s.started = true;
  } else if (s.token) {
    walk(await postInnertube({ continuation: s.token }, s.ver), out, new Set(), tok);
  } else { s.done = true; return { list: [], raw: 0 }; }
  s.token = tok.token || null;
  if (!s.token) s.done = true;
  return { list: out, raw: tok.raw || 0 };
}

/** Tìm kiếm có phân trang: mỗi "trang" gom từ một hay nhiều lô của YouTube. Trả về { hits, hasMore }. */
async function search(query, page, karaoke) {
  let q = String(query).trim();
  const low = q.toLowerCase();
  if (karaoke && !low.includes('karaoke') && !low.includes('beat')) q += ' karaoke';
  let s = sessions.get(q);
  if (s && Date.now() - s.created <= 30 * 60000) s.created = Date.now();   // dùng đến đâu gia hạn đến đó
  if (!s || Date.now() - s.created > 30 * 60000) {
    s = { created: Date.now(), pages: [], token: null, done: false, started: false, chain: Promise.resolve(), html: false, ver: null };
    sessions.set(q, s);
    if (sessions.size > 30) sessions.delete(sessions.keys().next().value);
  }
  // Tuần tự hoá các yêu cầu cùng một từ khoá
  const run = s.chain.then(async () => {
    while (s.pages.length <= page && !s.done) {
      const acc = [], seen = new Set(s.pages.flat().map(h => h.videoId));
      for (let i = 0; i < MAX_LOTS && !s.done && acc.length < PER_PAGE; i++) {
        let lot;
        try { lot = await fetchLot(s, q); } catch (e) { if (acc.length) break; throw e; }   // lỗi mạng: giữ token, lần cuộn sau thử lại
        for (const h of lot.list) if (!seen.has(h.videoId)) { seen.add(h.videoId); acc.push(h); }
      }
      s.pages.push(acc);
      dbg('"' + q + '" trang ' + s.pages.length + ': +' + acc.length + ' bài, ' + (s.done ? 'HẾT' : 'còn tiếp') + (s.html ? ' (nguồn HTML)' : ''));
    }
  });
  s.chain = run.catch(() => {});
  await run;
  const hits = s.pages[page] || [];
  return { hits, hasMore: s.pages.length > page + 1 || !s.done };
}

async function oembed(id) {
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title || '', channel: j.author_name || '' };
  } catch (e) { return null; }
}

module.exports = { search, oembed, walk, setMaxMinutes, setStrictTitles };
