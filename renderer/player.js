'use strict';
/**
 * Trình phát trong cửa sổ. Hai chế độ:
 *  - stream: <video> (+ <audio> riêng nếu hình/tiếng tách rời), đồng bộ với nhau
 *  - iframe: khung YouTube nhúng (dự phòng)
 * onEvent(kind, key, a, b): started | ended | error | pos
 */
(function () {
  function createPlayer(box, onEvent) {
    const video = document.createElement('video');
    video.playsInline = true;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:none';
    const audio = document.createElement('audio');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;display:none';
    frame.allow = 'autoplay; encrypted-media';
    frame.src = '/ui/embed.html';
    box.appendChild(video); box.appendChild(frame); box.appendChild(audio);

    let mode = 'none', key = '', vol = 100, muted = false, hasAudio = false, started = false, wantPaused = false;
    let startMs = 0, posTimer = null, frameReady = false, pending = null;

    const fire = (kind, a, b) => { if (key) onEvent(kind, key, a, b); };
    const master = () => (hasAudio ? audio : video);
    function applyVol() {
      const v = muted ? 0 : vol / 100;
      if (hasAudio) { audio.volume = v; video.muted = true; }
      else { video.volume = v; video.muted = muted; }
    }

    function clearMedia() {
      for (const el of [video, audio]) { try { el.pause(); } catch (e) { /* ignore */ } el.removeAttribute('src'); try { el.load(); } catch (e) { /* ignore */ } }
      hasAudio = false; started = false;
    }

    function startPosTimer() {
      clearInterval(posTimer);
      posTimer = setInterval(() => {
        if (mode !== 'stream') return;
        const t = video.currentTime;
        if (hasAudio && !audio.paused && Math.abs(audio.currentTime - t) > 0.35) audio.currentTime = t;
        fire('pos', t * 1000, isFinite(video.duration) ? video.duration * 1000 : 0);
      }, 1000);
    }

    // sự kiện của <video>
    video.addEventListener('playing', () => {
      if (mode !== 'stream') return;
      if (hasAudio && !wantPaused) audio.play().catch(() => {});
      if (!started) {
        started = true;
        if (wantPaused) { video.pause(); audio.pause(); }
        fire('started');
      }
    });
    video.addEventListener('waiting', () => { if (mode === 'stream' && hasAudio) audio.pause(); });
    video.addEventListener('ended', () => { if (mode === 'stream') fire('ended'); });
    const logMedia = (el, name) => {
      try {
        const er = el.error;
        window.ytp && window.ytp.call('logRenderer', ['MEDIA ' + name + ' lỗi code=' + (er && er.code) + ' ' + (er && er.message || '') + ' · ' + (el.currentSrc || '').slice(-24)]).catch(() => {});
      } catch (e) { /* ignore */ }
    };
    video.addEventListener('error', () => { if (mode === 'stream' && video.getAttribute('src')) { logMedia(video, 'video'); fire('error'); } });
    audio.addEventListener('error', () => { if (mode === 'stream' && audio.getAttribute('src')) { logMedia(audio, 'audio'); fire('error'); } });
    video.addEventListener('loadedmetadata', () => {
      if (mode !== 'stream') return;
      if (startMs > 0) { video.currentTime = startMs / 1000; if (hasAudio) audio.currentTime = startMs / 1000; }
      if (box.onVideoSize) box.onVideoSize(video.videoWidth, video.videoHeight);
    });

    // tin nhắn từ khung nhúng
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || !e.data || !e.data.ytp) return;
      const m = e.data;
      if (mode !== 'iframe' || m.key !== key) return;
      onEvent(m.kind, m.key, m.a, m.b);
    });
    frame.addEventListener('load', () => { frameReady = true; if (pending) { frame.contentWindow.postMessage(pending, location.origin); pending = null; } });
    function toFrame(m) {
      if (!frameReady) { if (m.fn === 'load') pending = m; return; }
      frame.contentWindow.postMessage(m, location.origin);
    }

    function stopAll() {
      clearInterval(posTimer);
      clearMedia();
      toFrame({ fn: 'stop' });
      video.style.display = 'none'; frame.style.display = 'none';
      mode = 'none'; key = '';
    }

    return {
      get mode() { return mode; },
      /** Nhận lệnh từ bộ não. */
      command(c) {
        switch (c.type) {
          case 'load': {
            stopAll();
            key = c.key; vol = c.volume == null ? vol : c.volume; wantPaused = !!c.paused; startMs = c.startMs || 0;
            if (c.mode === 'iframe') {
              mode = 'iframe';
              frame.style.display = 'block';
              toFrame({ fn: 'volume', v: vol }); toFrame({ fn: 'mute', on: muted });
              toFrame({ fn: 'load', key: c.key, videoId: c.videoId, startMs: c.startMs, paused: c.paused });
            } else {
              mode = 'stream';
              hasAudio = !!(c.src.audio && c.src.audio.url);
              video.style.display = 'block';
              applyVol();
              video.src = c.src.video.url;
              if (hasAudio) audio.src = c.src.audio.url;
              video.play().catch(() => {});
              startPosTimer();
            }
            break;
          }
          case 'pause':
            wantPaused = true;
            if (mode === 'stream') { video.pause(); audio.pause(); } else if (mode === 'iframe') toFrame({ fn: 'pause' });
            break;
          case 'resume':
            wantPaused = false;
            if (mode === 'stream') { video.play().catch(() => {}); if (hasAudio) audio.play().catch(() => {}); } else if (mode === 'iframe') toFrame({ fn: 'resume' });
            break;
          case 'seek':
            if (mode === 'stream') { const t = c.ms / 1000; video.currentTime = t; if (hasAudio) audio.currentTime = t; }
            else if (mode === 'iframe') toFrame({ fn: 'seek', ms: c.ms });
            break;
          case 'volume':
            vol = c.v; applyVol();
            if (mode === 'iframe') toFrame({ fn: 'volume', v: vol });
            break;
          case 'sync': {
            // khung phụ (laptop) bám theo khung chính (TV): lệch quá 1,5 giây thì tua lại
            if (mode === 'stream' && started && Math.abs(video.currentTime - c.ms / 1000) > 1.5) {
              video.currentTime = c.ms / 1000; if (hasAudio) audio.currentTime = c.ms / 1000;
            }
            break;
          }
          case 'stop':
            stopAll();
            break;
          default: break;
        }
      },
      setMuted(on) {
        muted = !!on; applyVol();
        toFrame({ fn: 'mute', on: muted });
      },
      /** Chọn thiết bị âm thanh ra (ví dụ HDMI). Trả về true nếu áp dụng được. */
      async setSink(id) {
        try {
          if (typeof video.setSinkId !== 'function') return false;
          await video.setSinkId(id); await audio.setSinkId(id);
          return true;
        } catch (e) { return false; }
      },
      height() { return mode === 'stream' ? video.videoHeight : 0; }
    };
  }
  window.createPlayer = createPlayer;
})();
