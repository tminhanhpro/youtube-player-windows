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
  get qrHidden() { return this.s.get('qrHidden', false); }
  set qrHidden(v) { this.s.set('qrHidden', !!v); }
  // AUTO: có màn hình ngoài thì xuất ra; OFF: không bao giờ xuất
  get tvOutput() { return this.s.get('tvOutput', 'AUTO'); }
  set tvOutput(v) { this.s.set('tvOutput', v === 'OFF' ? 'OFF' : 'AUTO'); }
  get token() {
    let t = this.s.get('token', null);
    if (!t) { t = newToken(); this.s.set('token', t); }
    return t;
  }
  set token(v) { this.s.set('token', v); }
}

module.exports = { Store, Settings };
