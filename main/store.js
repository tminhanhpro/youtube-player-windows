'use strict';
const fs = require('fs');
const path = require('path');
const { newToken } = require('./util');

/** Lưu cài đặt/thể loại/yêu thích/hàng đợi vào một file JSON (thay SharedPreferences của Android). */
class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch (e) { this.data = {}; }
    this._t = null;
  }
  get(k, d) { return this.data[k] === undefined ? d : this.data[k]; }
  set(k, v) { this.data[k] = v; this._saveSoon(); }
  _saveSoon() {
    if (this._t) return;
    this._t = setTimeout(() => { this._t = null; this.flush(); }, 400);
  }
  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) { /* bỏ qua */ }
  }
}

/** Các cài đặt có giá trị mặc định giống bản Android. */
class Settings {
  constructor(store) { this.s = store; }
  // AUTO | STREAM | IFRAME
  get backend() { return this.s.get('backend', 'AUTO'); }
  set backend(v) { this.s.set('backend', v); }
  get maxHeight() { return this.s.get('maxHeight', 720); }
  set maxHeight(v) { this.s.set('maxHeight', v); }
  get tickerMode() { return this.s.get('tickerMode', 'ALWAYS'); }
  set tickerMode(v) { this.s.set('tickerMode', v); }
  get tickerSpeed() { return this.s.get('tickerSpeed', 80); }
  set tickerSpeed(v) { this.s.set('tickerSpeed', v); }
  get seedAutoplay() { return this.s.get('seedAutoplay', true); }
  set seedAutoplay(v) { this.s.set('seedAutoplay', !!v); }
  get restoreQueue() { return this.s.get('restoreQueue', true); }
  set restoreQueue(v) { this.s.set('restoreQueue', !!v); }
  get gridCols() { return Math.min(3, Math.max(1, this.s.get('gridCols', 3))); }
  set gridCols(v) { this.s.set('gridCols', Math.min(3, Math.max(1, v))); }
  get fullscreenSec() { return Math.min(120, Math.max(0, this.s.get('fullscreenSec', 5))); }
  set fullscreenSec(v) { this.s.set('fullscreenSec', Math.min(120, Math.max(0, v))); }
  // MC nói: nhạc hạ còn bao nhiêu % · fade vào đầu bài · fade out khi bấm nút
  get duckLevel() { return Math.min(60, Math.max(0, Number(this.s.get('duckLevel', 20)) | 0)); }
  set duckLevel(v) { this.s.set('duckLevel', Math.min(60, Math.max(0, Number(v) | 0))); }
  // tự hạ nhạc khi hiệu ứng âm thanh riêng đang phát (mức hạ dùng chung duckLevel)
  get sfxDuck() { return !!this.s.get('sfxDuck', false); }
  set sfxDuck(v) { this.s.set('sfxDuck', !!v); }
  get fadeInSec() { return Math.min(10, Math.max(0, Number(this.s.get('fadeInSec', 2)) | 0)); }
  set fadeInSec(v) { this.s.set('fadeInSec', Math.min(10, Math.max(0, Number(v) | 0))); }
  get fadeOutSec() { return Math.min(20, Math.max(1, Number(this.s.get('fadeOutSec', 4)) | 0)); }
  set fadeOutSec(v) { this.s.set('fadeOutSec', Math.min(20, Math.max(1, Number(v) | 0))); }
  get qrHidden() { return this.s.get('qrHidden', false); }
  set qrHidden(v) { this.s.set('qrHidden', !!v); }
  // AUTO: có màn hình ngoài thì xuất ra; OFF: không bao giờ xuất
  get tvOutput() { return this.s.get('tvOutput', 'AUTO'); }
  set tvOutput(v) { this.s.set('tvOutput', v === 'OFF' ? 'OFF' : 'AUTO'); }
  // tải sẵn bài YouTube về máy: thư mục ('' = mặc định <Nhạc>\Youtube Player) và kiểu tải (video = hình + tiếng | audio = chỉ tiếng)
  get dlDir() { const v = this.s.get('dlDir', ''); return typeof v === 'string' ? v : ''; }
  set dlDir(v) { this.s.set('dlDir', typeof v === 'string' ? v.slice(0, 500) : ''); }
  get dlMode() { return this.s.get('dlMode', 'video') === 'audio' ? 'audio' : 'video'; }
  set dlMode(v) { this.s.set('dlMode', v === 'audio' ? 'audio' : 'video'); }
  get token() {
    let t = this.s.get('token', null);
    if (!t) { t = newToken(); this.s.set('token', t); }
    return t;
  }
  set token(v) { this.s.set('token', v); }
}

module.exports = { Store, Settings };
