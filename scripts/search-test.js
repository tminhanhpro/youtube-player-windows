'use strict';
// Tìm kiếm: lọc Shorts / video quá dài / playlist, đọc cả kiểu lockupViewModel, cuộn tải thêm, dự phòng trang HTML. Dùng dữ liệu giả, không cần mạng.
const assert = require('assert');
const S = require('../main/search');

const id = n => 'v' + String(n).padStart(10, '0');   // 11 ký tự
const vr = (n, dur, extra) => ({ videoRenderer: { videoId: id(n), title: { runs: [{ text: 'Bài ' + n }] }, ownerText: { runs: [{ text: 'Kênh' }] }, lengthText: { simpleText: dur }, ...(extra || {}) } });
const lk = (n, dur, type) => ({ lockupViewModel: { contentId: id(n), contentType: type || 'LOCKUP_CONTENT_TYPE_VIDEO',
  contentImage: { thumbnailViewModel: { overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: dur } }] } }] } },
  metadata: { lockupMetadataViewModel: { title: { content: 'Lockup ' + n }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Kênh L' } }] }] } } } } } });
const cont = t => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: t } } } });

const named = (n, title, dur) => ({ videoRenderer: { videoId: id(n), title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: 'K' }] }, lengthText: { simpleText: dur } } });
// 0) mặc định giống YouTube: giữ cả tuyển tập dài cả giờ và video tên "Playlist", chỉ bỏ Shorts (<= 60 giây hoặc đường dẫn /shorts/)
let o0 = [];
S.walk({ x: [vr(70, '1:02:10'), named(71, 'Playlist nhạc vàng hay nhất', '5:00'), named(72, 'Tuyển tập 1 giờ', '58:30'), lk(73, '1:20:00'), vr(74, '0:45'),
  vr(75, '4:10', { navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/shorts/zzz' } } } })] }, o0, new Set(), {});
assert.deepStrictEqual(o0.map(h => h.videoId), [id(70), id(71), id(72), id(73)], 'mặc định phải giữ tuyển tập/playlist dài, chỉ bỏ Shorts');
// bộ lọc tuỳ chọn (bật bằng cài đặt) để bớt tuyển tập
S.setMaxMinutes(10); S.setStrictTitles(true);

// 1) walk: lọc
let out = [], tok = {};
S.walk({ items: [
  vr(1, '3:45'), vr(2, '0:45'), vr(3, '1:02:10'), vr(4, '4:10', { navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/shorts/abc' } } } }),
  lk(5, '4:20'), lk(6, '58:00'), lk(7, '3:00', 'LOCKUP_CONTENT_TYPE_PLAYLIST'), { shortsLockupViewModel: { entityId: 'x' } }, vr(1, '3:45'), cont('T1')
] }, out, new Set(), tok);
assert.deepStrictEqual(out.map(h => h.videoId), [id(1), id(5)], 'chỉ giữ MV 1:00–10:00, bỏ Shorts, tuyển tập, playlist, trùng');
assert.strictEqual(out[1].title, 'Lockup 5'); assert.strictEqual(out[1].channel, 'Kênh L'); assert.strictEqual(out[1].durationSec, 260);
assert.strictEqual(tok.token, 'T1');

// 1b) mốc mặc định 10 phút + lọc theo tiêu đề tuyển tập
out = [];
S.walk({ x: [named(50, 'Em Của Ngày Hôm Qua (Official MV)', '4:30'), named(51, 'Liên khúc Xuân 2027', '8:10'), named(52, 'Remix Sóng Gió', '3:20'),
  named(53, 'Tuyển tập nhạc vàng hay nhất', '9:00'), named(54, 'NONSTOP DJ 2026', '6:00'), named(55, 'Top 10 bài hát hot', '7:00'),
  named(56, 'Nhạc trẻ 1 giờ liên tục', '5:00'), named(57, 'Playlist chill', '5:00'), named(58, 'Bài hát dài 12 phút', '12:00'), named(59, 'Chill Mix', '4:00')] }, out, new Set(), {});
assert.deepStrictEqual(out.map(h => h.videoId), [id(50), id(51), id(52)], 'giữ MV, liên khúc ngắn, remix; bỏ tuyển tập/nonstop/top/playlist/mix/quá 10 phút; có ' + out.map(h => h.title).join(' | '));
S.setStrictTitles(false); out = []; S.walk({ x: [named(53, 'Tuyển tập nhạc vàng', '9:00')] }, out, new Set(), {}); assert.strictEqual(out.length, 1, 'tắt lọc tiêu đề thì giữ');
S.setStrictTitles(true);

// 2) không giới hạn (0) thì giữ cả video dài
S.setMaxMinutes(0); out = []; S.walk({ a: [vr(3, '1:02:10')] }, out, new Set(), {}); assert.strictEqual(out.length, 1);
S.setMaxMinutes(0); S.setStrictTitles(false);   // phần còn lại kiểm tra ở chế độ mặc định

(async () => {
  // 3) innertube hoạt động: nhiều lô, mỗi lô nhiều bài bị lọc -> vẫn gom đủ, cuộn tiếp ra thêm, hết thì hasMore=false
  const lots = [
    { x: [vr(1, '3:00'), vr(2, '3:00'), vr(3, '1:20:00'), vr(4, '0:30'), cont('K1')] },
    { x: [vr(5, '3:00'), vr(6, '1:30:00'), vr(7, '3:00'), cont('K2')] },
    { x: [vr(8, '3:00'), vr(9, '3:00'), vr(10, '3:00'), vr(11, '3:00'), vr(12, '3:00'), vr(13, '3:00'), vr(14, '3:00'), vr(15, '3:00'), cont('K3')] },
    { x: [vr(16, '3:00'), vr(17, '3:00')] }   // lô cuối: không còn token
  ];
  let calls = 0;
  global.fetch = async (url, o) => ({ ok: true, json: async () => lots[calls++] });
  let r = await S.search('thử một', 0, false);
  assert.ok(r.hits.length >= 12, 'trang đầu gom đủ ~12 bài dù lô đầu bị lọc nhiều, có ' + r.hits.length);
  assert.ok(r.hasMore);
  r = await S.search('thử một', 1, false);
  assert.ok(r.hits.length > 0 && r.hits.every(h => !['v0000000001', 'v0000000002'].includes(h.videoId)), 'trang 2 không trùng trang 1');
  assert.strictEqual(r.hasMore, false, 'hết token là hết kết quả');

  // 4) innertube lỗi -> trang HTML, có token + phiên bản client -> vẫn cuộn tiếp được bằng continuation
  const yt = d => '<html><script>var ytInitialData = ' + JSON.stringify(d) + ';</script>"INNERTUBE_CLIENT_VERSION":"2.20990101.00.00"</html>';
  const seenVer = [];
  global.fetch = async (url, o) => {
    if (String(url).includes('youtubei')) {
      const b = JSON.parse(o.body);
      if (b.continuation) {
        seenVer.push(b.context.client.clientVersion);
        const base = seenVer.length === 1 ? 30 : 60, more = seenVer.length === 1;
        const items = []; for (let i = 0; i < 12; i++) items.push(vr(base + i, '3:10'));
        if (more) items.push(cont('H2'));
        return { ok: true, json: async () => ({ x: items }) };
      }
      return { ok: false, status: 400, json: async () => ({}) };
    }
    return { ok: true, text: async () => yt({ x: [vr(20, '3:10'), vr(21, '3:10'), lk(22, '3:10'), cont('H1')] }) };
  };
  r = await S.search('thử hai', 0, false);
  assert.ok(r.hits.length >= 3 && r.hasMore, 'trang HTML còn token thì hasMore=true');
  r = await S.search('thử hai', 1, false);
  assert.ok(r.hits.length >= 12, 'cuộn tiếp từ nguồn HTML phải ra thêm bài, có ' + r.hits.length);
  assert.strictEqual(seenVer[0], '2.20990101.00.00', 'dùng phiên bản client đọc từ trang HTML');
  assert.strictEqual(r.hasMore, false, 'lô cuối không còn token thì hết');
  console.log('Tìm kiếm: lọc MV/Shorts/playlist + lockupViewModel + cuộn tải thêm + dự phòng HTML đều đạt');
})().catch(e => { console.error(e); process.exit(1); });
