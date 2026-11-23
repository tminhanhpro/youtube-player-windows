'use strict';
/**
 * Phát hiệu ứng âm thanh riêng (bảng hiệu ứng). Mỗi lần bấm là một Audio mới nên nhiều hiệu ứng phát chồng lên nhau được.
 * Dùng: const sfx = window.createSfx({ onChange: n => ... }); sfx.play({ key, url, vol }); sfx.stopAll(); sfx.setSink(deviceId)
 * onChange(n) (tuỳ chọn): gọi mỗi khi số hiệu ứng đang phát thay đổi (để app hạ nhạc nền khi n > 0).
 */
(function () {
  const MAX_PLAYING = 8;      // tối đa số hiệu ứng phát cùng lúc; quá thì cắt cái cũ nhất
  const STOP_FADE_MS = 200;   // "dừng hết" nhỏ dần trong 0,2 giây cho khỏi bụp

  function createSfx(opts) {
    let playing = [];         // { el, key }
    let sink = null, lastN = 0;
    const notify = () => {
      if (playing.length === lastN) return;
      lastN = playing.length;
      if (opts && typeof opts.onChange === 'function') { try { opts.onChange(lastN); } catch (e) { /* bỏ qua */ } }
    };

    const drop = el => { playing = playing.filter(p => p.el !== el); notify(); };
    function kill(p) {
      drop(p.el);
      try { p.el.pause(); } catch (e) { /* bỏ qua */ }
      try { p.el.removeAttribute('src'); p.el.load && p.el.load(); } catch (e) { /* bỏ qua */ }
    }

    return {
      /** msg: { key, url, vol (0-100) }. Trả về true nếu bắt đầu phát. */
      play(msg) {
        if (!msg || typeof msg.url !== 'string' || !msg.url) return false;
        while (playing.length >= MAX_PLAYING) kill(playing[0]);
        const el = new Audio(msg.url);
        const vol = Number(msg.vol);
        el.volume = Math.min(1, Math.max(0, (Number.isFinite(vol) ? vol : 100) / 100));
        const p = { el, key: msg.key };
        playing.push(p); notify();
        el.addEventListener('ended', () => kill(p));
        el.addEventListener('error', () => kill(p));
        if (sink && typeof el.setSinkId === 'function') { try { el.setSinkId(sink).catch(() => {}); } catch (e) { /* dùng loa mặc định */ } }
        const r = el.play();
        if (r && typeof r.catch === 'function') r.catch(() => kill(p));
        return true;
      },
      /** Dừng mọi hiệu ứng đang phát (nhỏ dần 0,2 giây). */
      stopAll() {
        const list = playing.slice(); playing = []; notify();
        for (const p of list) {
          const v0 = p.el.volume, t0 = Date.now();
          const step = () => {
            const u = Math.min(1, (Date.now() - t0) / STOP_FADE_MS);
            try { p.el.volume = Math.max(0, v0 * (1 - u)); } catch (e) { /* bỏ qua */ }
            if (u < 1) setTimeout(step, 30); else kill(p);
          };
          step();
        }
      },
      count() { return playing.length; },
      /** Chọn loa (HDMI) cho các hiệu ứng phát sau này. */
      setSink(id) { sink = id || null; }
    };
  }

  window.createSfx = createSfx;
})();
