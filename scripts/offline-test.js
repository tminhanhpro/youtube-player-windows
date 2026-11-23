'use strict';
// Kiểm thử phần 7 (bước 3): bộ phát ưu tiên file đã tải sẵn; file mất / hỏng / đứng hình thì phát trực tuyến tiếp từ vị trí đang nghe.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Store, Settings } = require('../main/store');
const { Controller, itemJson } = require('../main/controller');
const { DownloadLibrary } = require('../main/downloads');
const resolver = require('../main/resolver');

const A = 'AAAAAAAAAAA', B = 'BBBBBBBBBBB', C = 'CCCCCCCCCCC', D = 'DDDDDDDDDDD', E = 'EEEEEEEEEEE';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const loads = cmds => cmds.filter(c => c.type === 'load');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-off-'));
  const mk = (name, size) => { const f = path.join(root, name); fs.writeFileSync(f, Buffer.alloc(size || 4096, 1)); return f; };
  const fA = mk('Bài A [' + A + '].mp4'), fB = mk('Bài B [' + B + '].m4a'), fC = mk('Bài C [' + C + '].mp4'), fD = mk('Bài D [' + D + '].mp4');
  const lib = new DownloadLibrary(() => root); await lib.scan(); assert.equal(lib.count, 4);

  let resolves = 0;
  resolver.resolve = async id => { resolves++; return { sources: [{ height: 720, video: { url: 'http://x/' + id }, audio: null }], title: 'T ' + id, channel: 'K', durationSec: 200 }; };
  resolver.cached = () => null;

  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-off2-'))), settings = new Settings(store);
  settings.seedAutoplay = false;
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'), lib);
  const cmds = []; ctl.on('player', c => cmds.push(c)); ctl.attachPlayer(true);

  // 1) Bài đã tải: phát từ file, không gọi yt-dlp, thẻ bài vẫn là bài YouTube
  const it = ctl.add(A, 'Bài A', 'Kênh', 200, 'TV', 'end', true); await sleep(30);
  let load = loads(cmds).pop();
  assert.equal(load.mode, 'stream'); assert.equal(load.src.local, fA); assert.equal(load.src.mime, 'video/mp4'); assert.equal(load.src.audioOnly, false);
  assert.equal(resolves, 0, 'bài đã tải không gọi yt-dlp');
  assert.equal(it.local, null, 'không gắn item.local');
  const j = itemJson(it); assert.equal(j.local, false); assert.ok(j.thumbnailUrl.includes(A), 'thẻ bài giữ ảnh YouTube');
  assert.equal(ctl.persist() || ctl.store.get('queue', [])[0].localPath, null, 'khi lưu hàng đợi vẫn là bài YouTube');
  ctl.playerEvent('started', load.key); assert.equal(ctl.state, 'PLAYING'); assert.ok(ctl.isOffline(it));

  // 2) Đổi chất lượng khi đang phát file đã tải: không nạp lại
  const n1 = loads(cmds).length; ctl.setMaxHeight(360); await sleep(20); assert.equal(loads(cmds).length, n1, 'đổi chất lượng không làm gián đoạn file đã tải');

  // 3) Bài kế đã tải thì không tải trước link (prefetch)
  ctl.add(B, 'Bài B', '', 100, 'TV', 'end', true); await sleep(20); assert.equal(resolves, 0, 'không prefetch bài đã tải');

  // 4) Chỉ có tiếng (m4a): phát như nhạc
  ctl.skip(); await sleep(30); load = loads(cmds).pop(); assert.equal(load.src.local, fB); assert.equal(load.src.audioOnly, true);

  // 5) File mất trước khi phát: phát trực tuyến luôn
  fs.unlinkSync(fC);
  ctl.add(C, 'Bài C', '', 100, 'TV', 'next', true); ctl.skip(); await sleep(40);
  load = loads(cmds).pop(); assert.equal(load.src.video.url, 'http://x/' + C); assert.ok(resolves >= 1, 'bài chưa có file thì lấy link như thường'); assert.ok(!ctl.isOffline(ctl.current));
  assert.equal(lib.has(C), false);

  // 6) File có trong danh sách nhưng không đọc được
  const stub = { calls: [], fileFor: () => path.join(root, 'khong-co', 'x.mp4'), forget(id) { this.calls.push(id); } };
  ctl.setDownloads(stub);
  ctl.add(E, 'Bài E', '', 100, 'TV', 'next', true); ctl.skip(); await sleep(40);
  load = loads(cmds).pop(); assert.equal(load.src.video.url, 'http://x/' + E); assert.deepEqual(stub.calls, [E]);
  ctl.setDownloads(lib);

  // 7) File hỏng khi phát: phát trực tuyến tiếp từ vị trí đang nghe, giữ file trên đĩa, không thử file đó lần nữa
  ctl.add(D, 'Bài D', '', 300, 'TV', 'next', true); ctl.skip(); await sleep(30);
  load = loads(cmds).pop(); assert.equal(load.src.local, fD); const r0 = resolves;
  ctl.playerEvent('started', load.key); ctl.playerEvent('pos', load.key, 42000, 300000);
  const offLoads = loads(cmds).filter(c => c.src && c.src.local).length;
  ctl.playerEvent('error', load.key); await sleep(40);
  load = loads(cmds).pop(); assert.equal(load.src.video.url, 'http://x/' + D); assert.equal(load.startMs, 42000, 'tiếp từ vị trí đang nghe');
  assert.ok(resolves > r0, 'phải lấy link trực tuyến'); assert.ok(fs.existsSync(fD), 'không xoá file'); assert.equal(lib.has(D), false, 'bài hỏng bị bỏ khỏi danh sách đã tải');
  assert.equal(loads(cmds).filter(c => c.src && c.src.local).length, offLoads, 'không quay lại file hỏng');

  // 8) Đứng hình: vị trí không nhích > 15 giây
  await lib.scan(); assert.ok(lib.has(D) && lib.has(A));
  ctl.add(A, 'Bài A', '', 200, 'TV', 'next', true); ctl.skip(); await sleep(30);
  load = loads(cmds).pop(); assert.equal(load.src.local, fA); ctl.playerEvent('started', load.key); ctl.playerEvent('pos', load.key, 8000, 200000);
  ctl.tick(); ctl.lastPosChangeAt = Date.now() - 16000; ctl.tick(); await sleep(40);
  load = loads(cmds).pop(); assert.equal(load.src.video.url, 'http://x/' + A); assert.equal(load.startMs, 8000);

  // 9) Không bắt đầu được trong 15 giây (chờ khởi động) cũng chuyển sang trực tuyến
  await lib.scan(); ctl.add(D, 'Bài D', '', 300, 'TV', 'next', true); ctl.skip(); await sleep(30);
  load = loads(cmds).pop(); assert.equal(load.src.local, fD); assert.equal(ctl.state, 'RESOLVING');
  ctl.handleStreamError(ctl.current); await sleep(40);
  load = loads(cmds).pop(); assert.equal(load.src.video.url, 'http://x/' + D); assert.equal(load.startMs, 0, 'chưa nghe gì thì phát từ đầu');

  // 10) Không có thư viện tải: chạy như cũ
  const ctl2 = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  const c2 = []; ctl2.on('player', c => c2.push(c)); ctl2.attachPlayer(true);
  ctl2.add(A, 'Bài A', '', 100, 'TV', 'end', true); await sleep(30);
  assert.equal(loads(c2).pop().src.video.url, 'http://x/' + A);

  ctl.stop(); ctl2.stop(); fs.rmSync(root, { recursive: true, force: true });
  console.log('offline-test OK');
  process.exit(0);
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
