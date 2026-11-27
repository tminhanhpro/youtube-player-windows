'use strict';
// Menu chuột phải trên thẻ bài hát (máy tính): thêm/xoá Yêu thích, Xem bài của kênh này, Phát ngay, Thêm vào hàng đợi, Mở trang kênh trên YouTube.
// Phần 1: lọc theo kênh + link kênh (không cần mạng). Phần 2: cửa sổ máy tính trong Chromium với main-process giả.
const path = require('path'), assert = require('assert');
const CS = require('../main/chansearch');

(async () => {
  // ---- phần 1
  const hit = (id, ch) => ({ videoId: id, title: 'Bài ' + id, channel: ch, durationSec: 200 });
  const pages = [
    { hits: [hit('a1', 'Sơn Tùng M-TP Official'), hit('a2', 'Kênh khác'), hit('a3', 'SON TUNG m-tp')], hasMore: true },
    { hits: [hit('a3', 'SON TUNG m-tp'), hit('a4', 'Sơn Tùng M-TP Official')], hasMore: true },
    { hits: [hit('a5', 'Sơn Tùng M-TP Official')], hasMore: false }
  ];
  let nPages = 0;
  let out = await CS.searchByChannel(async p => { nPages++; return pages[p]; }, 'son tung M-TP');
  assert.deepStrictEqual(out.map(h => h.videoId), ['a1', 'a3', 'a4', 'a5'], 'lọc không phân biệt hoa thường/dấu, bỏ trùng, bỏ kênh khác');
  assert.equal(nPages, 3, 'hết trang thì dừng');
  nPages = 0;
  out = await CS.searchByChannel(async p => { nPages++; return { hits: Array.from({ length: 10 }, (_, i) => hit('p' + p + 'x' + i, 'K')), hasMore: true }; }, 'K');
  assert.equal(nPages, 2, 'đủ 20 bài thì dừng sớm'); assert.equal(out.length, 20);
  nPages = 0;
  out = await CS.searchByChannel(async () => { nPages++; return { hits: [], hasMore: true }; }, 'K');
  assert.equal(nPages, 5, 'tối đa 5 trang'); assert.equal(out.length, 0);
  assert.deepStrictEqual(await CS.searchByChannel(async () => { throw new Error('không được gọi'); }, '   '), [], 'tên kênh rỗng: không tìm');
  assert.equal(CS.safeChannelUrl('https://www.youtube.com/channel/UCabc'), 'https://www.youtube.com/channel/UCabc');
  assert.equal(CS.safeChannelUrl('https://www.youtube.com/@abc'), 'https://www.youtube.com/@abc');
  for (const bad of ['http://www.youtube.com/channel/x', 'https://evil.com/?https://www.youtube.com/', 'https://youtube.com.evil.com/x', 'file:///c:/x.exe', 'javascript:alert(1)', '', null, undefined, 5])
    assert.equal(CS.safeChannelUrl(bad), null, 'từ chối: ' + bad);
  const su = CS.channelSearchUrl('Sơn Tùng & M-TP');
  assert.ok(su.startsWith('https://www.youtube.com/results?sp=EgIQAg%253D%253D&search_query=') && su.includes(encodeURIComponent('Sơn Tùng & M-TP')));
  console.log('Lọc theo kênh + link kênh: đạt');

  // ---- phần 2
  const { chromium } = require('playwright');
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    const handlers = {}; window.__calls = [];
    window.__emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
    const res = [
      { videoId: 'vidAAAAAAA1', title: 'Bài của Kênh Một', channel: 'Kênh Một', durationSec: 100 },
      { videoId: 'vidBBBBBBB2', title: 'Bài không rõ kênh', channel: '', durationSec: 100 }
    ];
    const push = () => window.__emit('state', { snap: { state: 'IDLE', nowPlaying: null, positionMs: 0, durationMs: 0, karaoke: false, netWait: false, dlVer: 0, queue: [] }, info: { ip: '1.1.1.1', port: 8080, qr: null, host: '', remoteConnected: false, who: null, net: { text: 'Wi-Fi', icon: 'wifi' }, cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO' } }, ui: {} });
    window.__fallback = false;
    window.ytp = {
      on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; }, send: () => {},
      call: async (m, a) => {
        window.__calls.push([m, a]);
        if (m === 'initial') return { cats: [], favs: [], search: { version: 1, query: 'x', source: 'tv', channel: '', results: res, hasMore: false, page: 0, loading: false, error: null } };
        if (m === 'dlIds') return [];
        if (m === 'bannerInit') return { list: [], cur: null, colors: ['#ffffff'] };
        if (m === 'sfxList') return [];
        if (m === 'addHit') return 1;
        if (m === 'openChannel') return { ok: true, fallback: window.__fallback };
        return null;
      }
    };
    setTimeout(push, 50); setTimeout(push, 250); setTimeout(push, 600);
  });
  await p.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html')); await p.waitForTimeout(900);
  const calls = () => p.evaluate(() => window.__calls.filter(c => !['initial', 'dlIds', 'bannerInit', 'sfxList', 'tvLoadMore'].includes(c[0])));
  const reset = () => p.evaluate(() => { window.__calls.length = 0; });
  const menu = p.locator('.dlg.cmenu');
  const labels = () => p.locator('.dlg.cmenu .dlist button').allTextContents();
  const cardA = p.locator('.cardv[data-vid="vidAAAAAAA1"]'), cardB = p.locator('.cardv[data-vid="vidBBBBBBB2"]');
  const EXPECT = ['Thêm vào Yêu thích', 'Xem bài của kênh này', 'Phát ngay', 'Thêm vào hàng đợi', 'Mở trang kênh trên YouTube'];
  const pick = async t => { await p.locator('.dlg.cmenu .dlist button', { hasText: t }).click(); await p.waitForTimeout(150); };

  // 1) chuột phải mở menu đủ 5 mục đúng thứ tự, chưa làm gì cả
  await reset();
  await cardA.click({ button: 'right' }); await p.waitForTimeout(200);
  assert.equal(await menu.count(), 1, 'chuột phải mở menu');
  assert.deepStrictEqual(await labels(), EXPECT);
  assert.ok((await menu.textContent()).includes('Bài của Kênh Một') && (await menu.textContent()).includes('Kênh Một'));
  assert.deepStrictEqual(await calls(), [], 'mở menu chưa gọi lệnh nào (không tự thả tim như trước)');
  await p.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/card-menu.png' });
  // 2) Esc đóng, không làm gì
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  assert.equal(await menu.count(), 0); assert.deepStrictEqual(await calls(), []);
  // 3) bấm vào thẻ vẫn là thêm hàng đợi như cũ
  await cardA.click(); await p.waitForTimeout(150);
  assert.deepStrictEqual((await calls()).map(c => c[0]), ['addHit'], 'bấm trái vào thẻ vẫn thêm vào hàng đợi');
  // 4) Thêm vào Yêu thích
  await reset(); await cardA.click({ button: 'right' }); await pick('Thêm vào Yêu thích');
  let cs = await calls(); assert.equal(cs.length, 1); assert.equal(cs[0][0], 'favAdd'); assert.equal(cs[0][1][0].videoId, 'vidAAAAAAA1');
  assert.equal(await menu.count(), 0, 'chọn xong menu tự đóng');
  // đã là Yêu thích: đổi thành Xoá khỏi Yêu thích
  await p.evaluate(() => window.__emit('favs', [{ videoId: 'vidAAAAAAA1', title: 'Bài của Kênh Một', channel: 'Kênh Một', durationSec: 100 }])); await p.waitForTimeout(100);
  await reset(); await cardA.click({ button: 'right' }); await p.waitForTimeout(150);
  assert.equal((await labels())[0], 'Xoá khỏi Yêu thích');
  await pick('Xoá khỏi Yêu thích');
  assert.deepStrictEqual(await calls(), [['favRemove', ['vidAAAAAAA1']]]);
  await p.evaluate(() => window.__emit('favs', []));
  // 5) Phát ngay / Thêm vào hàng đợi
  await reset(); await cardA.click({ button: 'right' }); await pick('Phát ngay');
  cs = await calls(); assert.equal(cs[0][0], 'playHitNow'); assert.equal(cs[0][1][0].videoId, 'vidAAAAAAA1');
  await reset(); await cardA.click({ button: 'right' }); await pick('Thêm vào hàng đợi');
  cs = await calls(); assert.equal(cs[0][0], 'addHit'); assert.equal(cs[0][1][1], false, 'không chen lên đầu');
  // 6) Xem bài của kênh này -> tìm theo kênh, ô tìm hiện tên kênh
  await reset(); await cardA.click({ button: 'right' }); await pick('Xem bài của kênh này');
  assert.deepStrictEqual(await calls(), [['tvSearchChannel', ['Kênh Một']]]);
  assert.equal(await p.inputValue('#q'), 'Kênh Một');
  // trạng thái "đang xem kênh" (do tiến trình chính gửi về)
  const S = (o) => p.evaluate(s => window.__emit('search', Object.assign({ version: 9, query: 'Kênh Một', source: 'tv', channel: 'Kênh Một', results: [], hasMore: false, page: 0, loading: false, error: null }, s)), o);
  await S({ loading: true }); await p.waitForTimeout(100);
  assert.equal(await p.textContent('#status'), 'Đang tìm bài của kênh “Kênh Một”…');
  await S({ results: [{ videoId: 'vidAAAAAAA1', title: 'T1', channel: 'Kênh Một', durationSec: 100 }, { videoId: 'vidCCCCCCC3', title: 'T3', channel: 'Kênh Một', durationSec: 100 }] }); await p.waitForTimeout(100);
  assert.equal(await p.textContent('#status'), 'Bài của kênh “Kênh Một” · 2 bài');
  assert.equal(await p.locator('.cardv').count(), 2);
  await S({ results: [] }); await p.waitForTimeout(100);
  assert.equal(await p.textContent('#status'), 'Không thấy bài nào của kênh “Kênh Một”');
  await S({ channel: '', query: 'abc', results: [{ videoId: 'vidAAAAAAA1', title: 'T1', channel: 'K', durationSec: 100 }] }); await p.waitForTimeout(100);
  assert.ok((await p.textContent('#status')).startsWith('Kết quả cho “abc”'), 'tìm bình thường thì trở lại nhãn cũ');
  // 7) Mở trang kênh trên YouTube (+ thông báo khi phải dùng trang tìm kênh dự phòng)
  await S({ channel: '', query: 'x', results: [{ videoId: 'vidAAAAAAA1', title: 'Bài của Kênh Một', channel: 'Kênh Một', durationSec: 100 }, { videoId: 'vidBBBBBBB2', title: 'Bài không rõ kênh', channel: '', durationSec: 100 }] }); await p.waitForTimeout(100);
  await reset(); await cardA.click({ button: 'right' }); await pick('Mở trang kênh trên YouTube');
  cs = await calls(); assert.equal(cs[0][0], 'openChannel'); assert.equal(cs[0][1][0].videoId, 'vidAAAAAAA1');
  await p.evaluate(() => { window.__fallback = true; });
  await cardA.click({ button: 'right' }); await pick('Mở trang kênh trên YouTube'); await p.waitForTimeout(100);
  assert.ok((await p.textContent('#toast')).includes('trang tìm kênh'), 'báo khi dùng link dự phòng');
  // 8) bài không có tên kênh: không có "Xem bài của kênh này"
  await cardB.click({ button: 'right' }); await p.waitForTimeout(150);
  assert.deepStrictEqual(await labels(), EXPECT.filter(x => x !== 'Xem bài của kênh này'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  // 9) bàn phím/điều khiển từ xa: giữ Enter ≥ 0,6 giây mở menu, không bấm nhầm mục nào; lên/xuống đổi mục; Enter ở "ĐÓNG" thì đóng
  await cardA.focus(); await reset();
  await p.keyboard.down('Enter'); await p.waitForTimeout(700);
  await p.keyboard.down('Enter'); await p.waitForTimeout(100); await p.keyboard.down('Enter'); await p.waitForTimeout(100); await p.keyboard.down('Enter'); await p.waitForTimeout(100);
  await p.keyboard.up('Enter'); await p.waitForTimeout(200);
  assert.equal(await menu.count(), 1, 'giữ Enter mở menu');
  assert.deepStrictEqual(await calls(), [], 'giữ Enter không được bấm lặp vào mục đầu của menu');
  const focused = () => p.evaluate(() => document.activeElement && document.activeElement.textContent);
  assert.equal(await focused(), 'Thêm vào Yêu thích', 'mục đầu được chọn sẵn');
  await p.keyboard.press('ArrowDown'); assert.equal(await focused(), 'Xem bài của kênh này');
  await p.keyboard.press('ArrowUp'); assert.equal(await focused(), 'Thêm vào Yêu thích');
  await p.keyboard.press('ArrowUp'); assert.equal(await focused(), 'Thêm vào Yêu thích', 'không vượt quá mục đầu');
  for (let i = 0; i < 8; i++) await p.keyboard.press('ArrowDown');
  assert.equal(await focused(), 'ĐÓNG', 'xuống hết thì dừng ở ĐÓNG');
  await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  assert.equal(await menu.count(), 0); assert.deepStrictEqual(await calls(), []);
  // 10) chọn mục bằng Enter trên bàn phím
  await cardA.focus(); await p.keyboard.down('Enter'); await p.waitForTimeout(700); await p.keyboard.down('Enter'); await p.keyboard.up('Enter'); await p.waitForTimeout(200);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  cs = await calls(); assert.equal(cs.length, 1); assert.equal(cs[0][0], 'playHitNow', 'Lên/xuống + Enter chọn đúng mục "Phát ngay"');
  console.log('lỗi JS máy tính:', errs.length ? errs.join('\n') : 'không');
  await b.close(); assert.equal(errs.length, 0);
  console.log('Menu thẻ bài hát: đạt'); process.exit(0);
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
