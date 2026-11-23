'use strict';
// Mở dashboard.html trong Chromium với main-process giả: cửa sổ Kịch Bản (bước 3 của GĐ9).
// Tạo bộ trống / từ mẫu, nhân bản, đổi tên, biểu tượng, thêm ô trống, đổi kiểu phát, sắp xếp (nút + kéo thả cả bộ lẫn lá),
// xoá 2 bước, lá bị mất file, giới hạn số lượng, chặn thả file, Esc đóng.
// Bước 4: bảng chọn nguồn (hiệu ứng / nhạc trong máy / Yêu thích / chữ), thêm nhiều lá, gán ô trống, lưu hàng đợi thành bộ.
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const SHOT = process.env.SHOT_DIR || '/tmp';

const MOCK = () => {
  const handlers = {}; const calls = [];
  window.__calls = calls;
  const emit = (ch, d) => (handlers[ch] || []).forEach(h => h(d));
  let n = 0;
  const DEF = { sfx: '🔊', local: '🎵', yt: '📺', banner: '💬', empty: '➕' };
  const card = (type, label, extra) => ({ id: 'cX' + (++n) + 'abcd', type, label, icon: DEF[type], missing: false, ...(extra || {}) });
  let decks = [
    { id: 'dAAAA1', name: 'Đám cưới 20/12', icon: '💒', cards: [
      card('empty', 'Đón khách'), card('banner', 'Chào mừng', { banner: { text: 'Chúc mừng', color: '#fff', size: 4 } }),
      card('local', 'Nhạc vào', { file: 'C:\\nhac\\vao.mp3', mode: 'now' }), card('yt', 'Mời rượu', { videoId: 'abcdefghijk', title: 'Bài', mode: 'queue' }),
      card('sfx', 'Vỗ tay', { sfxId: 'sAAAA1', missing: true }) ] },
    { id: 'dBBBB2', name: 'Sinh nhật', icon: '🎂', cards: [card('empty', 'Thổi nến')] },
    { id: 'dCCCC3', name: 'Thôi nôi', icon: '👶', cards: [] }
  ];
  const view = () => decks.map(d => ({ id: d.id, name: d.name, icon: d.icon, cards: d.cards.map(c => ({ ...c })), missingCount: d.cards.filter(c => c.missing).length }));
  const push = () => emit('decks-list', view());
  const find = id => decks.find(d => d.id === id);
  window.__decks = () => view();
  window.__setMax = (nd, nc) => { window.__maxD = nd; window.__maxC = nc; };
  const TPL = [{ key: 'wedding', name: 'Đám cưới', icon: '💒', count: 9 }, { key: 'birthday', name: 'Sinh nhật', icon: '🎂', count: 7 }, { key: 'thoinoi', name: 'Thôi nôi', icon: '👶', count: 5 }];
  const snap = () => ({ state: 'IDLE', nowPlaying: null, positionMs: 0, durationMs: 0, karaoke: false, netWait: false, queue: [] });
  const state = () => emit('state', { snap: snap(), info: { ip: '192.168.1.5', port: 8080, qr: null, host: '', remoteConnected: true, who: null, net: { text: 'Wi-Fi', icon: 'wifi' }, cfg: { gridCols: 3, fullscreenSec: 0, qrHidden: false, maxHeight: 720, backend: 'AUTO' } }, ui: {} });
  window.ytp = {
    on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; },
    send: () => {},
    pathFor: f => f.name ? 'C:\\drop\\' + f.name : '',
    call: async (m, a) => {
      calls.push([m, a]);
      if (m === 'initial') return { cats: [], favs: [{ videoId: 'abcdefghijk', title: 'Bài yêu thích', channel: 'Kênh A', durationSec: 200 }, { videoId: 'zyxwvutsrqp', title: 'Happy Birthday', channel: 'Kênh B', durationSec: 90 }], search: { version: 0, query: '', source: '', results: [], hasMore: false, page: 0, loading: false, error: null } };
      if (m === 'bannerInit') return { list: [{ text: 'Chúc mừng sinh nhật!', color: '#ff80ab', size: 4 }, { text: 'Chúc mừng đám cưới\nA & B', color: '#ffd54f', size: 4 }], cur: null, colors: [] };
      if (m === 'localList') { const base = [{ path: 'C:\\nhac\\cuoi_1.mp3', name: 'Nhạc cưới 1', dir: 'nhac', kind: 'audio' }, { path: 'C:\\nhac\\karaoke.mp4', name: 'Karaoke xa', dir: 'nhac', kind: 'video' }, { path: 'C:\\nhac\\hat_mung.mp3', name: 'Hát mừng', dir: 'nhac', kind: 'audio' }]; return { folders: [], items: window.__bigLocal ? Array.from({ length: 250 }, (_, i) => ({ path: 'C:\\big\\b' + i + '.mp3', name: 'Bài ' + i, dir: 'big', kind: 'audio' })) : base }; }
      if (m === 'deckAddCards') { const d = find(a[0]); if (!d) return { added: [], skipped: 0, full: 0, reason: 'NO_DECK' }; const added = []; let skipped = 0, full = 0; for (const x of a[1]) { if (!x || !x.type) { skipped++; continue; } if (d.cards.length >= (window.__maxC || 60)) { full++; continue; } const c = card(x.type, x.label || 'Lá', { ...x, icon: x.icon || DEF[x.type] }); d.cards.push(c); added.push({ ...c }); } push(); return { added, skipped, full, reason: null }; }
      if (m === 'cardAssign') { const d = find(a[0]); const c = d && d.cards.find(x => x.id === a[1]); if (!c || !a[2] || !a[2].type) return null; const keep = { id: c.id, label: c.label, icon: DEF[a[2].type] }; Object.keys(c).forEach(k => delete c[k]); Object.assign(c, a[2], keep, { missing: false }); push(); return { ...c }; }
      if (m === 'deckFromQueue') { if (window.__queueEmpty) return { deck: null, reason: 'EMPTY', added: 0, dup: 0, skipped: 0, truncated: 0 }; const d = { id: 'dQUE' + (++n) + 'xxx', name: a[0], icon: '🎬', cards: [card('yt', 'Bài một', { mode: 'queue', videoId: 'abcdefghijk' }), card('local', 'Nhạc vào', { mode: 'queue', file: 'C:\\nhac\\vao.mp3' }), card('yt', 'Bài ba', { mode: 'queue', videoId: 'zyxwvutsrqp' })] }; decks.push(d); push(); return { deck: view().find(x => x.id === d.id), reason: null, added: 3, dup: 1, skipped: 0, truncated: 0 }; }
      if (m === 'sfxList') return [{ id: 'sAAAA1', name: 'Vỗ tay', icon: '👏', file: 'C:\\sfx\\vt.mp3', vol: 100 }, { id: 'sBBBB2', name: 'Reo hò', icon: '🎉', file: 'C:\\sfx\\rh.mp3', vol: 100 }, { id: 'sCCCC3', name: 'Mời cô dâu', icon: '🔊', file: 'C:\\sfx\\moi.mp3', vol: 100, missing: true }];
      if (m === 'decksList') return view();
      if (m === 'decksTemplates') return TPL;
      if (m === 'deckQueueAll') return { ok: true, msg: 'Đã nạp 2 bài vào hàng đợi · 1 ô trống' };
      if (m === 'deckCreate') { if (decks.length >= (window.__maxD || 30)) return { deck: null, reason: 'FULL' }; const d = { id: 'dNEW' + (++n) + 'xxx', name: String(a[0] || 'Bộ bài'), icon: '🎬', cards: [] }; decks.push(d); push(); return { deck: { ...d, cards: [], missingCount: 0 }, reason: null }; }
      if (m === 'deckFromTemplate') { if (decks.length >= (window.__maxD || 30)) return { deck: null, reason: 'FULL' }; const t = TPL.find(x => x.key === a[0]); const d = { id: 'dTPL' + (++n) + 'xxx', name: t.name, icon: t.icon, cards: Array.from({ length: t.count }, (_, i) => card('empty', 'Ô ' + (i + 1))) }; decks.push(d); push(); return { deck: view().find(x => x.id === d.id), reason: null }; }
      if (m === 'deckDuplicate') { const s = find(a[0]); if (!s || decks.length >= (window.__maxD || 30)) return { deck: null, reason: s ? 'FULL' : 'NO_DECK' }; const d = { ...s, id: 'dDUP' + (++n) + 'xxx', name: s.name + ' (bản sao)', cards: s.cards.map(c => ({ ...c, id: 'cDUP' + (++n) + 'xx' })) }; decks.splice(decks.indexOf(s) + 1, 0, d); push(); return { deck: view().find(x => x.id === d.id), reason: null }; }
      if (m === 'deckUpdate') { const d = find(a[0]); if (!d) return null; const p = a[1]; if (p.name !== undefined) d.name = String(p.name).trim() || d.name; if (p.icon !== undefined) d.icon = String(p.icon).trim() || '🎬'; push(); return view().find(x => x.id === d.id); }
      if (m === 'deckRemove') { const k = decks.length; decks = decks.filter(x => x.id !== a[0]); push(); return decks.length < k; }
      if (m === 'deckMove') { const i = decks.findIndex(x => x.id === a[0]); if (i < 0) return false; const [d] = decks.splice(i, 1); decks.splice(a[1], 0, d); push(); return true; }
      if (m === 'cardAdd') { const d = find(a[0]); if (!d) return { card: null, reason: 'NO_DECK' }; if (d.cards.length >= (window.__maxC || 60)) return { card: null, reason: 'FULL' }; const c = card('empty', String(a[1].label || 'Ô trống')); d.cards.push(c); push(); return { card: { ...c }, reason: null }; }
      if (m === 'cardUpdate') { const d = find(a[0]); const c = d && d.cards.find(x => x.id === a[1]); if (!c) return null; const p = a[2]; if (p.label !== undefined) c.label = String(p.label).trim() || c.label; if (p.icon !== undefined) c.icon = String(p.icon).trim() || DEF[c.type]; if (p.mode !== undefined && (c.type === 'local' || c.type === 'yt')) c.mode = p.mode; push(); return { ...c }; }
      if (m === 'cardRemove') { const d = find(a[0]); if (!d) return false; const k = d.cards.length; d.cards = d.cards.filter(x => x.id !== a[1]); push(); return d.cards.length < k; }
      if (m === 'cardMove') { const d = find(a[0]); const i = d ? d.cards.findIndex(x => x.id === a[1]) : -1; if (i < 0) return false; const [c] = d.cards.splice(i, 1); d.cards.splice(a[2], 0, c); push(); return true; }
      if (m === 'localDrop') return { added: 1, played: false, dup: 0, full: false, bad: 0, found: 1, folders: 0, singles: 1 };
      if (m === 'getSettings') return { sfxDuck: false, duckLevel: 20, backend: 'AUTO', maxHeight: 720, gridCols: 3, fullscreenSec: 0, tvOutput: 'AUTO', fadeInSec: 2, fadeOutSec: 4, seedAutoplay: false, qrHidden: false, tickerMode: 'x' };
      return null;
    }
  };
  setTimeout(state, 50); setTimeout(state, 250);
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(MOCK);
  await page.goto('file://' + path.join(__dirname, '..', 'renderer', 'dashboard.html'));
  await page.waitForTimeout(700);
  const called = m => page.evaluate(m => window.__calls.filter(c => c[0] === m), m);
  const decksNow = () => page.evaluate(() => window.__decks());
  const deckNames = () => page.$$eval('.krow .kname', els => els.map(e => e.textContent));
  const cardNames = () => page.$$eval('.kcrow .sname', els => els.map(e => e.value));
  const stat = () => page.textContent('.kdlg .bstat');
  const wait = ms => page.waitForTimeout(ms || 150);

  // ---- mở cửa sổ
  assert.equal(await page.locator('#deckBtn').count(), 1, 'có nút Kịch Bản ở cột trái');
  const bs = await page.evaluate(() => { const a = document.getElementById('sfxBtn').getBoundingClientRect(), b = document.getElementById('deckBtn').getBoundingClientRect(); return { sfxBottom: a.bottom, deckTop: b.top, deckBottom: b.bottom, h: innerHeight }; });
  assert.ok(bs.deckTop >= bs.sfxBottom, 'nút Kịch Bản nằm dưới Hiệu Ứng Riêng');
  assert.ok(bs.deckBottom < bs.h, 'nút Kịch Bản không tràn khỏi màn hình');
  await page.click('#deckBtn'); await wait(400);
  assert.equal(await page.locator('.kdlg').count(), 1);
  assert.deepEqual(await deckNames(), ['Đám cưới 20/12', 'Sinh nhật', 'Thôi nôi']);
  assert.ok((await stat()).includes('3 / 30 bộ bài') && (await stat()).includes('5 / 60 lá'), 'đếm bộ và lá: ' + await stat());
  assert.ok((await stat()).includes('1 lá bị mất'), 'báo lá mất');
  assert.deepEqual(await cardNames(), ['Đón khách', 'Chào mừng', 'Nhạc vào', 'Mời rượu', 'Vỗ tay'], 'chọn sẵn bộ đầu tiên');
  assert.equal(await page.locator('.kcrow.miss').count(), 1);
  assert.equal(await page.textContent('.kcrow.miss .kkind'), 'Bị mất');
  assert.deepEqual(await page.$$eval('.kcrow .kkind', els => els.map(e => e.textContent)), ['Gán nội dung…', 'Chữ chào mừng', 'Nhạc trong máy', 'YouTube', 'Bị mất']);
  assert.equal(await page.locator('.kcrow button.kkind.none').count(), 1, 'ô trống nổi bật để gán');
  assert.equal(await page.locator('.kcrow button.kmode').count(), 2, 'chỉ nhạc trong máy và YouTube có nút kiểu phát');
  assert.deepEqual(await page.$$eval('.kcrow button.kmode', els => els.map(e => e.textContent)), ['Phát ngay', 'Vào hàng đợi']);
  assert.ok(await page.locator('.krow:first-child [data-k="up"]').isDisabled(), 'bộ đầu không có ▲');
  assert.equal(await page.textContent('.krow.sel .kcnt'), '5');
  assert.equal(await page.locator('.krow .kcnt.bad').count(), 1, 'bộ có lá mất hiện số màu đỏ');
  await page.screenshot({ path: SHOT + '/deck-dlg.png' });

  // ---- chọn bộ khác
  await page.click('.krow[data-id="dBBBB2"] .kname'); await wait();
  assert.deepEqual(await cardNames(), ['Thổi nến']);
  await page.click('.krow[data-id="dCCCC3"] .kname'); await wait();
  assert.ok((await page.textContent('.kright .empty')).includes('chưa có lá bài nào'), 'bộ trống có hướng dẫn');
  await page.click('.krow[data-id="dAAAA1"] .kname'); await wait();

  // ---- đổi tên bộ, biểu tượng bộ
  await page.fill('input[data-k="dname"]', 'Cưới An & Bình'); await page.press('input[data-k="dname"]', 'Enter'); await wait();
  assert.deepEqual((await called('deckUpdate')).pop(), ['deckUpdate', ['dAAAA1', { name: 'Cưới An & Bình' }]]);
  assert.equal((await deckNames())[0], 'Cưới An & Bình');
  await page.click('button[data-k="dicon"]'); await wait();
  assert.equal(await page.locator('.kright .spick').count(), 1, 'mở bảng chọn biểu tượng bộ');
  await page.click('.kright .spick button:nth-child(5)'); await wait();   // 🎉
  assert.equal((await decksNow())[0].icon, '🎉');
  assert.equal(await page.locator('.kright .spick').count(), 0, 'chọn xong thì đóng bảng');
  await page.click('button[data-k="dicon"]'); await page.click('.kright .spick .kdef'); await wait();
  assert.equal((await decksNow())[0].icon, '🎬', 'Mặc định trả về biểu tượng gốc');

  // ---- đổi tên lá, biểu tượng lá
  await page.fill('.kcrow:nth-child(1) input[data-k="name"]', 'Đón khách VIP'); await page.press('.kcrow:nth-child(1) input[data-k="name"]', 'Enter'); await wait();
  assert.equal((await decksNow())[0].cards[0].label, 'Đón khách VIP');
  await page.click('.kcrow:nth-child(1) [data-k="icon"]'); await wait();
  await page.click('.kcrow:nth-child(1) + .spick button:nth-child(1)'); await wait();
  assert.equal((await decksNow())[0].cards[0].icon, '👏');
  await page.fill('.kcrow:nth-child(1) input[data-k="name"]', '   '); await page.press('.kcrow:nth-child(1) input[data-k="name"]', 'Enter'); await wait();
  assert.equal(await page.inputValue('.kcrow:nth-child(1) input[data-k="name"]'), 'Đón khách VIP', 'tên rỗng thì giữ tên cũ');

  // ---- kiểu phát
  await page.click('.kcrow:nth-child(3) button.kmode'); await wait();
  assert.equal((await decksNow())[0].cards[2].mode, 'queue');
  assert.deepEqual(await page.$$eval('.kcrow button.kmode', els => els.map(e => e.textContent)), ['Vào hàng đợi', 'Vào hàng đợi']);

  // ---- sắp xếp lá bằng nút
  await page.click('.kcrow:nth-child(2) [data-k="down"]'); await wait();
  assert.deepEqual(await cardNames(), ['Đón khách VIP', 'Nhạc vào', 'Chào mừng', 'Mời rượu', 'Vỗ tay']);
  await page.click('.kcrow:nth-child(5) [data-k="up"]'); await wait();
  assert.deepEqual(await cardNames(), ['Đón khách VIP', 'Nhạc vào', 'Chào mừng', 'Vỗ tay', 'Mời rượu']);
  assert.deepEqual((await decksNow())[0].cards.map(c => c.label), await cardNames(), 'tiến trình chính khớp màn hình');
  assert.deepEqual(await page.$$eval('.kcrow .snum', els => els.map(e => e.textContent)), ['1', '2', '3', '4', '5']);

  // ---- kéo thả
  const drag = async (sel, from, to, below) => {
    await page.evaluate(({ sel, from, to, below }) => {
      const rows = [...document.querySelectorAll(sel)];
      const a = rows[from], b = rows[to];
      const dt = new DataTransfer();
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const rc = b.getBoundingClientRect(), y = below ? rc.bottom - 2 : rc.top + 2;
      b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
      b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
      a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, { sel, from, to, below });
    await wait(200);
  };
  await drag('.kcrow', 0, 2, true);    // [VIP, Nhạc vào, Chào mừng, Vỗ tay, Mời rượu] -> [Nhạc vào, Chào mừng, VIP, Vỗ tay, Mời rượu]
  assert.deepEqual(await cardNames(), ['Nhạc vào', 'Chào mừng', 'Đón khách VIP', 'Vỗ tay', 'Mời rượu']);
  await drag('.kcrow', 4, 0, false);   // kéo lá cuối lên đầu
  assert.deepEqual(await cardNames(), ['Mời rượu', 'Nhạc vào', 'Chào mừng', 'Đón khách VIP', 'Vỗ tay']);
  await drag('.kcrow', 1, 1, true);    // thả lên chính nó: không đổi
  assert.deepEqual(await cardNames(), ['Mời rượu', 'Nhạc vào', 'Chào mừng', 'Đón khách VIP', 'Vỗ tay']);
  assert.deepEqual((await decksNow())[0].cards.map(c => c.label), await cardNames());
  await drag('.krow', 0, 2, true);     // bộ bài: kéo bộ đầu xuống cuối
  assert.deepEqual(await deckNames(), ['Sinh nhật', 'Thôi nôi', 'Cưới An & Bình']);
  assert.deepEqual((await decksNow()).map(d => d.name), await deckNames());
  // kéo lá bài thả lên hàng bộ bài (khác loại) thì bị bỏ qua
  const before = JSON.stringify(await decksNow());
  await page.evaluate(() => {
    const a = document.querySelector('.kcrow'), b = document.querySelector('.krow');
    const dt = new DataTransfer();
    a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: b.getBoundingClientRect().top + 2 }));
    b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: b.getBoundingClientRect().top + 2 }));
    a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  });
  await wait(200);
  assert.equal(JSON.stringify(await decksNow()), before, 'kéo lá bài vào danh sách bộ bài không làm gì');
  await page.click('.krow:nth-child(3) .kname'); await wait();   // chọn lại "Cưới An & Bình"
  assert.equal(await page.inputValue('input[data-k="dname"]'), 'Cưới An & Bình');

  // ---- thêm ô trống, xoá lá 2 bước
  await page.click('button[data-k="cadd"]'); await wait(300);
  assert.equal((await cardNames()).pop(), 'Ô mới');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.value), 'Ô mới', 'ô mới được chọn sẵn để gõ tên');
  await page.keyboard.type('Cắt bánh'); await page.keyboard.press('Enter'); await wait();
  assert.equal((await cardNames()).pop(), 'Cắt bánh');
  const lastDel = '.kcrow:last-of-type [data-k="del"]';
  await page.click(lastDel); await wait();
  assert.equal(await page.textContent(lastDel), 'Xoá?', 'bấm lần đầu: hỏi lại');
  assert.equal((await called('cardRemove')).length, 0, 'chưa xoá thật');
  await page.waitForTimeout(3300);
  assert.equal(await page.textContent(lastDel), '✕', 'quá 3 giây tự huỷ xác nhận');
  await page.click(lastDel); await page.click(lastDel); await wait();
  assert.equal((await cardNames()).includes('Cắt bánh'), false, 'bấm hai lần thì xoá');
  assert.ok((await stat()).includes('Đã xoá lá'));

  // ---- bộ mới, từ mẫu, nhân bản
  await page.click('[data-r="new"]'); await wait(300);
  assert.equal((await deckNames()).pop(), 'Bộ bài mới');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.value), 'Bộ bài mới', 'bộ mới được chọn sẵn để gõ tên');
  await page.keyboard.type('Tân gia'); await page.keyboard.press('Enter'); await wait();
  assert.equal((await deckNames()).pop(), 'Tân gia');
  await page.click('[data-r="tpl"]'); await wait();
  assert.equal(await page.locator('.ktplb').count(), 3, 'có 3 mẫu');
  await page.click('[data-k="tpl-wedding"]'); await wait(300);
  assert.equal((await deckNames()).pop(), 'Đám cưới');
  assert.equal((await cardNames()).length, 9, 'bộ từ mẫu có đủ ô');
  assert.ok((await stat()).includes('chỉ việc gán nhạc'));
  assert.equal(await page.locator('.ktplb').count(), 0, 'tạo xong thì gập bảng mẫu');
  await page.click('button[data-k="ddup"]'); await wait(300);
  assert.deepEqual((await deckNames()).slice(-2), ['Đám cưới', 'Đám cưới (bản sao)']);
  assert.equal((await cardNames()).length, 9);

  // ---- xoá bộ 2 bước
  await page.click('button[data-k="ddel"]'); await wait();
  assert.equal(await page.textContent('button[data-k="ddel"]'), 'Xoá bộ?');
  assert.equal((await called('deckRemove')).length, 0);
  await page.click('button[data-k="ddel"]'); await wait(300);
  assert.equal((await deckNames()).includes('Đám cưới (bản sao)'), false);
  assert.ok((await stat()).includes('Đã xoá bộ'));
  assert.ok((await cardNames()).length > 0 || (await page.locator('.kright .empty').count()) === 1, 'sau khi xoá vẫn chọn bộ kế bên');


  // ================================================================ BƯỚC 4: bảng chọn nguồn
  await page.click('.krow[data-id="dBBBB2"] .kname'); await wait();   // Sinh nhật: chỉ có ô trống "Thổi nến"
  await page.click('button[data-k="cpick"]'); await wait(300);
  assert.equal(await page.locator('.kpickl').count(), 1, 'mở bảng chọn');
  assert.ok((await page.textContent('.kptitle')).includes('Thêm lá bài vào bộ'));
  assert.deepEqual(await page.$$eval('.ktab', els => els.map(e => e.textContent)), ['Hiệu ứng', 'Nhạc trong máy', 'Yêu thích', 'Chữ chào mừng']);
  assert.equal(await page.locator('.kprow').count(), 3, 'tab hiệu ứng: 3 dòng');
  assert.ok(await page.locator('.kprow.miss input').isDisabled(), 'hiệu ứng mất file không chọn được');
  assert.ok(await page.locator('[data-k="pgo"]').isDisabled(), 'chưa chọn gì thì nút Thêm bị khoá');
  await page.screenshot({ path: SHOT + '/deck-pick.png' });
  await page.click('.kprow:nth-child(1)'); await wait(100);
  assert.equal(await page.textContent('[data-k="pgo"]'), 'Thêm 1 lá');
  await page.click('.kprow.miss'); await wait(100);
  assert.equal(await page.textContent('[data-k="pgo"]'), 'Thêm 1 lá', 'bấm vào dòng bị mất không chọn');
  await page.click('[data-k="tab-local"]'); await wait(300);
  assert.equal(await page.locator('.kprow').count(), 3);
  assert.ok((await page.textContent('.kprow:nth-child(2) .lsb')).includes('Video'), 'phân biệt video');
  await page.fill('[data-k="pfilter"]', 'cưới'); await wait(100);
  assert.equal(await page.locator('.kprow').count(), 1, 'lọc theo tên');
  await page.click('.kprow'); await wait(100);
  assert.equal(await page.textContent('[data-k="pgo"]'), 'Thêm 2 lá', 'chọn nhiều thẻ, đếm chung');
  await page.click('[data-k="tab-fav"]'); await wait(200);
  assert.equal(await page.locator('.kprow').count(), 2);
  assert.equal(await page.locator('.kprow.on').count(), 0);
  await page.click('.kprow:nth-child(2)'); await wait(100);
  await page.click('[data-k="tab-banner"]'); await wait(300);
  assert.equal(await page.locator('.kprow').count(), 2);
  assert.ok((await page.textContent('.kprow:nth-child(2) .lsb')).includes('A & B'), 'chữ nhiều dòng hiện gọn');
  await page.click('.kprow:nth-child(2)'); await wait(100);
  await page.click('[data-k="tab-sfx"]'); await wait(100);
  assert.equal(await page.locator('.kprow.on').count(), 1, 'quay lại thẻ cũ vẫn thấy mục đã chọn');
  assert.equal(await page.textContent('[data-k="pgo"]'), 'Thêm 4 lá');
  await page.click('[data-k="pgo"]'); await wait(300);
  const add4 = (await called('deckAddCards')).pop();
  assert.deepEqual(add4[1][1].map(x => x.type), ['sfx', 'local', 'yt', 'banner'], 'thứ tự chọn được giữ');
  assert.equal(add4[1][1][0].icon, '👏'); assert.equal(add4[1][1][1].file, 'C:\\nhac\\cuoi_1.mp3'); assert.equal(add4[1][1][2].videoId, 'zyxwvutsrqp'); assert.equal(add4[1][1][3].banner.text, 'Chúc mừng đám cưới\nA & B');
  assert.equal(await page.locator('.kpickl').count(), 0, 'thêm xong thì quay về danh sách lá');
  assert.deepEqual(await cardNames(), ['Thổi nến', 'Vỗ tay', 'Nhạc cưới 1', 'Happy Birthday', 'Chúc mừng đám cưới']);
  assert.ok((await stat()).includes('Đã thêm 4 lá bài'), await stat());

  // gán nội dung cho ô trống: giữ tên ô, chỉ chọn được một mục
  await page.click('.kcrow:nth-child(1) button.kkind'); await wait(300);
  assert.ok((await page.textContent('.kptitle')).includes('Gán nội dung cho ô "Thổi nến"'));
  await page.click('[data-k="tab-local"]'); await wait(300);
  await page.click('.kprow:nth-child(1)'); await page.click('.kprow:nth-child(3)'); await wait(100);
  assert.equal(await page.locator('.kprow.on').count(), 1, 'gán thì chỉ chọn một mục');
  assert.equal(await page.textContent('[data-k="pgo"]'), 'Gán');
  await page.click('[data-k="pgo"]'); await wait(300);
  const asg = (await called('cardAssign')).pop();
  assert.equal(asg[1][0], 'dBBBB2'); assert.equal(asg[1][2].type, 'local'); assert.equal(asg[1][2].file, 'C:\\nhac\\hat_mung.mp3');
  assert.equal((await cardNames())[0], 'Thổi nến', 'tên ô được giữ');
  assert.equal(await page.textContent('.kcrow:nth-child(1) .kkind'), 'Nhạc trong máy');
  assert.equal(await page.locator('.kcrow:nth-child(1) button.kmode').count(), 1, 'ô vừa gán nhạc có nút kiểu phát');
  assert.ok((await stat()).includes('Đã gán'), await stat());

  // đổi nội dung của ô đã có; Esc và nút quay lại chỉ thoát bảng chọn, không đóng cửa sổ
  await page.click('.kcrow:nth-child(2) button.kkind'); await wait(300);
  assert.equal(await page.locator('.kpickl').count(), 1);
  await page.keyboard.press('Escape'); await wait(200);
  assert.equal(await page.locator('.kpickl').count(), 0, 'Esc thoát bảng chọn');
  assert.equal(await page.locator('.kdlg').count(), 1, 'không đóng cả cửa sổ');
  await page.click('button[data-k="cpick"]'); await wait(200);
  await page.click('[data-k="pback"]'); await wait(200);
  assert.equal(await page.locator('.kpickl').count(), 0, 'nút Quay lại');
  assert.equal((await called('deckAddCards')).length, 1, 'thoát mà chưa bấm Thêm thì không thêm gì');

  // thư viện lớn: chỉ vẽ 200 dòng đầu, có lọc
  await page.evaluate(() => { window.__bigLocal = true; });
  await page.click('button[data-k="cpick"]'); await wait(200);
  await page.click('[data-k="tab-local"]'); await wait(400);
  assert.equal(await page.locator('.kprow').count(), 200, 'giới hạn số dòng vẽ');
  assert.ok((await page.textContent('.kpickl')).includes('200 / 250'));
  await page.fill('[data-k="pfilter"]', 'Bài 249'); await wait(100);
  assert.equal(await page.locator('.kprow').count(), 1, 'lọc tìm được cả bài nằm ngoài 200 dòng đầu');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(200);
  await page.evaluate(() => { window.__bigLocal = false; });
  if (await page.locator('.kdlg').count() === 0) { await page.click('#deckBtn'); await wait(400); }

  // lưu hàng đợi thành bộ bài
  await page.evaluate(() => { window.__queueEmpty = true; });
  const nBefore = (await decksNow()).length;
  await page.click('[data-r="fromq"]'); await wait(300);
  assert.ok((await stat()).includes('Hàng đợi đang trống'), await stat());
  assert.equal((await decksNow()).length, nBefore, 'hàng đợi trống thì không tạo bộ');
  await page.evaluate(() => { window.__queueEmpty = false; });
  await page.click('[data-r="fromq"]'); await wait(300);
  assert.equal((await decksNow()).length, nBefore + 1);
  assert.ok((await deckNames()).pop().startsWith('Hàng đợi '), 'tên mặc định theo ngày');
  assert.ok((await stat()).includes('Đã lưu 3 bài') && (await stat()).includes('1 bài trùng'), await stat());
  assert.deepEqual(await cardNames(), ['Bài một', 'Nhạc vào', 'Bài ba'], 'tự chọn bộ vừa tạo');
  assert.deepEqual(await page.$$eval('.kcrow button.kmode', els => els.map(e => e.textContent)), ['Vào hàng đợi', 'Vào hàng đợi', 'Vào hàng đợi']);

  // ---- giới hạn
  const nDecks = (await decksNow()).length;
  await page.evaluate(n => window.__setMax(n, 60), nDecks);
  await page.click('[data-r="new"]'); await wait();
  assert.ok((await stat()).includes('Đã đủ 30 bộ bài'), 'báo khi bộ tạo bị từ chối: ' + await stat());
  assert.equal((await decksNow()).length, nDecks, 'không tạo thêm khi đầy');
  await page.evaluate(() => window.__setMax(30, 60));

  // ---- đang mở Kịch Bản: thả file không vào hàng đợi
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.mp3'));
    document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await wait(300);
  assert.equal((await called('localDrop')).length, 0, 'không đưa file vào hàng đợi khi đang mở Kịch Bản');
  assert.equal(await page.isHidden('#dropHint'), true);
  assert.ok((await page.textContent('#toast')).includes('Kịch Bản'));

  // ---- phím tắt toàn cục bị chặn khi mở hộp thoại: bấm số không phát hiệu ứng
  await page.keyboard.press('Escape'); await wait(300);
  assert.equal(await page.locator('.kdlg').count(), 0, 'Esc đóng cửa sổ');
  // mở lại: dữ liệu giữ nguyên, bộ đầu được chọn
  await page.click('#deckBtn'); await wait(400);
  assert.equal(await page.locator('.kdlg').count(), 1);
  assert.equal((await deckNames()).length, (await decksNow()).length);
  // nút "Nạp cả bộ vào hàng đợi": khoá khi bộ không có lá nhạc, bấm thì gọi đúng bộ và hiện kết quả
  const rowsQ = await page.$$eval('.krow', els => els.map(e => e.dataset.id));
  let queued = false;
  for (const id of rowsQ) {
    await page.click('.krow[data-id=\"' + id + '\"] .kname'); await wait(300);
    if (await page.locator('button[data-k=\"cqueue\"]').isDisabled()) continue;
    await page.click('button[data-k=\"cqueue\"]'); await wait(300);
    const cq = await called('deckQueueAll'); assert.deepEqual(cq[cq.length - 1][1], [id]);
    assert.ok((await page.textContent('.bstat')).includes('Đã nạp 2 bài'), 'hiện kết quả nạp');
    queued = true; break;
  }
  assert.ok(queued, 'có ít nhất một bộ có nhạc để nạp');
  await page.click('.dbtns .dbtn'); await wait(300);
  assert.equal(await page.locator('.kdlg').count(), 0, 'nút ĐÓNG');
  // bộ đẩy từ tiến trình chính khi cửa sổ đóng: không lỗi
  
  assert.deepEqual(errors, [], 'không có lỗi JS: ' + errors.join('\n'));
  await browser.close();
  console.log('deck-ui-test: ok');
})().catch(e => { console.error(e); process.exit(1); });
