'use strict';
// Kiểm thử bộ phát hiệu ứng (renderer/sfx.js) với Audio giả: âm lượng riêng, phát chồng, giới hạn, dừng hết, lỗi phát, loa HDMI.
const assert = require('assert');
const made = [];
class FakeAudio {
  constructor(url) { this.url = url; this.volume = 1; this.paused = false; this.sinks = []; this.l = {}; made.push(this); }
  addEventListener(n, f) { this.l[n] = f; }
  play() { return this.failPlay ? Promise.reject(new Error('x')) : Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() {} load() {}
  setSinkId(id) { this.sinks.push(id); return Promise.resolve(); }
}
global.window = {}; global.Audio = FakeAudio;
require('../renderer/sfx.js');

(async () => {
  const sfx = window.createSfx();
  assert.equal(sfx.play(null), false); assert.equal(sfx.play({ url: '' }), false); assert.equal(sfx.count(), 0);
  assert.equal(sfx.play({ key: 'a', url: 'u1', vol: 40 }), true); assert.equal(made[0].volume, 0.4);
  sfx.play({ key: 'b', url: 'u2', vol: 250 }); assert.equal(made[1].volume, 1, 'kẹp 0..100');
  sfx.play({ key: 'c', url: 'u3', vol: 'zz' }); assert.equal(made[2].volume, 1, 'vol sai thì 100%');
  assert.equal(sfx.count(), 3, 'phát chồng được');
  made[0].l.ended(); assert.equal(sfx.count(), 2, 'phát xong thì bỏ');
  made[1].l.error(); assert.equal(sfx.count(), 1, 'lỗi thì bỏ');

  // giới hạn 8: cái thứ 9 cắt cái cũ nhất
  const s2 = window.createSfx(); const start = made.length;
  for (let i = 0; i < 9; i++) s2.play({ key: 'k' + i, url: 'u', vol: 100 });
  assert.equal(s2.count(), 8); assert.equal(made[start].paused, true, 'cái cũ nhất bị cắt');

  // lỗi phát (trình duyệt chặn / file hỏng) không làm treo danh sách
  FakeAudio.prototype.play = () => Promise.reject(new Error('blocked'));
  const s3 = window.createSfx(); s3.play({ url: 'u' }); await new Promise(r => setTimeout(r, 10)); assert.equal(s3.count(), 0);
  FakeAudio.prototype.play = () => Promise.resolve();

  // loa HDMI: chỉ áp cho hiệu ứng phát sau khi chọn
  const s4 = window.createSfx(); s4.play({ url: 'u' }); assert.deepEqual(made[made.length - 1].sinks, []);
  s4.setSink('hdmi-1'); s4.play({ url: 'u' }); assert.deepEqual(made[made.length - 1].sinks, ['hdmi-1']);

  // dừng hết: nhỏ dần rồi dừng thật
  const s5 = window.createSfx(); s5.play({ url: 'u1' }); s5.play({ url: 'u2' }); const m = made.slice(-2);
  s5.stopAll(); assert.equal(s5.count(), 0);
  await new Promise(r => setTimeout(r, 400));
  assert.ok(m.every(x => x.paused && x.volume === 0), 'đã dừng và về 0');
  // onChange: báo số hiệu ứng đang phát mỗi khi đổi (để hạ nhạc nền)
  const ev = []; const s6 = window.createSfx({ onChange: n => ev.push(n) });
  s6.play({ url: 'a' }); s6.play({ url: 'b' }); assert.deepEqual(ev, [1, 2]);
  const m6 = made.slice(-2); m6[0].l.ended(); assert.deepEqual(ev, [1, 2, 1], 'một cái hết thì báo 1');
  m6[1].l.error(); assert.deepEqual(ev, [1, 2, 1, 0], 'cái cuối hết thì báo 0');
  s6.play({ url: 'c' }); s6.stopAll(); assert.deepEqual(ev, [1, 2, 1, 0, 1, 0], 'dừng hết báo 0 ngay');
  await new Promise(r => setTimeout(r, 400)); assert.deepEqual(ev, [1, 2, 1, 0, 1, 0], 'không báo thừa khi nhỏ dần xong');
  const bad = window.createSfx({ onChange: () => { throw new Error('x'); } }); assert.equal(bad.play({ url: 'z' }), true, 'lỗi trong onChange không làm hỏng việc phát');
  console.log('sfx-player-test OK');
})().catch(e => { console.error(e); process.exit(1); });
