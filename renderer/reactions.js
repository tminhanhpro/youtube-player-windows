'use strict';
/**
 * Hiệu ứng cổ vũ (thả tim, pháo giấy, pháo hoa...) vẽ bằng canvas 2D phủ lên video.
 * Port từ ReactionView.kt của bản Android (76 hiệu ứng). Dùng: const fx = createReactions(container); fx.fire('heart')
 */
(function () {
  const PI = Math.PI, TAU = Math.PI * 2;
  const MAX_PARTS = 450;
  const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const WHITE = 0xFFFFFFFF;

  const confettiColors = [0xFFFF4D8D, 0xFFFFD43B, 0xFF29D3FF, 0xFFFF9F1C, 0xFF5CE65C, 0xFFB36BFF, 0xFFFF4D4D, 0xFFFFFFFF];
  const fireColors = [0xFFFF5C8A, 0xFFFFD43B, 0xFF4DD2FF, 0xFF7CFF6B, 0xFFFF9F1C, 0xFFC77DFF, 0xFFFFFFFF];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const rad = deg => deg * PI / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rgba = (c, a) => 'rgba(' + ((c >>> 16) & 255) + ',' + ((c >>> 8) & 255) + ',' + (c & 255) + ',' + clamp(a, 0, 1) + ')';

  /** Một hạt. kind: 0 emoji, 1 giấy confetti, 3 tia lửa, 5 vòng sóng, 6 chớp sáng toàn màn hình. */
  function Part(kind, o) {
    this.kind = kind; this.emoji = null;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.g = 0; this.drag = 0;
    this.size = 0; this.size2 = 0; this.rot = 0; this.vrot = 0; this.life = 2; this.delay = 0;
    this.env = 0;            // 0: mờ dần cuối, 1: pop, 2: không đổi, 3: phồng ra rồi mờ dần
    this.color = WHITE; this.sway = 0; this.swayS = 0; this.phase = 0; this.flip = false; this.flipS = 0;
    this.wobA = 0; this.wobS = 0; this.pulse = 0; this.hopH = 0; this.hopS = 0;
    this.mt = 0; this.sx = 0; this.sy = 0; this.tx = 0; this.ty = 0; this.ease = 0;
    this.end = 0;            // 1: nổ pháo hoa, 2: va chạm (cụng ly)
    this.age = 0; this.px = 0; this.py = 0;
    if (o) Object.assign(this, o);
  }

  function ease(kind, u) {
    switch (kind) {
      case 1: { // nảy (bounce)
        let t = u;
        if (t < 1 / 2.75) return 7.5625 * t * t;
        if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
        if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
        t -= 2.625 / 2.75; return 7.5625 * t * t + 0.984375;
      }
      case 2: { // vọt qua rồi về (back)
        const c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
      }
      case 3: return u * u;   // tăng tốc dần (tên lửa)
      case 4: return u;       // đều (bay ngang màn hình)
      default: return 1 - (1 - u) * (1 - u);
    }
  }

  function createReactions(container) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let W = 1920, H = 1080, d = 2, dpr = 1;
    let parts = [], pending = [];
    let running = false, last = 0, raf = 0;
    const cache = new Map();

    function resize() {
      const r = container.getBoundingClientRect();
      W = r.width > 0 ? r.width : 1920;
      H = r.height > 0 ? r.height : 1080;
      dpr = window.devicePixelRatio || 1;
      d = Math.max(0.4, H / 540);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
    }
    resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);

    const vw = () => W, vh = () => H;
    const bigSize = () => Math.min(W, H) * 0.42;

    /** Emoji vẽ sẵn vào canvas 192x192 (cache) rồi dán lại nhiều lần. */
    function bmp(e) {
      let c = cache.get(e);
      if (c) return c;
      const s = 192;
      c = document.createElement('canvas'); c.width = s; c.height = s;
      const g = c.getContext('2d');
      g.font = (s * 0.78) + 'px ' + EMOJI_FONT;
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      const m = g.measureText(e);
      const asc = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : s * 0.78 * 0.9;
      const desc = m.fontBoundingBoxDescent != null ? m.fontBoundingBoxDescent : s * 0.78 * 0.2;
      g.fillText(e, s / 2, s / 2 + (asc - desc) / 2);
      cache.set(e, c);
      return c;
    }

    const add = p => { if (parts.length + pending.length < MAX_PARTS) pending.push(p); };

    function flush() {
      if (pending.length) { parts.push(...pending); pending = []; }
      if (parts.length && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    }

    // ---------------------------------------------------------------- builders

    /** Một emoji bay tự do (rơi, bay lên, nổ ra...). Đơn vị: px, px/s. */
    function emo(e, x, y, size, o) {
      o = o || {};
      const p = new Part(0, {
        emoji: e, x, y, size, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, drag: o.drag || 0,
        life: o.life == null ? 2 : o.life, delay: o.delay || 0, env: o.env || 0, sway: o.sway || 0,
        swayS: rnd(0.8, 2.2), phase: rnd(0, 6.28), rot: o.rot || 0, vrot: o.rotSpeed || 0
      });
      add(p);
      return p;
    }

    /** Mưa emoji rơi từ trên xuống. */
    function rain(list, count, dpMin, dpMax, spread, vMin = 230, vMax = 420) {
      for (let i = 0; i < count; i++) {
        const sz = rnd(dpMin, dpMax) * d, vy = rnd(vMin, vMax) * d;
        const life = (vh() + sz * 2) / vy;
        emo(pick(list), rnd(0, vw()), -sz, sz, { vy, life, delay: rnd(0, spread), env: 2, sway: rnd(10, 40) * d, rotSpeed: rnd(-40, 40) });
      }
    }

    /** Emoji bay từ dưới lên. */
    function rise(list, count, dpMin, dpMax, spread, vMin = 200, vMax = 380) {
      for (let i = 0; i < count; i++) {
        const sz = rnd(dpMin, dpMax) * d, vy = -rnd(vMin, vMax) * d;
        const life = (vh() + sz * 2) / -vy;
        emo(pick(list), rnd(0, vw()), vh() + sz, sz, { vy, life, delay: rnd(0, spread), env: 2, sway: rnd(12, 50) * d, rotSpeed: rnd(-25, 25) });
      }
    }

    /** Emoji khổng lồ ở giữa màn hình, nảy lên (pop) rồi mờ dần. */
    function pop(e, scale = 1, life = 2.6, o) {
      o = o || {};
      const p = new Part(0, {
        emoji: e, x: vw() / 2, y: vh() * (o.cy == null ? 0.5 : o.cy), size: bigSize() * scale, life, delay: o.delay || 0,
        env: 1, wobA: o.wobble == null ? 6 : o.wobble, wobS: 7, pulse: o.pulse || 0
      });
      add(p);
      return p;
    }

    /** Vòng sóng lan tỏa phía sau emoji khổng lồ. */
    function ring(color, delay = 0) {
      add(new Part(5, { x: vw() / 2, y: vh() / 2, size: bigSize() * 0.35, size2: bigSize() * 1.25, life: 0.9, delay, color }));
    }

    /** Chớp sáng toàn màn hình (sét, pháo sáng). */
    function flash(color, delay = 0, life = 0.45) {
      add(new Part(6, { life, delay, color, size: rnd(0, 6.28) }));
    }

    /** Hai vật bay vào từ hai bên, chạm nhau ở giữa rồi bung (cụng ly / nâng ly). */
    function clink(e) {
      const w = vw(), h = vh(), sz = bigSize() * 0.7, cy = h * 0.5, gap = sz * 0.42;
      const l = emo(e, -sz, cy, sz, { life: 2.6, env: 0 });
      Object.assign(l, { mt: 0.55, sx: -sz, sy: cy, tx: w / 2 - gap, ty: cy, ease: 2, rot: 14, end: 2 });
      const r = emo(e, w + sz, cy, sz, { life: 2.6, env: 0 });
      Object.assign(r, { mt: 0.55, sx: w + sz, sy: cy, tx: w / 2 + gap, ty: cy, ease: 2, rot: -14, flip: true });
    }

    /** Vật nặng rơi từ trên xuống, nảy (bounce) ở giữa màn hình. */
    function dropIn(e, scale, life = 3.0) {
      const w = vw(), h = vh(), sz = bigSize() * scale;
      const c = emo(e, w / 2, -sz, sz, { life, env: 0 });
      Object.assign(c, { mt: 0.9, sx: w / 2, sy: -sz, tx: w / 2, ty: h * 0.5, ease: 1 });
    }

    /** Nổ bắn ra xung quanh một điểm. */
    function burst(list, x, y, count, dpMin, dpMax, vMin = 350, vMax = 950, delay = 0, gdp = 380) {
      for (let i = 0; i < count; i++) {
        const a = rnd(0, 6.2832), v = rnd(vMin, vMax) * d, sz = rnd(dpMin, dpMax) * d;
        emo(pick(list), x, y, sz, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: gdp * d, drag: 1.7, life: rnd(1.4, 2.3), delay, env: 3, rotSpeed: rnd(-240, 240) });
      }
    }

    /** Giấy (confetti) + dải ruy băng bắn từ một góc dưới màn hình. */
    function cannon(fromLeft, count, delay) {
      const ox = fromLeft ? vw() * 0.03 : vw() * 0.97, oy = vh() * 1.02;
      for (let i = 0; i < count; i++) {
        const a = rad(rnd(52, 82)), v = rnd(1000, 2300) * d, dir = fromLeft ? 1 : -1;
        const streamer = Math.random() * 100 < 22;
        add(new Part(1, {
          x: ox, y: oy, vx: Math.cos(a) * v * dir, vy: -Math.sin(a) * v, g: 430 * d, drag: 2.2,
          size: streamer ? rnd(4, 6) * d : rnd(8, 16) * d, size2: streamer ? rnd(26, 44) * d : rnd(5, 10) * d,
          rot: rnd(0, 360), vrot: rnd(-420, 420), life: rnd(3.2, 4.8), delay: delay + rnd(0, 0.25), env: 0,
          color: pick(confettiColors), sway: rnd(10, 30) * d, swayS: rnd(1.5, 4), phase: rnd(0, 6.28), flipS: rnd(6, 14)
        }));
      }
    }

    /** Pháo hoa: tên lửa bay lên rồi nổ thành nhiều tia sáng. */
    function rocket(delay) {
      const sx = rnd(vw() * 0.15, vw() * 0.85), ty = rnd(vh() * 0.18, vh() * 0.5);
      const p = new Part(3, {
        x: sx, y: vh(), size: 3.5 * d, life: rnd(0.75, 1.05), delay, env: 2, color: WHITE,
        mt: 1, sx, sy: vh(), tx: sx + rnd(-60, 60) * d, ty, ease: 0, end: 1
      });
      p.mt = p.life;
      add(p);
    }

    function explode(x, y, c1) {
      const c2 = pick(fireColors), n = 44;
      for (let i = 0; i < n; i++) {
        const a = TAU * i / n + rnd(-0.08, 0.08), ring2 = i % 2 === 0;
        const v = (ring2 ? rnd(420, 560) : rnd(230, 330)) * d;
        add(new Part(3, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 170 * d, drag: 1.6, size: rnd(2.8, 4.6) * d, life: rnd(1.2, 1.9), env: 0, color: ring2 ? c1 : c2 }));
      }
      for (let i = 0; i < 8; i++) {
        const a = rnd(0, 6.28), v = rnd(60, 220) * d;
        add(new Part(3, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 120 * d, drag: 1.2, size: rnd(2, 3.4) * d, life: rnd(1.4, 2.2), env: 0, color: WHITE }));
      }
    }

    /** Cụng ly chạm nhau: nước/sao bung ra và giấy nổ. */
    function impact(x, y) {
      burst(['✨', '💦', '⭐'], x, y, 16, 34, 70, 300, 800);
      for (let i = 0; i < 26; i++) {
        const a = rnd(0, 6.28), v = rnd(300, 900) * d;
        add(new Part(1, {
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 250 * d, g: 430 * d, drag: 2, size: rnd(8, 14) * d, size2: rnd(5, 9) * d,
          rot: rnd(0, 360), vrot: rnd(-400, 400), life: rnd(1.8, 2.8), env: 0, color: pick(confettiColors), flipS: rnd(6, 14)
        }));
      }
    }

    // ---------------------------------------------------------------- 76 hiệu ứng
    /** Vệt hạt đi dọc đường bay (tên lửa, rồng, máy bay...). */
    const R = (n, fn) => { for (let i = 0; i < n; i++) fn(i); };
    /** Nốt nhạc bắn lên từ giữa màn hình (mic, guitar, sax...). */
    function notes(list, count, degMin, degMax, vMin, vMax, szMin, szMax, g, drag, dMin, dMax, rotMax, cy) {
      const w = vw(), h = vh();
      R(count, () => {
        const a = rad(rnd(degMin, degMax)), v = rnd(vMin, vMax) * d;
        emo(pick(list), w / 2, h * cy, rnd(szMin, szMax) * d, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: g * d, drag, life: rnd(1.8, 2.8), delay: rnd(dMin, dMax), env: 3, rotSpeed: rnd(-rotMax, rotMax) });
      });
    }

    const effects = {
      heart() {
        rain(['❤️', '💖', '💗', '💕', '💝'], 18, 70, 150, 2.0);
        rain(['❤️', '💗'], 16, 28, 56, 2.4, 300, 520);
      },
      clap() {
        const w = vw(), h = vh();
        ring(0xFFFFE066); pop('👏', 1, 2.8, { wobble: 5, pulse: 0.10 });
        burst(['✨', '⭐', '👏'], w / 2, h / 2, 16, 30, 70, 350, 950, 0.1);
        cannon(true, 22, 0.25); cannon(false, 22, 0.25);
      },
      party() {
        const w = vw(), h = vh();
        cannon(true, 70, 0); cannon(false, 70, 0); cannon(true, 40, 0.7); cannon(false, 40, 0.7);
        burst(['🎉', '🎊'], w * 0.05, h * 0.95, 5, 60, 110, 900, 1500, 0, 500);
        burst(['🎉', '🎊'], w * 0.95, h * 0.95, 5, 60, 110, 900, 1500, 0, 500);
      },
      fire() { rise(['🔥', '🔥', '🔥', '🧡'], 26, 70, 170, 1.8, 260, 520); },
      star() {
        const w = vw(), h = vh();
        ring(0xFFFFF3B0); pop('⭐', 0.9, 2.4, { wobble: 12 });
        burst(['⭐', '🌟', '✨'], w / 2, h / 2, 34, 36, 96, 450, 1100, 0.05, 300);
      },
      laugh() {
        const w = vw(), h = vh();
        pop('😂', 1, 2.6, { wobble: 9, pulse: 0.05 });
        burst(['😂', '🤣'], w / 2, h / 2, 14, 50, 100, 500, 1000, 0.1, 450);
        rain(['😂', '🤣'], 10, 50, 100, 1.6);
      },
      love() {
        ring(0xFFFF8FB5); pop('😍', 0.95, 2.6, { wobble: 6, pulse: 0.04 });
        rise(['❤️', '😍', '💘', '💖'], 22, 60, 130, 1.8);
      },
      mic() {
        pop('🎤', 0.85, 2.6, { wobble: 14 });
        notes(['🎵', '🎶', '🎼'], 22, 205, 335, 450, 1000, 48, 100, 260, 1.2, 0.1, 1.0, 90, 0.5);
      },
      rose() { rain(['🌹', '🌹', '🌸', '💮'], 28, 60, 130, 2.2, 190, 340); },
      firework() { R(6, i => rocket(i * 0.45)); },
      like() {
        const w = vw(), h = vh();
        ring(0xFF7CC8FF); pop('👍', 1, 2.6, { wobble: 8, pulse: 0.06 });
        burst(['✨', '💯', '👍'], w / 2, h / 2, 18, 36, 80, 350, 950, 0.1);
        cannon(true, 26, 0.2); cannon(false, 26, 0.2);
      },
      beer() {
        const w = vw(), h = vh(), sz = bigSize() * 0.7, cy = h * 0.5, gap = sz * 0.42;
        const l = emo('🍺', -sz, cy, sz, { life: 2.6, env: 2 });
        Object.assign(l, { mt: 0.55, sx: -sz, sy: cy, tx: w / 2 - gap, ty: cy, ease: 2, rot: 14, end: 2 });
        const r = emo('🍺', w + sz, cy, sz, { life: 2.6, env: 2 });
        Object.assign(r, { mt: 0.55, sx: w + sz, sy: cy, tx: w / 2 + gap, ty: cy, ease: 2, rot: -14, flip: true });
        l.env = 0; r.env = 0; // làm mờ dần ở cuối
      },
      crown() {
        const w = vw(), h = vh(), sz = bigSize() * 0.95;
        const c = emo('👑', w / 2, -sz, sz, { life: 3.0, env: 0 });
        Object.assign(c, { mt: 0.9, sx: w / 2, sy: -sz, tx: w / 2, ty: h * 0.5, ease: 1 });
        ring(0xFFFFD43B, 0.7);
        rain(['⭐', '✨', '🌟'], 20, 40, 90, 2.0, 200, 360);
      },
      dance() {
        const w = vw(), h = vh(), list = ['💃', '🕺'];
        R(5, i => {
          const sz = rnd(90, 140) * d, fromLeft = i % 2 === 0, speed = rnd(w * 0.18, w * 0.28);
          const p = emo(list[i % 2], fromLeft ? -sz : w + sz, h - sz * 0.7, sz, { vx: fromLeft ? speed : -speed, life: (w + sz * 2) / speed, delay: i * 0.35, env: 2 });
          p.hopH = rnd(0.35, 0.6) * sz; p.hopS = rnd(6, 9); p.wobA = 12; p.wobS = rnd(6, 9);
        });
        rise(['🎶', '🎵', '✨'], 18, 40, 90, 2.0, 180, 320);
      },
      balloon() {
        rise(['🎈'], 16, 90, 170, 2.0, 150, 300);
        rise(['🎈', '🎀'], 6, 50, 90, 2.4, 180, 340);
      },
      cry() {
        pop('😭', 0.95, 2.8, { wobble: 5, pulse: 0.03 });
        rain(['💧'], 28, 34, 62, 2.0, 260, 460);
      },

      // ======================= đợt 1 =======================
      rainbow() {
        ring(0xFFFF8A80); ring(0xFFFFEB3B, 0.15); ring(0xFF80D8FF, 0.3);
        pop('🌈', 1.15, 3.0, { wobble: 3, pulse: 0.03 });
        rise(['✨', '⭐', '🌟', '💖'], 24, 40, 90, 2.0, 180, 340);
      },
      unicorn() {
        const w = vw(), h = vh();
        ring(0xFFE1BEE7); pop('🦄', 1, 3.0, { wobble: 8, pulse: 0.04 });
        burst(['✨', '💖', '🌈', '⭐'], w / 2, h / 2, 28, 36, 90, 400, 1000, 0.1, 300);
        rise(['✨', '💜', '🌈'], 18, 40, 90, 2.2, 160, 300);
      },
      rocket() {
        // tên lửa bay chéo từ góc dưới trái lên, để lại vệt lửa, rồi nổ pháo hoa
        const w = vw(), h = vh(), sz = bigSize() * 0.55;
        const sx = w * 0.08, sy = h + sz * 0.6, tx = w * 0.55, ty = h * 0.3, mt = 1.0;
        const rk = emo('🚀', sx, sy, sz, { life: mt, env: 2 });
        Object.assign(rk, { mt, sx, sy, tx, ty, ease: 3, end: 1, rot: Math.atan2(ty - sy, tx - sx) * 180 / PI + 45 });
        R(26, i => {
          const u = i / 26, e = u * u;
          emo(i % 3 === 0 ? '✨' : '🔥', sx + (tx - sx) * e, sy + (ty - sy) * e, rnd(30, 62) * d, { life: 0.7, delay: mt * u, env: 0 });
        });
        flash(0x66FFD54F, mt, 0.3);
        burst(['⭐', '✨', '🌟'], tx, ty, 26, 36, 84, 350, 950, mt, 260);
        R(3, i => rocket(mt + 0.15 + i * 0.35));
      },
      lightning() {
        const w = vw(), h = vh();
        flash(0xBBFFFFFF, 0, 0.5); flash(0x99FFF59D, 0.55, 0.4);
        ring(0xFFFFF176); pop('⚡', 1.1, 2.4, { wobble: 4, pulse: 0.09 });
        burst(['⚡', '✨', '💥'], w / 2, h / 2, 22, 40, 100, 500, 1200, 0.05, 300);
        rain(['⚡'], 10, 50, 100, 1.2, 500, 800);
      },
      snow() { rain(['❄️', '❄️', '❄️', '✨', '⛄'], 46, 30, 84, 3.0, 90, 190); },
      sakura() { rain(['🌸', '🌸', '🌸', '💮'], 48, 26, 74, 3.0, 100, 220); },
      butterfly() {
        rise(['🦋'], 22, 56, 120, 2.6, 90, 210);
        rise(['🌸', '✨'], 14, 26, 50, 2.4, 120, 240);
      },
      diamond() {
        const w = vw(), h = vh();
        ring(0xFF80DEEA); ring(0xFFE0F7FA, 0.2); pop('💎', 1, 2.8, { wobble: 7, pulse: 0.05 });
        burst(['💎', '✨', '💠'], w / 2, h / 2, 26, 36, 90, 400, 1050, 0.1, 320);
        rain(['✨', '💎'], 16, 30, 70, 2.0, 200, 340);
      },
      trophy() {
        dropIn('🏆', 1); ring(0xFFFFD43B, 0.7);
        cannon(true, 36, 0.75); cannon(false, 36, 0.75);
        rain(['⭐', '✨', '🌟'], 14, 36, 80, 2.0, 200, 340);
      },
      champagne() {
        const w = vw(), h = vh();
        pop('🍾', 0.9, 2.6, { wobble: 14 });
        burst(['💦', '✨', '🥂', '⭐'], w / 2, h * 0.34, 30, 34, 80, 500, 1300, 0.25, 420);
        cannon(true, 30, 0.3); cannon(false, 30, 0.3);
        flash(0x55FFFFFF, 0.25, 0.25);
      },
      cheers() {
        clink('🥂');
        rise(['✨', '🥂', '⭐'], 14, 36, 80, 2.0, 160, 300);
      },
      guitar() {
        pop('🎸', 0.9, 2.8, { wobble: 16, pulse: 0.03 });
        notes(['🎵', '🎶', '🎼', '✨'], 30, 190, 350, 450, 1100, 44, 96, 260, 1.2, 0.1, 1.3, 110, 0.5);
      },
      drum() {
        const w = vw(), h = vh();
        pop('🥁', 0.95, 2.8, { wobble: 3, pulse: 0.14 });
        R(5, i => ring(confettiColors[i % confettiColors.length], i * 0.28));
        burst(['🎵', '💥', '✨'], w / 2, h / 2, 20, 36, 84, 400, 1000, 0.2, 320);
      },
      cool() {
        const w = vw(), h = vh();
        dropIn('😎', 0.95, 2.8); ring(0xFF80D8FF, 0.75);
        burst(['💯', '✨', '😎', '🔥'], w / 2, h / 2, 22, 36, 86, 450, 1100, 0.8, 320);
      },
      partyface() {
        pop('🥳', 1, 2.8, { wobble: 8, pulse: 0.05 });
        cannon(true, 50, 0.1); cannon(false, 50, 0.1);
        rise(['🎈', '🎉', '🎊'], 14, 60, 120, 2.0, 180, 340);
      },
      wow() {
        const w = vw(), h = vh();
        ring(0xFFFFF3B0); ring(0xFFFFCC80, 0.2); pop('🤩', 1, 2.6, { wobble: 6, pulse: 0.09 });
        burst(['⭐', '🌟', '✨', '💫'], w / 2, h / 2, 36, 34, 96, 450, 1150, 0.05, 300);
      },
      kiss() {
        pop('😘', 0.95, 2.6, { wobble: 7, pulse: 0.04 });
        rise(['💋', '💕', '❤️', '😘', '💖'], 26, 50, 120, 2.0, 200, 380);
      },
      ghost() {
        pop('👻', 0.95, 2.8, { wobble: 12, pulse: 0.03 });
        rise(['👻', '🎃', '🦇'], 14, 56, 120, 2.4, 120, 240);
        flash(0x33B388FF, 0, 0.5);
      },
      cake() {
        pop('🎂', 1, 3.0, { wobble: 5, pulse: 0.04 });
        cannon(true, 36, 0.15); cannon(false, 36, 0.15);
        rise(['🎈', '🎁', '🎉'], 14, 56, 110, 2.2, 170, 320);
      },
      money() {
        pop('🤑', 0.85, 2.4, { wobble: 7, pulse: 0.05 });
        rain(['💰', '💵', '💎', '💵'], 34, 50, 110, 2.2, 300, 540);
      },

      // ======================= đợt 2 =======================
      meteor() {
        // 3 sao băng rơi chéo từ góc trên phải, để lại vệt sáng, chạm đất thì bung nổ
        const w = vw(), h = vh(), big = bigSize();
        R(3, i => {
          const sz = big * 0.5, tx = w * (0.28 + 0.22 * i), ty = h * (0.5 + 0.06 * i);
          const sy = -sz, sx = tx + (ty - sy), mt = 0.85, dl = i * 0.45;
          const m = emo('☄️', sx, sy, sz, { life: mt, delay: dl, env: 2 });
          Object.assign(m, { mt, sx, sy, tx, ty, ease: 3 });
          R(14, k => {
            const u = k / 14, e = u * u;
            emo(k % 3 === 0 ? '✨' : '🔥', sx + (tx - sx) * e, sy + (ty - sy) * e, rnd(26, 54) * d, { life: 0.6, delay: dl + mt * u, env: 0 });
          });
          flash(0x55FFB74D, dl + mt, 0.3);
          burst(['💥', '🔥', '✨', '⭐'], tx, ty, 16, 34, 80, 350, 900, dl + mt, 300);
        });
      },
      sun() {
        const w = vw(), h = vh();
        ring(0xFFFFB74D); ring(0xFFFFE082, 0.2); ring(0xFFFFF3B0, 0.4);
        const p = pop('☀️', 1.1, 3.0, { wobble: 2, pulse: 0.04 }); p.vrot = 22;
        flash(0x44FFE082, 0, 0.5);
        burst(['✨', '🌞', '⭐', '🌟'], w / 2, h / 2, 26, 34, 84, 400, 1000, 0.1, 260);
      },
      moon() {
        ring(0xFFB3C7FF); pop('🌙', 1, 3.2, { wobble: 6, pulse: 0.03 });
        rain(['⭐', '✨', '🌟', '💫'], 30, 30, 70, 2.6, 80, 170);
      },
      whale() {
        const w = vw(), h = vh(), sz = bigSize() * 0.85, y0 = h * 0.58;
        const wh = emo('🐳', -sz, y0, sz, { life: 3.2, env: 2, rot: -4 });
        Object.assign(wh, { mt: 3.2, sx: -sz, sy: y0, tx: w + sz, ty: y0, ease: 4, wobA: 6, wobS: 2.5 });
        R(9, i => {
          const u = (i + 1) / 10;
          burst(['💦', '💧', '✨'], -sz + (w + 2 * sz) * u, y0 - sz * 0.35, 5, 28, 56, 160, 520, 3.2 * u, 520);
        });
        rise(['💧', '🐟', '💦'], 18, 34, 70, 2.4, 140, 280);
      },
      dolphin() {
        const w = vw(), h = vh();
        R(3, i => {
          const sz = rnd(100, 150) * d, speed = rnd(w * 0.22, w * 0.3);
          const p = emo('🐬', -sz, h * (0.78 - i * 0.06), sz, { vx: speed, life: (w + sz * 2) / speed, delay: i * 0.45, env: 2 });
          p.hopH = rnd(0.9, 1.5) * sz * 1.8; p.hopS = rnd(2.2, 3.0); p.flip = true;
        });
        rise(['💦', '💧', '🌊', '✨'], 22, 36, 76, 2.2, 150, 300);
      },
      pizza() { rain(['🍕', '🍕', '🍕', '🧀', '🍅'], 30, 56, 120, 2.2, 220, 400); },
      icecream() { rain(['🍦', '🍨', '🍧', '🍭', '🍦'], 30, 52, 112, 2.2, 200, 380); },
      popcorn() {
        pop('🍿', 0.85, 2.6, { wobble: 8, pulse: 0.05 });
        notes(['🍿', '🌽', '✨', '🍿'], 40, 215, 325, 600, 1500, 36, 84, 700, 0.8, 0.1, 1.2, 200, 0.55);
      },
      gift() {
        const w = vw(), h = vh();
        dropIn('🎁', 0.95, 3.0); ring(0xFFFF8FB5, 0.85); flash(0x55FFFFFF, 0.9, 0.3);
        burst(['🎀', '🎉', '✨', '💖', '🎊'], w / 2, h / 2, 28, 36, 90, 450, 1100, 0.9, 320);
        cannon(true, 30, 0.9); cannon(false, 30, 0.9);
      },
      sax() {
        pop('🎷', 0.9, 2.8, { wobble: 12, pulse: 0.03 });
        notes(['🎵', '🎶', '🎼', '✨', '🎷'], 32, 190, 350, 450, 1100, 40, 90, 240, 1.2, 0.1, 1.3, 100, 0.5);
      },
      trumpet() {
        const w = vw(), h = vh();
        ring(0xFFFFD43B); ring(0xFFFFF3B0, 0.25); pop('🎺', 0.9, 2.6, { wobble: 10, pulse: 0.08 });
        cannon(true, 36, 0.2); cannon(false, 36, 0.2);
        burst(['🎶', '🎵', '⭐', '✨'], w / 2, h / 2, 22, 36, 84, 450, 1100, 0.15, 300);
      },
      dragon() {
        const w = vw(), h = vh(), sz = bigSize() * 0.8, y0 = h * 0.35, y1 = h * 0.6;
        const dr = emo('🐉', -sz, y0, sz, { life: 2.6, env: 2 });
        Object.assign(dr, { mt: 2.6, sx: -sz, sy: y0, tx: w + sz, ty: y1, ease: 4, wobA: 5, wobS: 4 });
        R(34, i => {
          const u = i / 34;
          emo(i % 4 === 0 ? '✨' : '🔥', -sz + (w + 2 * sz) * u - sz * 0.45, y0 + (y1 - y0) * u, rnd(34, 74) * d, { vy: rnd(-60, 60) * d, life: 0.8, delay: 2.6 * u, env: 0 });
        });
        flash(0x44FF7043, 0, 0.5);
        rise(['🔥', '✨'], 14, 40, 90, 2.0, 200, 380);
      },
      catlove() {
        pop('😻', 0.95, 2.8, { wobble: 7, pulse: 0.05 });
        rise(['💖', '💕', '🐾', '❤️', '😻'], 26, 46, 110, 2.2, 190, 360);
      },
      skull() {
        pop('💀', 0.95, 2.6, { wobble: 9, pulse: 0.05 });
        rain(['💀', '☠️', '😂', '💀'], 26, 50, 104, 2.0, 260, 460);
        flash(0x33B388FF, 0, 0.4);
      },
      ufo() {
        const w = vw(), h = vh(), sz = bigSize() * 0.6, y0 = h * 0.18, y1 = h * 0.3;
        const u0 = emo('🛸', -sz, y0, sz, { life: 2.8, env: 2 });
        Object.assign(u0, { mt: 2.8, sx: -sz, sy: y0, tx: w + sz, ty: y1, ease: 4, wobA: 8, wobS: 5 });
        R(26, i => {
          const u = i / 26;
          emo(i % 2 === 0 ? '✨' : '💫', -sz + (w + 2 * sz) * u, y0 + (y1 - y0) * u + sz * 0.4, rnd(28, 60) * d, { vy: rnd(120, 260) * d, life: 1.2, delay: 2.8 * u, env: 0 });
        });
        rise(['👽', '✨', '🌟'], 12, 56, 110, 2.4, 150, 280);
      },
      clover() { rain(['🍀', '🍀', '🍀', '✨', '🍃'], 40, 36, 90, 2.8, 110, 240); },
      firecracker() {
        const w = vw(), h = vh();
        pop('🧨', 0.7, 1.0, { wobble: 12, pulse: 0.1 });
        R(8, i => {
          const bx = rnd(w * 0.15, w * 0.85), by = rnd(h * 0.2, h * 0.7);
          flash(0x55FFCC80, 0.9 + i * 0.14, 0.15);
          burst(['💥', '✨', '🔥', '⭐'], bx, by, 8, 30, 70, 300, 800, 0.9 + i * 0.14, 260);
        });
        cannon(true, 24, 1.0); cannon(false, 24, 1.0);
        R(3, i => rocket(1.2 + i * 0.4));
      },
      bomb() {
        const w = vw(), h = vh();
        pop('💣', 0.8, 1.2, { wobble: 10, pulse: 0.12 });
        flash(0xCCFFFFFF, 1.05, 0.4); flash(0x99FF8A65, 1.45, 0.4);
        ring(0xFFFF8A65, 1.05); ring(0xFFFFD43B, 1.2);
        pop('💥', 1.2, 1.6, { wobble: 4, pulse: 0.08, delay: 1.05 });
        burst(['💥', '🔥', '✨', '⭐'], w / 2, h / 2, 34, 36, 96, 500, 1300, 1.05, 320);
      },
      hundred() {
        const w = vw(), h = vh();
        ring(0xFFFF5252); ring(0xFFFF8A80, 0.2); pop('💯', 1.1, 2.6, { wobble: 6, pulse: 0.1 });
        cannon(true, 30, 0.15); cannon(false, 30, 0.15);
        burst(['💯', '🔥', '✨'], w / 2, h / 2, 22, 36, 86, 450, 1100, 0.15, 300);
      },
      muscle() {
        const w = vw(), h = vh();
        ring(0xFFFFB74D); pop('💪', 1, 2.6, { wobble: 10, pulse: 0.09 });
        burst(['💪', '🔥', '✨', '💥'], w / 2, h / 2, 24, 36, 90, 450, 1100, 0.1, 300);
        rise(['🔥', '💪'], 12, 50, 100, 1.8, 220, 400);
      },

      // ======================= đợt 3 =======================
      volcano() {
        const w = vw(), h = vh();
        flash(0x44FF7043, 0, 0.5);
        pop('🌋', 0.95, 3.2, { wobble: 3, pulse: 0.03, cy: 0.62 });
        R(6, i => {
          burst(['🔥', '💥', '✨', '🧡'], w / 2, h * 0.42, 14, 34, 84, 400, 1200, 0.2 + i * 0.28, 520);
          flash(0x33FF8A65, 0.2 + i * 0.28, 0.15);
        });
        rise(['🔥', '✨'], 16, 40, 90, 2.2, 200, 380);
      },
      wave() {
        const w = vw(), h = vh(), sz = bigSize() * 0.8;
        R(3, i => {
          const y = h * (0.52 + 0.15 * i);
          const v = emo('🌊', -sz, y, sz, { life: 2.6, delay: i * 0.3, env: 2 });
          Object.assign(v, { mt: 2.6, sx: -sz, sy: y, tx: w + sz, ty: y, ease: 4, wobA: 4, wobS: 3 });
        });
        rise(['💦', '💧', '🐚', '🐟'], 22, 34, 74, 2.4, 140, 290);
      },
      galaxy() {
        ring(0xFFB39DDB); ring(0xFF80DEEA, 0.25); flash(0x33B388FF, 0, 0.5);
        pop('🌌', 1.15, 3.4, { wobble: 2, pulse: 0.03 });
        rain(['⭐', '✨', '🌟', '💫', '🌠'], 34, 30, 74, 2.8, 80, 180);
      },
      sparkler() { R(10, i => rocket(i * 0.3)); },
      lantern() {
        flash(0x33FFB74D, 0, 0.5);
        rise(['🏮'], 18, 70, 150, 2.6, 100, 220);
        rise(['✨', '🧧', '🌟'], 14, 30, 60, 2.6, 120, 240);
      },
      lixi() { rain(['🧧', '🧧', '💰', '💵', '✨'], 34, 56, 120, 2.4, 220, 400); },
      xmas() {
        ring(0xFF81C784); ring(0xFFE57373, 0.2); pop('🎄', 1, 3.0, { wobble: 3, pulse: 0.03 });
        rain(['❄️', '🎁', '⭐', '🔔', '❄️'], 36, 34, 84, 2.6, 110, 240);
      },
      tiger() {
        const w = vw(), h = vh();
        flash(0x66FFB74D, 0, 0.35); ring(0xFFFF9800); ring(0xFFFFE082, 0.2);
        pop('🐯', 1, 2.6, { wobble: 10, pulse: 0.1 });
        burst(['💥', '🔥', '🐾', '✨'], w / 2, h / 2, 26, 36, 90, 450, 1200, 0.1, 300);
      },
      panda() {
        pop('🐼', 0.95, 2.8, { wobble: 8, pulse: 0.04 });
        rain(['🎋', '🐼', '🍃', '💚'], 26, 44, 100, 2.2, 150, 300);
      },
      frog() {
        const w = vw(), h = vh();
        R(5, i => {
          const sz = rnd(80, 130) * d, fromLeft = i % 2 === 0, speed = rnd(w * 0.16, w * 0.24);
          const p = emo('🐸', fromLeft ? -sz : w + sz, h - sz * 0.7, sz, { vx: fromLeft ? speed : -speed, life: (w + sz * 2) / speed, delay: i * 0.35, env: 2 });
          p.hopH = rnd(1.0, 1.8) * sz; p.hopS = rnd(3.5, 5);
        });
        rain(['💧', '🍃'], 16, 30, 60, 2.0, 200, 340);
      },
      eagle() {
        const w = vw(), h = vh(), sz = bigSize() * 0.7, y0 = h * 0.2, y1 = h * 0.38;
        const e = emo('🦅', -sz, y0, sz, { life: 2.6, env: 2 });
        Object.assign(e, { mt: 2.6, sx: -sz, sy: y0, tx: w + sz, ty: y1, ease: 4, wobA: 5, wobS: 3, flip: true });
        R(26, i => {
          const u = i / 26;
          emo(i % 2 === 0 ? '✨' : '🍃', -sz + (w + 2 * sz) * u - sz * 0.4, y0 + (y1 - y0) * u, rnd(28, 60) * d, { vy: rnd(40, 140) * d, life: 1.1, delay: 2.6 * u, env: 0 });
        });
        rise(['🍃', '✨', '☁️'], 12, 40, 90, 2.2, 150, 280);
      },
      burger() { rain(['🍔', '🍟', '🍔', '🌭', '🥤'], 32, 56, 120, 2.2, 220, 400); },
      coffee() {
        pop('☕', 0.85, 2.8, { wobble: 5, pulse: 0.03 });
        rise(['💨', '☁️', '✨', '🤎'], 22, 40, 90, 2.4, 110, 230);
      },
      sunflower() {
        flash(0x33FFEB3B, 0, 0.5);
        rain(['🌻', '🌻', '🌼', '🐝'], 34, 50, 112, 2.4, 150, 300);
      },
      ring() {
        const w = vw(), h = vh();
        dropIn('💍', 0.85, 3.0); ring(0xFFE0F7FA, 0.85); ring(0xFFFFD43B, 1.0); flash(0x55FFFFFF, 0.9, 0.3);
        burst(['💎', '✨', '💖', '💍'], w / 2, h / 2, 26, 36, 90, 450, 1100, 0.9, 320);
      },
      medal() {
        dropIn('🥇', 1); ring(0xFFFFD43B, 0.7);
        cannon(true, 34, 0.75); cannon(false, 34, 0.75);
        rain(['⭐', '✨', '🌟', '🏅'], 16, 36, 80, 2.0, 200, 340);
      },
      racecar() {
        const w = vw(), h = vh(), sz = bigSize() * 0.5;
        R(2, k => {
          const y = h * (0.66 + 0.14 * k), dl = k * 0.5, mt = 1.5;
          const c = emo('🏎️', -sz, y, sz, { life: mt, delay: dl, env: 2 });
          Object.assign(c, { mt, sx: -sz, sy: y, tx: w + sz, ty: y, ease: 3, flip: true });
          R(22, i => {
            const u = i / 22, e = u * u;
            emo(i % 2 === 0 ? '💨' : '✨', -sz + (w + 2 * sz) * e - sz * 0.5, y + rnd(-10, 10) * d, rnd(28, 56) * d, { life: 0.7, delay: dl + mt * u, env: 0 });
          });
        });
        burst(['🏁', '✨', '🎉'], w * 0.9, h * 0.7, 14, 40, 90, 400, 1000, 1.5, 300);
      },
      plane() {
        const w = vw(), h = vh(), sz = bigSize() * 0.6, y0 = h * 0.42, y1 = h * 0.16;
        const pl = emo('✈️', -sz, y0, sz, { life: 2.8, env: 2 });
        Object.assign(pl, { mt: 2.8, sx: -sz, sy: y0, tx: w + sz, ty: y1, ease: 4 });
        R(28, i => {
          const u = i / 28;
          emo(i % 3 === 0 ? '✨' : '☁️', -sz + (w + 2 * sz) * u - sz * 0.5, y0 + (y1 - y0) * u + sz * 0.1, rnd(30, 64) * d, { life: 1.2, delay: 2.8 * u, env: 0 });
        });
        rise(['☁️', '✨'], 12, 50, 100, 2.4, 120, 240);
      },
      pray() {
        ring(0xFFFFE082); ring(0xFFFFF3B0, 0.25); pop('🙏', 1, 2.8, { wobble: 4, pulse: 0.04 });
        rise(['✨', '💖', '🌸', '🙏'], 24, 40, 100, 2.2, 150, 300);
      },
      mindblow() {
        const w = vw(), h = vh();
        pop('🤯', 1, 2.6, { wobble: 10, pulse: 0.1 });
        flash(0xCCFFFFFF, 0.35, 0.35); ring(0xFFFF8A65, 0.35); ring(0xFFFFD43B, 0.5);
        burst(['💥', '🤯', '✨', '⭐'], w / 2, h * 0.34, 34, 36, 96, 500, 1300, 0.35, 320);
      }
    };

    // ---------------------------------------------------------------- vòng vẽ
    function frame(now) {
      raf = 0;
      if (!running) return;
      const t = now / 1000;
      const dt = last === 0 ? 0.016 : Math.min(0.05, t - last);
      last = t;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      let wi = 0;
      for (let ri = 0; ri < parts.length; ri++) {
        const p = parts[ri];
        p.age += dt;
        const a = p.age - p.delay;
        if (a < 0) { parts[wi++] = p; continue; }
        if (a >= p.life) {
          if (p.end === 1) explode(p.x, p.y, pick(fireColors));
          else if (p.end === 2) impact(p.x, p.y);
          continue;
        }
        p.px = p.x; p.py = p.y;
        if (p.mt > 0) {
          const e = ease(p.ease, Math.min(1, a / p.mt));
          p.x = p.sx + (p.tx - p.sx) * e;
          p.y = p.sy + (p.ty - p.sy) * e;
        } else {
          const k = Math.exp(-p.drag * dt);
          p.vx *= k;
          p.vy = p.vy * k + p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
        p.rot += p.vrot * dt;
        parts[wi++] = p;
        drawPart(p, a);
      }
      parts.length = wi;
      if (pending.length) { parts.push(...pending); pending = []; }

      if (parts.length && running) raf = requestAnimationFrame(frame);
      else { running = false; last = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    }

    function drawPart(p, a) {
      const u = a / p.life;
      let alpha = 1, sc = 1;
      switch (p.env) {
        case 0: if (u > 0.65) alpha = clamp((1 - u) / 0.35, 0, 1); break;
        case 1:
          sc = u < 0.14 ? ease(2, u / 0.14) : u > 0.76 ? 1 - ((u - 0.76) / 0.24) * 0.4 : 1;
          if (u > 0.76) alpha = clamp((1 - u) / 0.24, 0, 1);
          if (p.pulse > 0) sc *= 1 + p.pulse * Math.sin(a * 15);
          break;
        case 3:
          sc = u < 0.12 ? 0.2 + 0.8 * (u / 0.12) : 1;
          if (u > 0.6) alpha = clamp((1 - u) / 0.4, 0, 1);
          break;
        default: break;
      }
      const dx = p.sway !== 0 ? Math.sin(a * p.swayS + p.phase) * p.sway : 0;
      const dy = p.hopH > 0 ? -Math.abs(Math.sin(a * p.hopS)) * p.hopH : 0;
      const rot = p.rot + (p.wobA !== 0 ? Math.sin(a * p.wobS) * p.wobA : 0);

      switch (p.kind) {
        case 0: {
          if (!p.emoji) return;
          const b = bmp(p.emoji), s = p.size * sc / 192;
          ctx.globalAlpha = clamp(alpha, 0, 1);
          ctx.save();
          ctx.translate(p.x + dx, p.y + dy);
          ctx.rotate(rad(rot));
          ctx.scale(p.flip ? -s : s, s);
          ctx.drawImage(b, -96, -96);
          ctx.restore();
          ctx.globalAlpha = 1;
          break;
        }
        case 1: {
          const f = Math.cos(a * p.flipS + p.phase);
          ctx.save();
          ctx.translate(p.x + dx, p.y);
          ctx.rotate(rad(rot));
          ctx.scale(1, Math.abs(f) < 0.12 ? 0.12 : f);
          ctx.fillStyle = rgba(p.color, alpha);
          ctx.fillRect(-p.size / 2, -p.size2 / 2, p.size, p.size2);
          ctx.restore();
          break;
        }
        case 3: {
          const col = rgba(p.color, alpha);
          ctx.strokeStyle = col; ctx.fillStyle = col;
          ctx.lineWidth = p.size; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.7, 0, TAU); ctx.fill();
          break;
        }
        case 6: {
          // chớp sáng: nhấp nháy nhanh, mờ dần
          const flick = 0.55 + 0.45 * Math.sin(a * 38 + p.size);
          const base = ((p.color >>> 24) & 255) / 255;
          ctx.fillStyle = rgba(p.color, base * flick * (1 - u));
          ctx.fillRect(0, 0, W, H);
          break;
        }
        case 5: {
          const r = p.size + (p.size2 - p.size) * ease(0, u);
          ctx.strokeStyle = rgba(p.color, (1 - u) * 200 / 255);
          ctx.lineWidth = Math.max(2, 14 * d * (1 - u));
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, r), 0, TAU); ctx.stroke();
          break;
        }
        default: break;
      }
    }

    return {
      /** Chạy hiệu ứng theo id; id lạ thì bỏ qua. */
      fire(id) {
        const fn = Object.prototype.hasOwnProperty.call(effects, id) ? effects[id] : null;
        if (!fn) return;
        fn();
        flush();
      },
      resize,
      ids: Object.keys(effects),
      get running() { return running; },
      get count() { return parts.length + pending.length; }
    };
  }

  window.createReactions = createReactions;
})();
