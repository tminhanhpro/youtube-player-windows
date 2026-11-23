'use strict';
// Kiểm thử phần 7 (bước 2): hàng đợi tải bằng yt-dlp giả — tiến độ, thử lại android_vr, huỷ, đứng, thiếu yt-dlp, hai kiểu tải.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { DownloadLibrary } = require('../main/downloads');
const { DownloadQueue, buildArgs } = require('../main/downloader');
const FAKE = path.join(__dirname, 'fake-ytdlp.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const id = c => c.repeat(11);
const [OK, AUD, LITE, V0, UNA, BAD, SLOW, SLOW2, STALL, NOF, TINY, NOP] = 'abcdefghijkl'.split('').map(id);

(async () => {
  // --- dòng lệnh ---
  const base = { id: OK, dir: 'C:\\Nhạc\\YP', mode: 'video', maxHeight: 720, deno: 'C:\\bin\\deno.exe', ffmpeg: 'C:\\bin\\ffmpeg.exe', variant: 0 };
  let a = buildArgs(base);
  for (const f of ['-4', '--windows-filenames', '--no-playlist']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('-N') + 1], '4'); assert.equal(a[a.indexOf('-P') + 1], 'C:\\Nhạc\\YP');
  assert.equal(a[a.indexOf('-o') + 1], '%(title).80s [%(id)s].%(ext)s');
  assert.equal(a[a.indexOf('--js-runtimes') + 1], 'deno:C:\\bin\\deno.exe'); assert.equal(a[a.indexOf('--ffmpeg-location') + 1], 'C:\\bin\\ffmpeg.exe');
  assert.ok(a[a.indexOf('-f') + 1].includes('height<=720]') && a[a.indexOf('-f') + 1].includes('+ba'), 'có ffmpeg: ghép hình + tiếng');
  assert.ok(a.includes('--merge-output-format')); assert.ok(!a.includes('youtube:player_client=android_vr'));
  assert.equal(a[a.length - 1], 'https://www.youtube.com/watch?v=' + OK);
  a = buildArgs({ ...base, ffmpeg: null, variant: 1 });
  assert.ok(!a.includes('--ffmpeg-location') && !a.includes('--merge-output-format')); assert.ok(!a[a.indexOf('-f') + 1].includes('+'), 'không ffmpeg: định dạng gộp sẵn');
  assert.ok(a.includes('youtube:player_client=android_vr'), 'biến thể 1 = android_vr');
  a = buildArgs({ ...base, mode: 'audio', deno: null }); assert.equal(a[a.indexOf('-f') + 1], 'ba[ext=m4a]/ba/b'); assert.ok(!a.includes('--js-runtimes'));
  assert.ok(buildArgs({ ...base, maxHeight: 99999 }).join(' ').includes('height<=4320'), 'chặn mức cao bất thường');

  // --- dựng hàng đợi với yt-dlp giả ---
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-dq-')), dir = path.join(root, 'sâu', 'Youtube Player'), logf = path.join(root, 'fake.log');
  const beh = { [V0]: 'v0fail', [UNA]: 'unavailable', [BAD]: 'fail', [SLOW]: 'slow', [SLOW2]: 'slow', [STALL]: 'stall', [NOF]: 'nofile', [TINY]: 'tiny', [NOP]: 'noprint' };
  let mode = 'video', ffmpeg = 'C:\\ffmpeg.exe', curDir = dir;
  const lib = new DownloadLibrary(() => curDir);
  const q = new DownloadQueue({
    library: lib, getDir: () => curDir, getMode: () => mode, getMaxHeight: () => 720, stallMs: 400,
    tools: () => ({ ytdlp: process.execPath, prefix: [FAKE], deno: null, ffmpeg, env: { FAKE_BEHAVIOR: JSON.stringify(beh), FAKE_LOG: logf } })
  });
  const runs = (i) => fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => r.start && (!i || r.id === i)) : [];
  const idle = () => new Promise(r => q.once('idle', r));
  const updates = []; q.on('update', j => updates.push(j));
  const dones = []; q.on('done', j => dones.push(j.id));

  // 1) tải thường (hình + tiếng): tiến độ tăng dần, tạo thư mục, ghi vào thư viện, chỉ một bài chạy một lúc
  let r = q.enqueue([{ videoId: OK, title: 'Bài thử' }, OK, 'sai', null, { videoId: AUD }]);
  assert.deepEqual(r.added, [OK, AUD]); assert.equal(r.bad, 2, 'mã sai bị bỏ'); assert.equal(q.enqueue([OK]).queued.length, 1, 'đang chờ thì không thêm lần nữa');
  assert.equal(q.snapshot().counts.downloading, 1, 'chỉ một bài tải một lúc');
  mode = 'video'; await idle();
  let s = q.snapshot();
  assert.equal(s.counts.done, 2); assert.equal(s.lite, false); assert.equal(s.ffmpeg, true);
  assert.equal(lib.has(OK), true); assert.ok(lib.fileFor(OK).endsWith('.mp4')); assert.ok(fs.existsSync(dir), 'tự tạo thư mục tải');
  assert.equal(s.jobs[0].title, 'Bài thử'); assert.equal(s.jobs[0].percent, 100); assert.equal(s.jobs[0].file, lib.fileFor(OK));
  const pcts = updates.filter(u => u.id === OK && u.status === 'downloading').map(u => u.percent);
  assert.ok(pcts.length >= 2 && pcts.every((p, i) => i === 0 || p >= pcts[i - 1]) && pcts.every(p => p <= 99), 'phần trăm tăng dần, chưa tới 100 khi chưa xong: ' + pcts);
  assert.ok(pcts.some(p => p > 50), 'hai luồng (hình rồi tiếng) cộng dồn, không quay về 0'); assert.ok(updates.some(u => u.id === OK && u.speed > 0), 'có tốc độ');
  assert.deepEqual(dones, [OK, AUD]);
  const rs = runs(); for (let i = 1; i < rs.length; i++) assert.ok(rs[i].t0 >= rs[i - 1].t1 - 5 || rs[i].id === rs[i - 1].id, 'các bài chạy lần lượt');

  // 2) đã tải rồi thì bỏ qua
  r = q.enqueue([OK]); assert.deepEqual(r.have, [OK]); assert.equal(r.added.length, 0);

  // 3) kiểu chỉ tiếng -> m4a ; không ffmpeg -> định dạng gộp sẵn, báo "lite"
  mode = 'audio'; q.enqueue([id('m')]); await idle(); assert.ok(lib.fileFor(id('m')).endsWith('.m4a'));
  mode = 'video'; ffmpeg = null; assert.equal(q.snapshot().lite, true);
  q.enqueue([LITE]); await idle(); assert.equal(q.snapshot().jobs.find(j => j.id === LITE).lite, true);
  assert.ok(!runs(LITE)[0].args[runs(LITE)[0].args.indexOf('-f') + 1].includes('+'), 'không ghép khi thiếu ffmpeg'); ffmpeg = 'C:\\ffmpeg.exe';

  // 4) lỗi lần đầu -> thử lại bằng android_vr
  q.enqueue([V0]); await idle();
  assert.equal(lib.has(V0), true); const v0 = runs(V0); assert.equal(v0.length, 2);
  assert.ok(!v0[0].args.includes('youtube:player_client=android_vr') && v0[1].args.includes('youtube:player_client=android_vr'));
  assert.equal(q.snapshot().jobs.find(j => j.id === V0).attempt, 2);

  // 5) bài không khả dụng: không thử lại ; lỗi luôn: thử cả hai client rồi báo lỗi ; bấm lại thì xếp lại từ đầu
  q.enqueue([UNA, BAD]); await idle();
  let ju = q.snapshot().jobs.find(j => j.id === UNA), jb = q.snapshot().jobs.find(j => j.id === BAD);
  assert.equal(ju.status, 'error'); assert.ok(/không khả dụng/.test(ju.error)); assert.equal(runs(UNA).length, 1);
  assert.equal(jb.status, 'error'); assert.equal(jb.error, 'boom'); assert.equal(runs(BAD).length, 2);
  q.enqueue([BAD]); await idle(); assert.equal(runs(BAD).length, 4, 'xếp lại và thử lại'); assert.equal(q.snapshot().jobs.filter(j => j.id === BAD).length, 1);

  // 6) yt-dlp báo xong mà không có file / file hỏng ; không in đường dẫn thì tự tìm theo mã
  q.enqueue([NOF, TINY, NOP]); await idle();
  s = q.snapshot();
  assert.equal(s.jobs.find(j => j.id === NOF).status, 'error'); assert.ok(/không thấy file/.test(s.jobs.find(j => j.id === NOF).error));
  assert.equal(s.jobs.find(j => j.id === TINY).status, 'error'); assert.ok(/hỏng|nhỏ/.test(s.jobs.find(j => j.id === TINY).error));
  assert.equal(s.jobs.find(j => j.id === NOP).status, 'done'); assert.equal(lib.has(NOP), true);

  // 7) huỷ: bài đang tải bị dừng thật, bài chờ sau đó vẫn chạy ; huỷ bài đang chờ ; huỷ tất cả
  q.enqueue([SLOW, SLOW2, id('n')]); await sleep(300);
  assert.equal(q.snapshot().counts.downloading, 1); assert.equal(q.cancel(SLOW2), true, 'huỷ bài đang chờ');
  const pid = runs(SLOW)[0].pid; assert.equal(q.cancel(SLOW), true); await idle();
  s = q.snapshot(); assert.equal(s.jobs.find(j => j.id === SLOW).status, 'canceled'); assert.equal(s.jobs.find(j => j.id === SLOW2).status, 'canceled');
  assert.equal(lib.has(id('n')), true, 'sau khi huỷ, bài kế tiếp vẫn tải'); assert.equal(runs(SLOW2).length, 0, 'bài huỷ khi đang chờ chưa từng chạy');
  assert.equal(runs(SLOW).length, 1, 'huỷ thì không thử lại bằng client khác');
  let alive = true; try { process.kill(pid, 0); } catch (e) { alive = false; } assert.equal(alive, false, 'tiến trình yt-dlp đã dừng');
  assert.equal(q.cancel('khong-co'), false); assert.equal(q.cancel(OK), false, 'bài đã xong: không có gì để huỷ');
  q.enqueue([SLOW, SLOW2, id('o')]); await sleep(200); assert.equal(q.cancelAll(), 3); await idle();
  assert.equal(q.snapshot().counts.queued + q.snapshot().counts.downloading, 0);
  assert.equal(lib.has(id('o')), false);

  // 8) bị đứng: không có dữ liệu quá hạn thì dừng và thử client kia, cuối cùng báo lỗi
  q.enqueue([STALL]); await idle(); jb = q.snapshot().jobs.find(j => j.id === STALL);
  assert.equal(jb.status, 'error'); assert.ok(/đứng/.test(jb.error)); assert.equal(runs(STALL).length, 2);
  for (const rr of runs(STALL)) { try { process.kill(rr.pid, 0); assert.fail('tiến trình đứng chưa bị dừng'); } catch (e) { assert.notEqual(e.code, 'ERR_ASSERTION'); } }

  // 9) thiếu yt-dlp / chưa chọn thư mục / không tạo được thư mục
  const q2 = new DownloadQueue({ library: lib, getDir: () => curDir, tools: () => ({ ytdlp: path.join(root, 'khong-co-yt-dlp'), prefix: [], env: {} }) });
  q2.enqueue([id('p')]); await new Promise(r => q2.once('idle', r));
  jb = q2.snapshot().jobs[0]; assert.equal(jb.status, 'error'); assert.ok(/Không chạy được yt-dlp/.test(jb.error)); assert.equal(jb.attempt, 1, 'thiếu yt-dlp thì không thử lại');
  const q3 = new DownloadQueue({ library: lib, getDir: () => '', tools: () => ({ ytdlp: process.execPath, prefix: [FAKE] }) });
  q3.enqueue([id('q')]); await new Promise(r => q3.once('idle', r)); assert.ok(/Chưa chọn thư mục/.test(q3.snapshot().jobs[0].error));
  const blocker = path.join(root, 'la-file'); fs.writeFileSync(blocker, 'x');
  const q4 = new DownloadQueue({ library: lib, getDir: () => path.join(blocker, 'con'), tools: () => ({ ytdlp: process.execPath, prefix: [FAKE] }) });
  q4.enqueue([id('r')]); await new Promise(r => q4.once('idle', r)); assert.ok(/Không tạo được thư mục/.test(q4.snapshot().jobs[0].error));

  // 10) dọn danh sách: chỉ xoá dòng đã kết thúc, không đụng file
  const total = q.snapshot().jobs.length; q.enqueue([SLOW]); await sleep(150);
  assert.equal(q.clear(SLOW), false, 'đang tải thì không xoá dòng'); assert.equal(q.clear('khong-co'), false);
  const fileOfOk = lib.fileFor(OK); assert.equal(q.clear(OK), true); assert.equal(fs.existsSync(fileOfOk), true, 'xoá dòng không xoá file');
  q.cancelAll(); await idle(); assert.ok(q.clearFinished() >= total - 1); assert.equal(q.snapshot().jobs.length, 0);
  assert.equal(lib.has(OK), true);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('downloader-test OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
