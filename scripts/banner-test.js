'use strict';
// Kiểm thử "Chữ chào mừng" (phần nền, không cần Electron): làm sạch dữ liệu, mẫu lưu sẵn, hiện/ẩn, tự ẩn theo giờ.
const assert = require('assert');
const { Banners, sanitize, DEFAULTS } = require('../main/banner');

const mem = () => { const m = {}; return { get: (k, d) => (m[k] === undefined ? d : m[k]), set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };

(async () => {
  // làm sạch
  let s = sanitize({ text: '  Chúc mừng\r\n\n  đám cưới  \nA & B\nthừa dòng 4', color: 'red', size: 99, pos: 'x', hideSec: 7 });
  assert.equal(s.text, 'Chúc mừng\nđám cưới\nA & B', 'tối đa 3 dòng, bỏ dòng trống');
  assert.equal(s.color, '#ffffff'); assert.equal(s.size, 5); assert.equal(s.pos, 'center'); assert.equal(s.hideSec, 0);
  s = sanitize({ text: 'a', color: '#FFD54F', size: 0, pos: 'bottom', hideSec: 30 });
  assert.equal(s.color, '#ffd54f'); assert.equal(s.size, 3); assert.equal(s.pos, 'bottom'); assert.equal(s.hideSec, 30);
  assert.equal(sanitize({ text: 'x'.repeat(500) }).text.length, 120);
  assert.equal(sanitize(null).text, '');
  assert.equal(sanitize({ text: '<script>alert(1)</script>' }).text, '<script>alert(1)</script>'); // chỉ là chữ, renderer dùng textContent

  // mẫu: lần đầu có mẫu mặc định, lưu rồi đọc lại
  const store = mem(); const events = [];
  const b = new Banners(store, x => events.push(x));
  assert.equal(b.list().length, DEFAULTS.length);
  const saved = b.saveList([{ text: 'Mừng cưới', color: '#ff80ab', size: 4 }, { text: '   ' }, { text: 'Hai', color: '#zzzzzz' }]);
  assert.equal(saved.length, 2, 'mẫu rỗng bị bỏ');
  assert.equal(b.list()[1].color, '#ffffff');
  assert.equal(b.saveList(Array.from({ length: 50 }, (_, i) => ({ text: 'm' + i }))).length, 30, 'tối đa 30 mẫu');
  assert.equal(b.saveList([]).length, 0); assert.equal(b.list().length, 0, 'xoá hết thì không quay lại mặc định');

  // hiện / ẩn
  assert.equal(b.show({ text: '' }), null); assert.equal(events.length, 0);
  const cur = b.show({ text: 'Xin chào', hideSec: 0 });
  assert.equal(cur.text, 'Xin chào'); assert.equal(b.current().text, 'Xin chào'); assert.equal(events.length, 1);
  assert.equal(b.hide(), true); assert.equal(b.current(), null); assert.equal(events[1], null);
  assert.equal(b.hide(), false, 'ẩn lần nữa không phát sự kiện'); assert.equal(events.length, 2);

  // tự ẩn: dùng giờ giả
  const realST = global.setTimeout; let fn = null;
  global.setTimeout = (f, ms) => { fn = f; return { unref() {} }; };
  const ev2 = []; const b2 = new Banners(mem(), x => ev2.push(x));
  b2.show({ text: 'A', hideSec: 10 }); const first = fn;
  b2.show({ text: 'B', hideSec: 10 }); const second = fn;
  first(); assert.equal(b2.current().text, 'B', 'hẹn giờ của chữ cũ không được ẩn chữ mới');
  second(); assert.equal(b2.current(), null, 'hết giờ thì tự ẩn');
  global.setTimeout = realST;
  console.log('Chữ chào mừng: tất cả kiểm tra nền đều đạt');
})().catch(e => { console.error('THẤT BẠI:', e); process.exit(1); });
