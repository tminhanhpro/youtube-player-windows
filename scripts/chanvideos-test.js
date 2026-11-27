'use strict';
// Tải tất cả video của kênh bằng yt-dlp (giả): lọc Shorts/trùng/mã sai, đổ dần từng lô, dừng giữa chừng, lỗi.
const path = require('path'), assert = require('assert');
const CV = require('../main/chanvideos');
const FAKE = path.join(__dirname, 'fake-chanlist.js');
const run = (mode, onBatch) => { process.env.FAKE_CHAN = mode; return CV.listChannelVideos('https://www.youtube.com/channel/UCabc/', onBatch, { bin: process.execPath, args: [FAKE], channelName: 'Tên dự phòng' }); };
(async () => {
  assert.equal(CV.videosUrl('https://www.youtube.com/channel/UCabc'), 'https://www.youtube.com/channel/UCabc/videos');
  assert.equal(CV.videosUrl('https://www.youtube.com/@abc/'), 'https://www.youtube.com/@abc/videos');
  assert.equal(CV.videosUrl('https://www.youtube.com/@abc/videos?x=1'), 'https://www.youtube.com/@abc/videos');
  // 1) lọc đúng
  let list = await run('ok').done;
  assert.deepStrictEqual(list.map(h => h.videoId), ['v0000000001', 'v0000000005', 'v0000000010', 'v0000000011', 'v0000000012'], 'bỏ Shorts, sắp phát, riêng tư, trùng, mã sai; giữ video không rõ thời lượng');
  assert.equal(list[0].channel, 'Kênh X'); assert.equal(list[1].channel, 'Người X'); assert.equal(list[1].durationSec, 0);
  // 2) nhiều video: đổ dần nhiều lô, lô sau luôn dài hơn lô trước
  const sizes = []; list = await run('many', all => sizes.push(all.length)).done;
  assert.equal(list.length, 102); assert.ok(sizes.length >= 3, 'đổ dần từng lô, được ' + sizes.length); assert.ok(sizes.every((n, i) => !i || n > sizes[i - 1]));
  assert.equal(sizes[sizes.length - 1], 102, 'lô cuối có đủ');
  // 3) dừng giữa chừng: trả phần đã có, không treo
  let job = run('many', () => {}); await new Promise(r => setTimeout(r, 40)); job.kill();
  list = await job.done; assert.ok(list.length < 102, 'kill giữa chừng chỉ có một phần');
  job = run('stall'); setTimeout(() => job.kill(), 100); assert.deepStrictEqual(await job.done, [], 'kill khi chưa có bài nào: danh sách rỗng, không lỗi');
  // 4) lỗi mà chưa có bài nào: báo lỗi (để main.js chuyển sang cách lọc theo tên kênh)
  await assert.rejects(run('fail').done, /Unable to download/);
  await assert.rejects(CV.listChannelVideos('x', null, { bin: '/khong/co/yt-dlp' }).done, /Không chạy được yt-dlp/);
  console.log('Tải tất cả video của kênh: đạt'); process.exit(0);
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
