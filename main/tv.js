'use strict';

const send = (win, ch, data) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, data); } catch (e) { /* ignore */ } };

/**
 * Quản lý "màn hình lớn" (HDMI/máy chiếu):
 *  - Có thêm màn hình (chế độ Mở rộng) -> mở cửa sổ TV toàn màn hình chỉ chứa khung phát (không có giao diện 3 cột)
 *  - Rút HDMI -> đóng cửa sổ TV, khung nhỏ trên laptop tự phát tiếp (có tiếng)
 *  - Cửa sổ TV là "chủ": có tiếng + báo trạng thái về bộ não; khung nhỏ trên laptop chạy song song (tắt tiếng, tự đồng bộ)
 * Phụ thuộc được truyền vào để kiểm thử được mà không cần Electron.
 */
class TvManager {
  /** d: { screen, makeWindow(display), getDash(), ctl, getMode() } */
  constructor(d) {
    this.d = d;
    this.tv = null;
    this.tvReady = false;
    this.displayId = null;
    this.lastLoad = null;
  }

  external() {
    const dash = this.d.getDash();
    if (!dash || dash.isDestroyed()) return null;
    const host = this.d.screen.getDisplayMatching(dash.getBounds());
    return this.d.screen.getAllDisplays().find(x => x.id !== host.id) || null;
  }

  /** Gọi mỗi khi màn hình thay đổi / cửa sổ chính di chuyển / đổi cài đặt. */
  sync() {
    const want = this.d.getMode() === 'OFF' ? null : this.external();
    if (want && !this.tv) {
      const w = this.d.makeWindow(want);
      this.tv = w; this.displayId = want.id; this.tvReady = false;
      w.on('closed', () => { if (this.tv === w) { this.tv = null; this.tvReady = false; this.notifyDash(); } });
    } else if (want && this.tv && this.displayId !== want.id) {
      this.tv.setBounds(want.bounds); this.displayId = want.id;
    } else if (!want && this.tv) {
      const t = this.tv; this.tv = null; this.tvReady = false;
      try { t.destroy(); } catch (e) { /* ignore */ }
      this.notifyDash();
    }
  }

  active() { return !!this.tv && this.tvReady; }

  notifyDash() { send(this.d.getDash(), 'tv-state', { active: this.active() }); }

  masterId() {
    if (this.active()) return this.tv.webContents.id;
    const dash = this.d.getDash();
    return dash && !dash.isDestroyed() ? dash.webContents.id : null;
  }

  /** Một cửa sổ phát vừa sẵn sàng. */
  onPlayerReady(senderId) {
    const ctl = this.d.ctl;
    if (this.tv && senderId === this.tv.webContents.id) {
      this.tvReady = true;
      // cho cửa sổ TV phát tiếp đúng bài/vị trí đang phát
      if (this.lastLoad && ctl.current) {
        send(this.tv, 'player', {
          ...this.lastLoad, startMs: ctl.pos, paused: ctl.state === 'PAUSED' || ctl.userPaused, volume: ctl.volume
        });
      }
    }
    this.notifyDash();
  }

  /** Báo cáo từ trình phát: chỉ nhận từ cửa sổ "chủ". Trả về true nếu được nhận. */
  onPlayerEvent(senderId, e) {
    if (senderId !== this.masterId()) return false;
    const ctl = this.d.ctl;
    ctl.playerEvent(e.kind, e.key, e.a, e.b);
    if (this.active() && e.kind === 'pos') send(this.d.getDash(), 'player', { type: 'sync', ms: e.a, paused: ctl.state === 'PAUSED' });
    return true;
  }

  /** Mọi lệnh phát từ bộ não đi qua đây để nhớ bài hiện tại. */
  onCtlPlayer(cmd) {
    if (cmd.type === 'load') this.lastLoad = cmd;
    else if (cmd.type === 'stop') this.lastLoad = null;
  }

  /** Gửi lệnh tới mọi cửa sổ phát (laptop + TV). */
  broadcastPlayer(cmd) {
    send(this.d.getDash(), 'player', cmd);
    if (this.tv) send(this.tv, 'player', cmd);
  }

  destroy() { if (this.tv) { try { this.tv.destroy(); } catch (e) { /* ignore */ } this.tv = null; } }
}

module.exports = { TvManager };
