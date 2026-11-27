'use strict';
// Tìm bài theo kênh + link kênh: dùng chung cho điện thoại (server.js) và máy tính (main.js).
const { norm } = require('./util');

/**
 * Chạy tìm kiếm nhiều trang rồi chỉ giữ bài có tên kênh chứa đủ các từ của `chan` (không phân biệt hoa thường/dấu).
 * runPage(p) -> { hits, hasMore }. Tối đa `maxPages` trang, dừng sớm khi đủ `maxHits` bài.
 */
async function searchByChannel(runPage, chan, opts) {
  const maxPages = (opts && opts.maxPages) || 5, maxHits = (opts && opts.maxHits) || 20;
  const tokens = norm(chan).split(/\s+/).filter(Boolean);
  const out = [];
  if (!tokens.length) return out;
  for (let p = 0; p < maxPages; p++) {
    const r = await runPage(p);
    for (const h of r.hits) {
      const c = norm(h.channel);
      if (tokens.every(t => c.includes(t)) && !out.some(x => x.videoId === h.videoId)) out.push(h);
    }
    if (!r.hasMore || out.length >= maxHits) break;
  }
  return out;
}

/** Chỉ nhận link youtube.com (https) để không mở nhầm địa chỉ lạ bằng trình duyệt. */
function safeChannelUrl(u) {
  return typeof u === 'string' && u.length < 500 && /^https:\/\/(www\.|m\.)?youtube\.com\/[^\s]*$/.test(u) ? u : null;
}

/** Dự phòng khi không lấy được link kênh: trang tìm kiếm YouTube lọc theo "Kênh". */
function channelSearchUrl(name) {
  return 'https://www.youtube.com/results?sp=EgIQAg%253D%253D&search_query=' + encodeURIComponent(String(name || '').slice(0, 100));
}

module.exports = { searchByChannel, safeChannelUrl, channelSearchUrl };
