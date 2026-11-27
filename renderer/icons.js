'use strict';
// Biểu tượng SVG đơn giản (dùng currentColor)
window.ICONS = (function () {
  const w = (b, vb) => '<svg viewBox="' + (vb || '0 0 24 24') + '" fill="currentColor" aria-hidden="true">' + b + '</svg>';
  return {
    dot: w('<circle cx="12" cy="12" r="7"/>'),
    wifi: w('<path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 0 0-6 0zm-4-4l2 2a7.074 7.074 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/>'),
    lan: w('<path d="M13 22h8v-7h-3v-4h-5V9h3V2H8v7h3v2H6v4H3v7h8v-7H8v-2h8v2h-3z"/>'),
    search: w('<path fill-rule="evenodd" d="M10 3a7 7 0 1 0 4.2 12.6l4.8 4.8 1.4-1.4-4.8-4.8A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>'),
    mic: w('<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z"/>'),
    plus: w('<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>'),
    heart: w('<path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2 0 3.5 1 5.4 3 1.9-2 3.4-3 5.4-3 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/>'),
    sun: w('<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1l1.4-1.4 2.1 2.1-1.4 1.4zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1z"/>'),
    moon: w('<path d="M20.6 14.9A8.5 8.5 0 0 1 9.1 3.4a.7.7 0 0 0-.9-.9A10 10 0 1 0 21.5 15.8a.7.7 0 0 0-.9-.9z"/>'),
    gear: w('<path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>'),
    note: w('<path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3z"/>'),
    eq: w('<path d="M4 12h3v8H4zM10.5 4h3v16h-3zM17 9h3v11h-3z"/>'),
    rew: w('<path d="M11 6v12l-8.5-6zm9.5 0v12L12 12z"/>'),
    ff: w('<path d="M13 6v12l8.5-6zM3.5 6v12L12 12z"/>'),
    next: w('<path d="M6 6v12l9-6zM16 6h2.5v12H16z"/>'),
    play: w('<path d="M7 5v14l12-7z"/>'),
    pause: w('<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'),
    mc: w('<path d="M9 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM3.5 10a5.5 5.5 0 0 0 11 0h-2a3.5 3.5 0 0 1-7 0zM8 16.5h2V20H8zM18 6h2v7.2l2.1-2.1 1.4 1.4L19 17l-4.5-4.5 1.4-1.4 2.1 2.1z"/>'),
    voldn: w('<path d="M3 9v6h4l5 4V5L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>'),
    volup: w('<path d="M3 9v6h4l5 4V5L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>'),
    fade: w('<path d="M3 4h3v16H3zM8.5 7h3v13h-3zM14 11h3v9h-3zM19.5 15h3v5h-3z"/>'),
    banner: w('<path d="M3 5h18v3h-2V7h-5v10h2.2v2H7.8v-2H10V7H5v1H3z"/>'),
    deck: w('<path d="M4 7h12v14H4z"/><path d="M8 3h12v14h-2V5H8z"/>'),
    speaker: w('<path d="M3 9v6h4l5 4V5L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>'),
    folder: w('<path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/>'),
    download: w('<path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4L11 12.2zM5 18h14v3H5z"/>'),
    replay: w('<path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/>'),
    repeat1: w('<path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2zm-4-2V9h-1l-2 1v1h1.5v4z"/>'),
    qr: w('<path d="M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm8-2h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5-2h3v5h-3z"/>'),
    up: w('<path d="M12 4l8 8h-5v8H9v-8H4z"/>'),
    down: w('<path d="M12 20l-8-8h5V4h6v8h5z"/>'),
    trash: w('<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>'),
    back: w('<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z"/>'),
    caret: w('<path d="M7 10l5 5 5-5z"/>'),
    fullscreen: w('<path d="M5 5h6v2H7v4H5zM13 5h6v6h-2V7h-4zM5 13h2v4h4v2H5zM17 13h2v6h-6v-2h4z"/>')
  };
})();
