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

/** Duyệt JSON của YouTube lấy videoRenderer + token trang kế. */
function walk(o, out, seen, tok) {
  if (Array.isArray(o)) { for (const x of o) walk(x, out, seen, tok); return; }
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (k === 'videoRenderer' && v && typeof v === 'object') {
      const id = v.videoId;
      const dur = parseDur(v.lengthText && v.lengthText.simpleText);
      if (ID_RE.test(id || '') && dur > 60 && !seen.has(id)) {
        seen.add(id);
        const title = (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text) || '';
        const ch = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text) || '';
        out.push({ videoId: id, title, channel: ch, durationSec: dur });
      }
    } else if (k === 'continuationCommand' && v && v.token) {
      tok.token = v.token;
    } else walk(v, out, seen, tok);
  }
}

async function postInnertube(body) {
  const ctx = { client: { clientName: 'WEB', clientVersion: CLIENT_VER, hl: 'vi', gl: 'VN' } };
  const r = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'user-agent': UA, origin: 'https://www.youtube.com',
      'x-youtube-client-name': '1', 'x-youtube-client-version': CLIENT_VER, cookie: 'CONSENT=YES+1; SOCS=CAI'
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
  const out = [];
  walk(JSON.parse(html.substring(start, end)), out, new Set(), {});
  return out;
}

const sessions = new Map(); // q -> { created, pages: [hits[]], token, done, busy }

/** Tìm kiếm có phân trang: mỗi "trang" là một lô kết quả của YouTube. Trả về { hits, hasMore }. */
async function search(query, page, karaoke) {
  let q = String(query).trim();
  const low = q.toLowerCase();
  if (karaoke && !low.includes('karaoke') && !low.includes('beat')) q += ' karaoke';
  let s = sessions.get(q);
  if (!s || Date.now() - s.created > 5 * 60000) {
    s = { created: Date.now(), pages: [], token: null, done: false, started: false, chain: Promise.resolve(), html: false };
    sessions.set(q, s);
    if (sessions.size > 30) sessions.delete(sessions.keys().next().value);
  }
  // Tuần tự hoá các yêu cầu cùng một từ khoá
  const run = s.chain.then(async () => {
    while (s.pages.length <= page && !s.done) {
      let out = [];
      const tok = {};
      if (!s.started) {
        s.started = true;
        try {
          walk(await postInnertube({ query: q, params: 'EgIQAQ==' }), out, new Set(), tok);
        } catch (e) { out = []; }
        if (!out.length) {
          out = await htmlSearch(q);
          s.html = true;
        }
      } else if (s.token && !s.html) {
        walk(await postInnertube({ continuation: s.token }), out, new Set(), tok);
      } else { s.done = true; break; }
      s.token = tok.token || null;
      if (!s.token) s.done = true;
      // loại trùng với các trang trước
      const seen = new Set(s.pages.flat().map(h => h.videoId));
      s.pages.push(out.filter(h => !seen.has(h.videoId)));
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

module.exports = { search, oembed };
