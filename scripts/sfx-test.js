'use strict';
// Kiểm thử "Bảng hiệu ứng riêng" (phần lưu trữ, không cần Electron): thêm file, làm sạch, đổi tên/âm lượng, xoá, sắp xếp, file mất.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Soundboard, sanitize, MAX_ITEMS, DEFAULT_ICON } = require('../main/sfx');

const mem = () => { const m = {}; return { get: (k, d) => (m[k] === undefined ? d : m[k]), set: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)); } }; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-'));
const mk = n => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return p; };

const a = mk('vo_tay.mp3'), b = mk('reo_ho.wav'), v = mk('clip.mp4'), t = mk('ghi_chu.txt');
const sb = new Soundboard(mem());

assert.deepEqual(sb.list(), [], 'ban đầu trống');

// thêm: nhận nhạc, bỏ video / txt / đường dẫn tương đối / không có thật / trùng
let r = sb.addFiles([a, b, v, t, 'rel/x.mp3', path.join(dir, 'khong_co.mp3'), a, 42, null]);
assert.equal(r.added.length, 2); assert.equal(r.skipped, 7); assert.equal(r.full, false);
assert.equal(r.added[0].name, 'vo tay', 'tên lấy từ file, gạch dưới thành khoảng trắng');
assert.equal(r.added[0].icon, DEFAULT_ICON); assert.equal(r.added[0].vol, 100);
assert.equal(sb.list().length, 2); assert.ok(sb.list().every(x => x.missing === false));
assert.equal(sb.addFiles([a]).added.length, 0, 'thêm lại file cũ thì không tạo nút thừa');

const [x, y] = sb.list();

// đổi tên / biểu tượng / âm lượng
let u = sb.update(x.id, { name: '  Vỗ tay  lớn ', icon: '👏xyz', vol: 150, file: '/etc/passwd', id: 'sHACK' });
assert.equal(u.name, 'Vỗ tay lớn'); assert.equal(u.icon.length >= 1 && Array.from(u.icon).length, 2, 'icon tối đa 2 ký tự');
assert.equal(u.vol, 100, 'âm lượng kẹp 0..100'); assert.equal(u.file, a, 'không đổi được file'); assert.equal(u.id, x.id, 'không đổi được id');
assert.equal(sb.update(x.id, { vol: -5 }).vol, 0); assert.equal(sb.update(x.id, { vol: 'abc' }).vol, 0, 'vol sai kiểu thì giữ nguyên');
assert.equal(sb.update(x.id, { name: '   ' }).name, 'Vỗ tay lớn', 'tên rỗng thì giữ tên cũ');
assert.equal(sb.update(x.id, { icon: '' }).icon, DEFAULT_ICON);
assert.equal(sb.update('sNOPE12345', { name: 'a' }), null); assert.equal(sb.update(x.id, null), null);
assert.equal(sb.update(x.id, { name: 'a'.repeat(99) }).name.length, 24);

// get: chỉ trả về khi file còn
assert.equal(sb.get(x.id).file, a); assert.equal(sb.get('khong-co'), null);
fs.unlinkSync(b);
assert.equal(sb.list().find(i => i.id === y.id).missing, true, 'file mất thì có cờ missing nhưng nút vẫn còn');
assert.equal(sb.get(y.id), null, 'file mất thì không phát được');

// sắp xếp
const c = mk('c.ogg'); sb.addFiles([c]);
const ids = () => sb.list().map(i => i.id);
const [i0, i1, i2] = ids();
assert.equal(sb.move(i2, 0), true); assert.deepEqual(ids(), [i2, i0, i1]);
assert.equal(sb.move(i2, 99), true); assert.deepEqual(ids(), [i0, i1, i2]);
assert.equal(sb.move('nope', 0), false);

// xoá
assert.equal(sb.remove(i1), true); assert.equal(sb.remove(i1), false); assert.equal(sb.list().length, 2);

// dữ liệu hỏng trong file cài đặt không làm sập
const bad = mem(); bad.set('sfxList', [null, 5, { id: 'x' }, { id: 'sAbcdef', file: 'rel.mp3' }, { id: 'sGood123', file: a, name: '', vol: 'zz' }, { id: 'sGood123', file: a }]);
const sb2 = new Soundboard(bad); assert.equal(sb2.list().length, 1, 'bỏ mục hỏng và mục trùng id');
assert.equal(sb2.list()[0].name, 'vo tay'); assert.equal(sb2.list()[0].vol, 100);
assert.equal(sanitize({ id: 'sGood123', file: v }), null, 'video không phải hiệu ứng');

// giới hạn số lượng
const many = Array.from({ length: 45 }, (_, k) => mk('m' + k + '.mp3'));
const sb3 = new Soundboard(mem()); r = sb3.addFiles(many);
assert.equal(r.added.length, MAX_ITEMS); assert.equal(r.full, true); assert.equal(sb3.list().length, MAX_ITEMS);

// payload phát: có URL, âm lượng riêng; file mất / id lạ thì null
const sb4 = new Soundboard(mem()); const e1 = sb4.addFiles([a]).added[0]; sb4.update(e1.id, { vol: 40 });
const pl = sb4.playPayload(e1.id, f => 'http://127.0.0.1:1/internal/f/' + path.basename(f));
assert.equal(pl.url, 'http://127.0.0.1:1/internal/f/vo_tay.mp3'); assert.equal(pl.vol, 40); assert.equal(pl.id, e1.id); assert.ok(pl.key);
assert.notEqual(sb4.playPayload(e1.id, f => 'u').key, pl.key, 'mỗi lần phát một key riêng');
assert.equal(sb4.playPayload('sNOPE12345', f => 'u'), null); assert.equal(sb4.playPayload(e1.id, f => null), null);

fs.rmSync(dir, { recursive: true, force: true });
console.log('sfx-test OK');
