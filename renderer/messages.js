'use strict';
/**
 * Tin nhắn chữ chạy gửi từ điện thoại (port từ MessageView.kt): thẻ màu (tên người gửi + nội dung)
 * chạy từ phải sang trái; 3 làn để nhiều tin không đè nhau; mỗi tin vẽ sẵn một lần; hết tin thì dừng vòng vẽ.
 */
(function () {
  const PALETTE = [
    ['rgba(233,30,99,.9)', '#FFB3CF'], ['rgba(3,155,229,.9)', '#B3E5FC'], ['rgba(126,87,194,.9)', '#D1C4E9'],
    ['rgba(46,158,79,.9)', '#C8F5D4'], ['rgba(245,124,0,.9)', '#FFE0B2']
  ];
  const LANE_Y = [0.20, 0.31, 0.42];
  const FONT = '"Segoe UI","Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

  window.createMessages = function (container) {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    container.appendChild(cv);
    const ctx = cv.getContext('2d');
    let W = 1920, H = 1080, dpr = 1, running = false, last = 0, hue = 0;
    const active = [], pending = [], laneTail = [-1e9, -1e9, -1e9];

    function resize() {
      const r = container.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(container);

    // vẽ sẵn thẻ tin nhắn vào canvas nhỏ (kích thước theo màn hình hiện tại)
    function render(sender, text) {
      const unit = Math.min(W, H) * dpr;
      const msgSize = unit * 0.062, nameSize = msgSize * 0.5, padX = msgSize * 0.8, padY = msgSize * 0.38;
      const pal = PALETTE[hue % PALETTE.length];
      const name = sender.trim();
      const tmp = document.createElement('canvas').getContext('2d');
      tmp.font = 'bold ' + msgSize + 'px ' + FONT; const mw = tmp.measureText(text).width;
      tmp.font = 'bold ' + nameSize + 'px ' + FONT; const nw = name ? tmp.measureText(name).width : 0;
      const w = Math.min(Math.ceil(Math.max(mw, nw) + padX * 2), Math.round(W * dpr * 3));
      const nameH = name ? nameSize * 1.25 : 0;
      const h = Math.ceil(padY * 2 + nameH + msgSize * 1.2);
      const b = document.createElement('canvas'); b.width = w; b.height = h;
      const c = b.getContext('2d');
      const rr = h / 2;
      c.beginPath();
      if (c.roundRect) c.roundRect(3, 3, w - 6, h - 6, rr); else c.rect(3, 3, w - 6, h - 6);
      c.fillStyle = pal[0]; c.fill();
      c.lineWidth = Math.max(3, dpr * 2); c.strokeStyle = pal[1]; c.stroke();
      let y = padY;
      c.textBaseline = 'alphabetic';
      if (name) {
        y += nameSize; c.font = 'bold ' + nameSize + 'px ' + FONT; c.fillStyle = pal[1];
        c.fillText(name, padX, y); y += nameSize * 0.25;
      }
      y += msgSize * 0.95;
      c.font = 'bold ' + msgSize + 'px ' + FONT; c.fillStyle = '#fff';
      c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = msgSize * 0.06; c.shadowOffsetY = msgSize * 0.04;
      c.fillText(text, padX, y);
      return b;
    }

    function frame(now) {
      const dt = last === 0 ? 0.016 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = W * dpr, h = H * dpr, speed = w * 0.17; // ~11 giây chạy hết một màn hình 1920 px
      ctx.clearRect(0, 0, cv.width, cv.height);
      // đưa tin chờ vào làn nào đã trống
      for (let lane = 0; lane < 3 && pending.length; lane++) {
        if (laneTail[lane] < w * 0.88) {
          const m = pending.shift(); m.lane = lane; m.x = w + 10; laneTail[lane] = m.x + m.bmp.width; active.push(m);
        }
      }
      laneTail[0] = laneTail[1] = laneTail[2] = -1e9;
      for (let i = active.length - 1; i >= 0; i--) {
        const m = active[i];
        m.x -= speed * dt;
        if (m.x + m.bmp.width < -20) { active.splice(i, 1); continue; }
        laneTail[m.lane] = Math.max(laneTail[m.lane], m.x + m.bmp.width);
        ctx.drawImage(m.bmp, m.x, h * LANE_Y[m.lane] - m.bmp.height / 2);
      }
      if (active.length || pending.length) requestAnimationFrame(frame);
      else { running = false; last = 0; ctx.clearRect(0, 0, cv.width, cv.height); }
    }

    return {
      show(sender, text) {
        const t = String(text || '').trim();
        if (!t) return;
        if (pending.length >= 8) pending.shift();
        pending.push({ bmp: render(String(sender || ''), t), lane: 0, x: 0 });
        hue++;
        if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
      },
      get running() { return running; },
      get count() { return active.length + pending.length; }
    };
  };

  /** Lớp hiệu ứng đầy đủ: hiệu ứng cổ vũ + tin nhắn chạy. */
  window.createFx = function (container) {
    const rx = window.createReactions(container);
    const ms = window.createMessages(container);
    return { react: id => rx.fire(id), message: (s, t) => ms.show(s, t), reactions: rx, messages: ms };
  };
})();
