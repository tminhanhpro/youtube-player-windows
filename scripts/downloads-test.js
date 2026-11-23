'use strict';
// Kiểm thử phần 7 (bước 1): nhận biết bài đã tải qua mã [videoId] trong tên file, quét thư mục, đếm x/y theo bộ bài.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const D = require('../main/downloads');

const A = 'dQw4w9WgXcQ', B = 'abcdefghijk', C = 'CCCCCCCCCCC', E = 'EEEEEEEEEEE', G = 'ggggggggggg', H = 'HHHHHHHHHHH', Z = 'ZZZZZZZZZZZ';

(async () => {
  // --- nhận mã từ tên file ---
  assert.equal(D.idFromName('Bài A [' + A + '].mp4'), A);
  assert.equal(D.idFromName('C:\\Nhạc\\Youtube Player\\Bài A [' + A + '].m4a'), A);
  assert.equal(D.idFromName('Bài [' + A + '].f137.mp4'), null, 'mảnh rời chưa ghép');
  assert.equal(D.idFromName('Bài [' + A + '].mp4.part'), null, 'đang tải dở');
  assert.equal(D.idFromName('Bài [' + A + '].txt'), null, 'không phải nhạc/video');
  assert.equal(D.idFromName('Bài [ngan].mp4'), null, 'mã sai độ dài');
  assert.equal(D.idFromName('Bài không mã.mp4'), null);
  assert.equal(D.idFromName(''), null); assert.equal(D.idFromName(null), null);
  assert.equal(D.defaultDir('C:\\Users\\a\\Music'), path.join('C:\\Users\\a\\Music', 'Youtube Player'));
  assert.deepEqual(D.uniqueIds([A, A, 'x', null, B, 5]), [A, B]);

  // --- quét thư mục ---
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-dl-'));
  const mk = (rel, size) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(size == null ? 2048 : size, 1)); return f; };
  const aVideo = mk('Bài A [' + A + '].mp4'), aAudio = mk('Bài A [' + A + '].m4a');
  const bAudio = mk('Bài B [' + B + '].m4a');
  mk('Bài B [' + B + '].f137.mp4'); mk('Bài B [' + B + '].mp4.part'); mk('Bài B [' + B + '].webm.ytdl');
  mk('Bài E [short].mp3'); mk('ghi chú [' + E + '].txt');
  mk('Hỏng [' + Z + '].mp4', 10);                                  // quá nhỏ = hỏng
  const gWeb = mk('con/Bài G [' + G + '].webm');                   // thư mục con
  mk('a/b/c/d/Quá sâu [' + H + '].mp4');                           // sâu hơn mức cho phép
  mk('.ẩn/Giấu [' + C + '].mp4');                                  // thư mục ẩn
  const lib = new D.DownloadLibrary(() => root);
  assert.equal(lib.has(A), false, 'chưa quét thì chưa biết');
  assert.equal(await lib.scan(), 3, 'A, B, G');
  assert.equal(lib.fileFor(A), aVideo, 'có cả hình lẫn tiếng thì dùng file hình');
  assert.equal(lib.fileFor(B), bAudio); assert.equal(lib.fileFor(G), gWeb);
  for (const id of [C, E, H, Z]) assert.equal(lib.has(id), false, id);
  assert.equal(lib.count, 3);
  assert.equal(lib.info(A).kind, 'video'); assert.equal(lib.info(A).mime, 'video/mp4'); assert.equal(lib.info(B).mime, 'audio/mp4'); assert.equal(lib.info(C), null);

  // --- thư mục không có / đổi thư mục ---
  let cur = path.join(root, 'khong-co');
  const lib2 = new D.DownloadLibrary(() => cur);
  assert.equal(await lib2.scan(), 0); assert.equal(lib2.has(A), false);
  cur = path.join(root, 'con'); assert.equal(await lib2.scan(), 1); assert.equal(lib2.has(G), true);
  assert.equal(await new D.DownloadLibrary('').scan(), 0, 'chưa đặt thư mục');

  // --- file bị xoá giữa chừng: tự quên ---
  fs.unlinkSync(bAudio);
  assert.equal(lib.fileFor(B), null); assert.equal(lib.count, 2);
  fs.writeFileSync(aVideo, Buffer.alloc(5));                       // file bị cắt cụt còn vài byte
  assert.equal(lib.fileFor(A), null, 'file hỏng không dùng');

  // --- ghi nhận bài vừa tải (không cần quét lại) ---
  assert.equal(lib.add(B, mk('Bài B [' + B + '].mp3')), true); assert.equal(lib.has(B), true);
  assert.equal(lib.add(B, path.join(root, 'khong-co.mp4')), false);
  assert.equal(lib.add('sai', aAudio), false); assert.equal(lib.add(A, 'rel.mp4'), false); assert.equal(lib.add(A, mk('x [' + A + '].mp4', 3)), false, 'quá nhỏ');
  assert.equal(lib.add(A, aAudio), true); assert.equal(lib.fileFor(A), aAudio);
  const aNew = mk('Bài A bản mới [' + A + '].mp4'); assert.equal(lib.add(A, aNew), true); assert.equal(lib.fileFor(A), aNew, 'hình thay tiếng');
  assert.equal(lib.add(A, aAudio), true); assert.equal(lib.fileFor(A), aNew, 'tiếng không đè hình');

  // --- thiếu / tiến độ ---
  assert.deepEqual(lib.missing([A, B, C, C, 'x', E]), [C, E]);
  assert.deepEqual(lib.progress([A, B, C, A]), { done: 2, total: 3, missing: [C] });
  assert.deepEqual(lib.progress([]), { done: 0, total: 0, missing: [] });

  // --- theo bộ bài ---
  const decks = [
    { id: 'd1', name: 'Đám cưới', cards: [{ type: 'yt', videoId: A }, { type: 'yt', videoId: C }, { type: 'sfx', sfxId: 'x' }, { type: 'yt', videoId: A }, { type: 'local', file: '/a.mp3' }] },
    { id: 'd2', name: 'Chỉ hiệu ứng', cards: [{ type: 'sfx', sfxId: 'x' }, { type: 'empty' }] },
    { id: 'd3', name: 'Sinh nhật', cards: [{ type: 'yt', videoId: B }, { type: 'yt', videoId: G }] },
    { id: 'd4', name: 'Rỗng' }
  ];
  assert.deepEqual(D.DownloadLibrary.deckIds(decks[0]), [A, C]);
  assert.deepEqual(lib.decksProgress(decks), [
    { id: 'd1', name: 'Đám cưới', done: 1, total: 2, missing: [C] },
    { id: 'd3', name: 'Sinh nhật', done: 2, total: 2, missing: [] }
  ]);
  assert.deepEqual(lib.decksProgress(null), []);

  // --- xoá bài đã tải: xoá mọi file mang mã đó ---
  const n = await lib.remove(A);
  assert.ok(n >= 3, 'xoá cả file hình và file tiếng, đã xoá ' + n);
  assert.equal(lib.has(A), false); assert.equal(fs.existsSync(aNew), false); assert.equal(fs.existsSync(aAudio), false);
  assert.equal(fs.existsSync(path.join(root, 'ghi chú [' + E + '].txt')), true, 'không đụng file khác');
  assert.equal(await lib.remove(C), 0, 'bài chưa tải: không có gì để xoá');
  assert.equal(await lib.scan(), 2, 'quét lại: B (mp3 mới thêm) và G');
  // forget: bỏ khỏi danh sách nhưng giữ file; quét lại thì hiện lại
  assert.equal(lib.forget(G), true); assert.equal(lib.has(G), false); assert.equal(lib.forget(G), false);
  assert.ok(fs.existsSync(gWeb)); assert.equal(await lib.scan(), 2);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('downloads-test OK');
})().catch(e => { console.error(e); process.exit(1); });
