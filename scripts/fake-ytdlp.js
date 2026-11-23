'use strict';
// yt-dlp giả để kiểm thử downloader.js. Hành vi theo từng mã bài qua biến môi trường FAKE_BEHAVIOR = {"<id>":"<kiểu>"}.
// Ghi mỗi lần chạy vào FAKE_LOG (một dòng JSON: pid, id, args, thời điểm bắt đầu/kết thúc).
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const url = a[a.length - 1], id = (/v=([^&]+)/.exec(url) || [])[1];
const dir = val('-P'), fmt = val('-f') || '', beh = (JSON.parse(process.env.FAKE_BEHAVIOR || '{}')[id]) || 'ok';
const vr = a.includes('youtube:player_client=android_vr');
const t0 = Date.now();
const log = extra => { if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ pid: process.pid, id, args: a, t0, t1: Date.now(), beh, ...extra }) + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ext = fmt.startsWith('ba') ? 'm4a' : 'mp4';
const target = path.join(dir || '.', 'Bài ' + id + ' [' + id + '].' + ext);
const prog = (d, t, s) => console.log('YTPROG|' + d + '|' + t + '|NA|' + s + '|' + Math.max(0, Math.round((t - d) / s)));

(async () => {
  log({ start: true });
  if (beh === 'unavailable') { console.error('ERROR: [youtube] ' + id + ': Video unavailable'); log({}); process.exit(1); }
  if (beh === 'fail' || (beh === 'v0fail' && !vr)) { console.error('ERROR: ' + (beh === 'fail' ? 'boom' : "Sign in to confirm you're not a bot")); log({}); process.exit(1); }
  if (beh === 'stall') { setInterval(() => {}, 1000); return; }
  if (beh === 'slow') { let d = 0; setInterval(() => { d += 1000; prog(Math.min(d, 90000), 100000, 1000); }, 40); return; }
  const streams = fmt.includes('+') ? 2 : 1;
  for (let s = 0; s < streams; s++) for (let i = 1; i <= 4; i++) { prog(i * 25000, 100000, 50000); await sleep(40); }
  fs.writeFileSync(target + '.part', Buffer.alloc(100)); fs.renameSync(target + '.part', target);
  if (beh === 'nofile') { fs.unlinkSync(target); }
  else fs.writeFileSync(target, Buffer.alloc(beh === 'tiny' ? 10 : 4096, 7));
  if (beh !== 'noprint' && beh !== 'nofile') console.log('YTPFILE|' + target);
  log({ ended: true }); process.exit(0);
})();
