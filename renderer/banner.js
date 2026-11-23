'use strict';
/**
 * Chữ chào mừng: dòng chữ lớn đứng yên giữa/trên/dưới màn hình ("Chúc mừng đám cưới A & B").
 * Dùng chung cho cửa sổ TV (HDMI), khung phát trên máy tính và ô xem trước trong hộp thoại soạn chữ.
 * Cỡ chữ tính theo chiều cao khung nên màn nào cũng cân đối; chữ dài tự thu nhỏ cho vừa khung.
 */
(function () {
  const SIZE_K = [0, 0.05, 0.07, 0.095, 0.125, 0.16]; // tỉ lệ so với chiều cao khung, cho cỡ 1..5
  const FONT = '"Segoe UI","Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const FADE_MS = 600;

  function injectStyle() {
    if (document.getElementById('wb-style')) return;
    const st = document.createElement('style'); st.id = 'wb-style';
    st.textContent =
      '.wb{position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden;display:flex;flex-direction:column;align-items:center;font-family:' + FONT + '}' +
      '.wb[hidden]{display:none!important}' +
      '.wb.p-center{justify-content:center}.wb.p-top{justify-content:flex-start;padding-top:7%}.wb.p-bottom{justify-content:flex-end;padding-bottom:7%}' +
      '.wb-band{width:100%;display:flex;flex-direction:column;align-items:center;padding:.35em 4% .4em;opacity:0;transform:translateY(.5em) scale(.96);transition:opacity ' + FADE_MS + 'ms ease,transform ' + FADE_MS + 'ms cubic-bezier(.2,.8,.2,1);' +
      'background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.58) 14%,rgba(0,0,0,.58) 86%,rgba(0,0,0,0))}' +
      '.wb.on .wb-band{opacity:1;transform:none}' +
      '.wb-rule{width:min(46%,60em);height:.06em;min-height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,var(--wbc),transparent);opacity:.9}' +
      '.wb-text{margin:.18em 0;max-width:94%;text-align:center;font-weight:800;line-height:1.18;letter-spacing:.01em;color:var(--wbc);word-break:break-word;' +
      'text-shadow:0 .04em .08em rgba(0,0,0,.75),0 0 .5em var(--wbg)}' +
      '.wb-text div{min-height:1.18em}' +
      '.wb.pop .wb-text{animation:wbpop .5s cubic-bezier(.2,.9,.3,1.2)}' +
      '@keyframes wbpop{0%{transform:scale(.92);opacity:.4}100%{transform:none;opacity:1}}';
    document.head.appendChild(st);
  }

  window.createBanner = function (container) {
    injectStyle();
    const root = document.createElement('div'); root.className = 'wb p-center'; root.hidden = true;
    const band = document.createElement('div'); band.className = 'wb-band';
    const r1 = document.createElement('div'); r1.className = 'wb-rule';
    const text = document.createElement('div'); text.className = 'wb-text';
    const r2 = document.createElement('div'); r2.className = 'wb-rule';
    band.append(r1, text, r2); root.appendChild(band);
    container.appendChild(root);

    let cur = null, hideT = null;

    function fit() {
      if (!cur || root.hidden) return;
      const H = container.clientHeight, W = container.clientWidth;
      if (!H || !W) return;
      let fs = H * SIZE_K[cur.size];
      band.style.fontSize = fs + 'px';
      for (let i = 0; i < 14 && fs > 10 && (band.offsetHeight > H * 0.7 || text.scrollWidth > W * 0.94); i++) {
        fs *= 0.92; band.style.fontSize = fs + 'px';
      }
    }
    if (window.ResizeObserver) new ResizeObserver(fit).observe(container);

    function fill(b, quiet) {
      text.textContent = '';
      String(b.text).split('\n').forEach(line => { const d = document.createElement('div'); d.textContent = line; text.appendChild(d); });
      root.style.setProperty('--wbc', b.color);
      root.style.setProperty('--wbg', b.color + 'aa');
      root.className = 'wb p-' + b.pos + (root.classList.contains('on') ? (quiet ? ' on' : ' on pop') : '');
    }

    return {
      /** b: { text, color, size 1..5, pos center|top|bottom } */
      show(b, quiet) {
        if (!b || !String(b.text || '').trim()) return;
        cur = { text: String(b.text), color: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#ffffff', size: Math.min(5, Math.max(1, b.size | 0 || 3)), pos: ['top', 'bottom'].includes(b.pos) ? b.pos : 'center' };
        clearTimeout(hideT);
        const wasOn = root.classList.contains('on');
        root.hidden = false;
        fill(cur, quiet);
        fit();
        if (!wasOn) requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('on')));
        else if (!quiet) setTimeout(() => root.classList.remove('pop'), 600);
      },
      hide() {
        if (root.hidden) return;
        root.classList.remove('on', 'pop');
        clearTimeout(hideT);
        hideT = setTimeout(() => { root.hidden = true; cur = null; }, FADE_MS + 50);
      },
      get visible() { return !root.hidden && root.classList.contains('on'); },
      get current() { return cur; }
    };
  };
})();
