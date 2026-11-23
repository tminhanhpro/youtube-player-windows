'use strict';
// Tự hạ nhạc khi hiệu ứng âm thanh riêng đang phát: hạ/trả đúng mức, độc lập với nút MC, không chen vào fade out, hẹn giờ an toàn.
const assert = require('assert'), os = require('os'), path = require('path'), fs = require('fs');
const { Store, Settings } = require('../main/store');
const { Controller } = require('../main/controller');
const resolver = require('../main/resolver');

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'sfxd-'))), settings = new Settings(store);
  settings.seedAutoplay = false; settings.duckLevel = 20; settings.fadeOutSec = 2; settings.fadeInSec = 0;
  assert.equal(settings.sfxDuck, false, 'mặc định TẮT');
  settings.sfxDuck = true; assert.equal(settings.sfxDuck, true); settings.sfxDuck = 'x'; assert.equal(settings.sfxDuck, true, 'luôn là bool');
  const ctl = new Controller(settings, store, path.join(__dirname, '..', 'main', 'seed.json'));
  resolver.resolve = async vid => ({ sources: [{ video: { url: 'http://x/' + vid }, audio: null, height: 720 }], expiresAt: Date.now() + 1e6, title: 'T', channel: 'C', durationSec: 100 });
  const cmds = []; ctl.on('player', c => cmds.push(c));
  const gains = () => cmds.filter(c => c.type === 'gain');
  ctl.attachPlayer(true);
  ctl.add('aaaaaaaaaaa', 'A', '', 100, 'u', 'end', false);
  await sleep(50);
  ctl.playerEvent('started', cmds.filter(c => c.type === 'load').pop().key);
  assert.equal(ctl.state, 'PLAYING');

  // hiệu ứng bắt đầu: nhạc hạ còn 20% nhanh; không hiện cờ "MC nói"
  ctl.setSfxDuck(true); let g = gains().pop();
  assert.equal(g.target, 0.2); assert.equal(g.ms, 300); assert.equal(ctl.snapshot().duck, false, 'không giả làm MC');
  const n = gains().length; ctl.setSfxDuck(true); assert.equal(gains().length, n, 'báo lại khi đã hạ: không gửi lệnh thừa');
  ctl.setSfxDuck(false); g = gains().pop(); assert.equal(g.target, 1); assert.equal(g.ms, 800, 'trả nhạc từ từ');

  // MC đang giữ: hiệu ứng hết thì nhạc vẫn nhỏ (MC chưa nhả); đổi lại MC nhả mà hiệu ứng còn chạy thì vẫn nhỏ
  ctl.setDuck(true); const a = gains().length;
  ctl.setSfxDuck(true); assert.equal(gains().length, a, 'đã hạ vì MC: hiệu ứng không gửi thêm lệnh');
  ctl.setSfxDuck(false); assert.equal(gains().length, a); assert.equal(gains().pop().target, 0.2); assert.equal(ctl.snapshot().duck, true);
  ctl.setSfxDuck(true); ctl.setDuck(false); assert.equal(gains().length, a, 'MC nhả nhưng hiệu ứng còn chạy: giữ nhỏ');
  assert.equal(ctl.gainTarget(), 0.2);
  ctl.setSfxDuck(false); assert.equal(gains().pop().target, 1, 'hết cả hai mới trả nhạc');

  // đổi mức hạ trong cài đặt khi đang hạ vì hiệu ứng
  ctl.setSfxDuck(true); settings.duckLevel = 40; ctl.refreshGain(); assert.equal(gains().pop().target, 0.4); settings.duckLevel = 20; ctl.setSfxDuck(false);

  // đang fade out: không chen vào; cửa sổ mở muộn nhận đúng mức
  assert.equal(ctl.fadeOut(), 'start'); const f = gains().length;
  ctl.setSfxDuck(true); assert.equal(gains().length, f, 'đang fade out: không gửi lệnh gain'); ctl.setSfxDuck(false);
  ctl.fadeOut(); await sleep(700); // huỷ fade
  ctl.setSfxDuck(true); assert.equal(ctl.currentGain(), 0.2); ctl.setSfxDuck(false); assert.equal(ctl.currentGain(), 1);

  // hẹn giờ an toàn: hiệu ứng "kẹt" (cửa sổ phát đóng đột ngột) thì tự trả nhạc; mỗi lần báo lại thì gia hạn
  const realST = global.setTimeout; const timers = [];
  global.setTimeout = (fn, ms, ...a2) => { const t = realST(fn, ms, ...a2); timers.push({ t, ms, fn }); return t; };
  ctl.setSfxDuck(true);
  const wd = timers.filter(x => x.ms === 180000).pop(); assert.ok(wd, 'có hẹn giờ an toàn 3 phút');
  global.setTimeout = realST;
  wd.fn(); assert.equal(ctl.sfxDuck, false, 'hết hẹn giờ thì trả nhạc'); assert.equal(gains().pop().target, 1);
  ctl.stop();
  console.log('sfx-duck-test OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
