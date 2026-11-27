'use strict';
// yt-dlp giả để kiểm thử chanvideos.js: in mỗi video một dòng JSON như `yt-dlp --flat-playlist -j`. Hành vi chọn bằng FAKE_CHAN.
const mode = process.env.FAKE_CHAN || 'ok';
const id = n => 'v' + String(n).padStart(10, '0');
const out = o => console.log(JSON.stringify(o));
if (mode === 'fail') { console.error('ERROR: Unable to download webpage'); process.exit(1); }
if (mode === 'stall') { setInterval(() => {}, 1000); return; }
console.log('WARNING: không phải JSON');
out({ id: id(1), title: 'Bài 1', duration: 200, channel: 'Kênh X' });
out({ id: id(2), title: 'Short', duration: 30 });                        // bị bỏ: <= 60 giây
out({ id: id(3), title: 'Sắp phát', duration: null, live_status: 'is_upcoming' }); // bị bỏ
out({ id: id(4), title: '[Private video]', duration: 100 });             // bị bỏ
out({ id: id(5), title: 'Không rõ thời lượng', duration: null, uploader: 'Người X' }); // giữ
out({ id: id(1), title: 'Bài 1 trùng', duration: 200 });                  // trùng: bỏ
out({ id: 'ngan', title: 'Sai mã', duration: 200 });                      // mã sai: bỏ
const total = mode === 'many' ? 100 : 3;
let n = 10;
(function next() { for (let i = 0; i < 20 && n < 10 + total; i++, n++) out({ id: id(n), title: 'Bài ' + n, duration: 180 + n }); if (n < 10 + total) setTimeout(next, 30); else if (mode === 'many') setTimeout(() => process.exit(0), 100); })();
