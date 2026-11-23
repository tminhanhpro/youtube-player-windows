'use strict';
// Kiểm thử phần 7 (bước 4): dịch vụ tải sẵn — cài đặt, phạm vi tải (Yêu thích / hàng đợi / bộ bài / mã), huỷ, xoá dòng, đổi thư mục, sự kiện.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Store, Settings } = require('../main/store');
const { Decks } = require('../main/decks');
const { Favs } = require('../main/data');
const { DownloadService } = require('../main/dlservice');
const FAKE = path.join(__dirname, 'fake-ytdlp.js');
const id = c => c.repeat(11);
const [A, B, C, D, E, SLOW] = 'ABCDEF'.split('').map(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-svc-')), music = path.join(root, 'Nhạc');
  const store = new Store(path.join(root, 'ud')), settings = new Settings(store);
  const decks = new Decks(store, { sfxHas: () => false });
  const beh = { [SLOW]: 'slow' };
  let qItems = [];
  const svc = new DownloadService({
    settings, musicDir: music, stallMs: 2000,
    getFavs: () => Favs.load(store), getDecks: () => decks.list(), getQueueItems: () => qItems,
    tools: () => ({ ytdlp: process.execPath, prefix: [FAKE], deno: null, ffmpeg: null, env: { FAKE_BEHAVIOR: JSON.stringify(beh) } })
  });
  const idle = () => new Promise(r => svc.once('idle', r));
  const ev = { update: 0, removed: [], library: 0 };
  svc.on('update', () => ev.update++); svc.on('removed', i => ev.removed.push(i)); svc.on('library', () => ev.library++);

  // 1) cài đặt: mặc định, đổi kiểu tải, giá trị sai bị bỏ
  assert.equal(svc.dir(), path.join(music, 'Youtube Player'), 'mặc định <Nhạc>\\Youtube Player');
  assert.equal(settings.dlMode, 'video'); assert.equal(svc.setMode('audio'), true); assert.equal(settings.dlMode, 'audio');
  assert.equal(svc.setMode('xyz'), false); assert.equal(settings.dlMode, 'audio'); svc.setMode('video');
  let st = svc.state(); assert.equal(st.dir, svc.dir()); assert.equal(st.custom, false); assert.equal(st.count, 0); assert.equal(st.lite, true, 'chưa có ffmpeg: báo bản nhẹ'); assert.equal(st.ffmpeg, false);

  // 2) phạm vi: Yêu thích / hàng đợi / bộ bài / mã; mã sai và trùng bị loại, bài nhạc trong máy (local) không tính
  Favs.save(store, [{ videoId: A, title: 'Bài A' }, { videoId: B, title: 'Bài B' }, { videoId: 'sai', title: 'x' }]);
  qItems = [{ videoId: B, title: 'Bài B' }, { videoId: C, title: 'Bài C' }, { videoId: 'LOCAL-ITEM', title: 'nhạc máy', local: 'C:\\a.mp3' }, { videoId: C, title: 'trùng' }];
  const dk = decks.create('Tiệc', '🎉').deck;
  decks.addCards(dk.id, [{ type: 'yt', videoId: C, title: 'Bài C' }, { type: 'yt', videoId: D, title: 'Bài D' }, { type: 'yt', videoId: E, title: 'Bài E' }]);
  let sc = svc.scopes();
  assert.deepEqual([sc.favs.done, sc.favs.total], [0, 2]); assert.deepEqual([sc.queue.done, sc.queue.total], [0, 2]);
  assert.equal(sc.decks.length, 1); assert.deepEqual([sc.decks[0].done, sc.decks[0].total], [0, 3]); assert.equal(sc.decks[0].name, 'Tiệc');

  let r = svc.start({ type: 'favs' }); assert.deepEqual([r.total, r.added, r.have], [2, 2, 0]);
  await idle();
  assert.equal(svc.library.has(A) && svc.library.has(B), true); assert.ok(fs.existsSync(svc.dir()), 'tải vào thư mục mặc định');
  assert.ok(ev.update > 0 && ev.library >= 2, 'có sự kiện tiến độ và cập nhật thư viện sau mỗi bài');
  sc = svc.scopes(); assert.deepEqual([sc.favs.done, sc.favs.total], [2, 2]); assert.deepEqual([sc.queue.done, sc.queue.total], [1, 2], 'B đã tải, C chưa');

  r = svc.start({ type: 'queue' }); assert.deepEqual([r.total, r.added, r.have], [2, 1, 1], 'bài đã có thì bỏ qua'); await idle();
  r = svc.start({ type: 'deck', id: dk.id }); assert.deepEqual([r.total, r.added, r.have], [3, 2, 1]); await idle();
  assert.deepEqual(svc.scopes().decks[0], { id: dk.id, name: 'Tiệc', done: 3, total: 3 });
  assert.ok(svc.start({ type: 'deck', id: 'khong-co' }).error); assert.ok(svc.start({ type: 'lung-tung' }).error); assert.ok(svc.start(undefined).error);
  r = svc.start({ type: 'ids', ids: [A, 'sai', A, SLOW] }); assert.deepEqual([r.total, r.added, r.have], [2, 1, 1]);

  // 3) huỷ rồi xoá dòng; chỉ xoá dòng đã kết thúc, không đụng file
  await sleep(200); assert.equal(svc.state().counts.downloading, 1); assert.equal(svc.clear(SLOW), false, 'đang tải thì chưa xoá dòng');
  assert.equal(svc.cancelAll(), 1); await idle();
  assert.equal(svc.state().jobs.find(j => j.id === SLOW).status, 'canceled');
  const fA = svc.library.fileFor(A); assert.equal(svc.clear(A), true); assert.ok(ev.removed.includes(A)); assert.ok(fs.existsSync(fA));
  assert.ok(svc.clearFinished() >= 1); assert.equal(svc.state().jobs.length, 0);

  // 4) đổi thư mục: quét thư mục mới (trống) -> số bài về 0; về mặc định -> thấy lại bài cũ
  const other = path.join(root, 'Khác'); fs.mkdirSync(other);
  assert.equal(await svc.setDir('tuong-doi'), false); assert.equal(await svc.setDir(''), false); assert.equal(await svc.setDir(null), false);
  assert.equal(await svc.setDir(other), true); assert.equal(svc.dir(), path.resolve(other)); assert.equal(svc.state().custom, true); assert.equal(svc.library.count, 0);
  assert.equal(svc.scopes().favs.done, 0, 'thư mục mới chưa có bài nào');
  r = svc.start({ type: 'ids', ids: [A] }); await idle(); assert.ok(fs.readdirSync(other).some(n => n.includes('[' + A + ']')), 'tải vào thư mục mới');
  assert.equal(await svc.resetDir(), true); assert.equal(svc.dir(), path.join(music, 'Youtube Player')); assert.equal(settings.dlDir, ''); assert.equal(svc.library.count, 5);
  assert.equal(await svc.setDir(path.join(music, 'Youtube Player')), true); assert.equal(settings.dlDir, '', 'chọn đúng thư mục mặc định thì không lưu riêng');

  // 5) cài đặt được lưu và đọc lại sau khi khởi động lại app
  await svc.setDir(other); svc.setMode('audio'); store.flush();
  const s2 = new Settings(new Store(path.join(root, 'ud'))); assert.equal(s2.dlDir, path.resolve(other)); assert.equal(s2.dlMode, 'audio');

  // 6) thoát app: dừng hết, không bỏ yt-dlp chạy ngầm
  svc.start({ type: 'ids', ids: [SLOW] }); await sleep(200); svc.stop(); await idle();
  assert.equal(svc.state().counts.downloading + svc.state().counts.queued, 0);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('dlservice-test OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
