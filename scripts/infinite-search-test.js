'use strict';
// Cuộn tìm kiếm không giới hạn: không còn trần 300 bài / 20 trang, lỗi mạng giữa chừng vẫn cho thử lại.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Store, Settings } = require('../main/store');
const { Controller } = require('../main/controller');

const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ytp-inf-'))), settings = new Settings(store);
settings.seedAutoplay = false;
const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
const id = n => 'v' + String(n).padStart(10, '0');
const hits = (from, n) => Array.from({ length: n }, (_, i) => ({ videoId: id(from + i), title: 'Bài ' + (from + i), channel: 'K', durationSec: 200 }));

ctl.searchBegin('nhac', 'tv');
for (let p = 0; p < 40; p++) ctl.searchDone('nhac', 'tv', p, hits(p * 12, 12), true);   // 480 bài, 40 trang
assert.equal(ctl.search.results.length, 480);
assert.equal(ctl.search.hasMore, true);
ctl.searchDone('nhac', 'tv', 40, hits(0, 12), true);                                      // trang trùng: không thêm bài lặp
assert.equal(ctl.search.results.length, 480);
ctl.searchFail('nhac', 'tv', 'mat mang');                                                 // lỗi giữa chừng: giữ danh sách, còn thử lại được
assert.equal(ctl.search.results.length, 480); assert.equal(ctl.search.hasMore, true); assert.ok(ctl.search.error);
ctl.searchLoadingMore(); assert.equal(ctl.search.error, null);
ctl.searchBegin('khac', 'tv'); ctl.searchFail('khac', 'tv', 'x');                         // lỗi ngay trang đầu: hết, không kẹt vòng lặp
assert.equal(ctl.search.hasMore, false);
console.log('Tìm kiếm cuộn không giới hạn: đều đạt');
ctl.stop(); process.exit(0);
