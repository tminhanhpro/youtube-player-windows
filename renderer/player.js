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
    // Nhạc không có hình (mp3...): hiện nền có nốt nhạc và tên bài thay cho khung đen
    const cover = document.createElement('div');
    cover.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;z-index:1;padding:0 6%;text-align:center;container-type:size;color:#fff;' +
      'background:radial-gradient(ellipse at 50% 35%,#3a2a5c,#0d0d16 75%);font-family:"Segoe UI",system-ui,sans-serif';
    const coverNote = document.createElement('div'); coverNote.textContent = '\u266A'; coverNote.style.cssText = 'font-size:34cqmin;line-height:1;color:#ff80ab;text-shadow:0 0 6cqmin #ff4d8d88';
    const coverTitle = document.createElement('div'); coverTitle.style.cssText = 'margin-top:2cqmin;font-size:7cqmin;font-weight:700;line-height:1.2;max-width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word';
    // Lớp nền do người dùng chọn (hình hoặc video lặp, tắt tiếng) nằm dưới nốt nhạc/tên bài, có lớp tối nhẹ cho dễ đọc chữ
    const bgLayer = document.createElement('div');
    bgLayer.style.cssText = 'position:absolute;inset:0;z-index:0;display:none;background:#000 center/cover no-repeat';
    const bgScrim = document.createElement('div');
    bgScrim.style.cssText = 'position:absolute;inset:0;z-index:0;display:none;background:linear-gradient(to top,#000a 0%,#0004 45%,#0002 100%)';
    let bgVideo = null, bgWant = null;
    coverNote.style.position = 'relative'; coverNote.style.zIndex = '1';
    coverTitle.style.position = 'relative'; coverTitle.style.zIndex = '1';
    function setBg(bg) {
      bgWant = bg && bg.url && (bg.type === 'image' || bg.type === 'video') ? bg : null;
      if (bgVideo) { try { bgVideo.pause(); } catch (e) { /* ignore */ } bgVideo.remove(); bgVideo = null; }
      bgLayer.style.backgroundImage = '';
      const on = !!bgWant;
      bgLayer.style.display = bgScrim.style.display = on ? 'block' : 'none';
      coverNote.style.display = on ? 'none' : 'block';
      coverTitle.style.textShadow = on ? '0 0.4cqmin 2cqmin #000, 0 0 1cqmin #000' : '';
      coverTitle.style.marginTop = on ? '0' : '2cqmin';
      cover.style.justifyContent = on ? 'flex-end' : 'center';
      cover.style.paddingBottom = on ? '9cqmin' : '0';
      if (!on) return;
      if (bgWant.type === 'image') bgLayer.style.backgroundImage = 'url("' + bgWant.url + '")';
      else {
        bgVideo = document.createElement('video');
        bgVideo.muted = true; bgVideo.loop = true; bgVideo.playsInline = true; bgVideo.autoplay = true;
        bgVideo.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
        bgVideo.src = bgWant.url;
        bgLayer.appendChild(bgVideo);
        if (cover.style.display !== 'none') bgVideo.play().catch(() => {});
      }
    }
    cover.append(bgLayer, bgScrim, coverNote, coverTitle);
    box.appendChild(cover); box.appendChild(video); box.appendChild(frame); box.appendChild(audio);

    let mode = 'none', key = '', vol = 100, muted = false, hasAudio = false, started = false, wantPaused = false;
    let startMs = 0, posTimer = null, frameReady = false, pending = null;
    // Âm lượng "mềm" nhân thêm vào âm lượng chính: MC nói (hạ nhạc), fade vào/ra. 0..1, chuyển mượt bằng rampGain.
    let gain = 1, gainWant = 1, rampT = null, pendingFadeIn = 0, lastFrameVol = -1;

    const fire = (kind, a, b) => { if (key) onEvent(kind, key, a, b); };
    const master = () => (hasAudio ? audio : video);
    const effVol = () => (muted ? 0 : Math.min(1, Math.max(0, vol / 100 * gain)));
    function applyVol() {
      const v = effVol();
      if (hasAudio) { audio.volume = v; video.muted = true; }
      else { video.volume = v; video.muted = muted; }
      if (mode === 'iframe') {
        const fv = Math.round(v * 100);
        if (fv !== lastFrameVol) { lastFrameVol = fv; toFrame({ fn: 'volume', v: fv }); }
      }
    }
    /** Đưa hệ số gain tới `to` trong `ms` mili giây (êm, dạng smoothstep). from != null: đặt ngay hệ số xuất phát. */
    function rampGain(to, ms, from) {
      clearInterval(rampT); rampT = null;
      if (from != null) gain = Math.min(1, Math.max(0, from));
      gainWant = to;
      if (!(ms > 0) || Math.abs(to - gain) < 0.001) { gain = to; applyVol(); return; }
      const g0 = gain, t0 = performance.now();
      rampT = setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / ms);
        gain = g0 + (to - g0) * (p * p * (3 - 2 * p));
        applyVol();
        if (p >= 1) { clearInterval(rampT); rampT = null; gain = to; applyVol(); }
      }, 40);
    }
    function startFadeIn() { const ms = pendingFadeIn; pendingFadeIn = 0; if (ms > 0) rampGain(gainWant, ms); }

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
        else startFadeIn();
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
      if (m.kind === 'started') { started = true; if (!wantPaused) startFadeIn(); }
      onEvent(m.kind, m.key, m.a, m.b);
    });
    frame.addEventListener('load', () => { frameReady = true; if (pending) { frame.contentWindow.postMessage(pending, location.origin); pending = null; } });
    function toFrame(m) {
      if (!frameReady) { if (m.fn === 'load') pending = m; return; }
      frame.contentWindow.postMessage(m, location.origin);
    }

    function stopAll() {
      clearInterval(posTimer); clearInterval(rampT); rampT = null; lastFrameVol = -1;
      clearMedia();
      toFrame({ fn: 'stop' });
      video.style.display = 'none'; frame.style.display = 'none'; cover.style.display = 'none';
      if (bgVideo) { try { bgVideo.pause(); } catch (e) { /* ignore */ } }
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
            // gain: hệ số đích (đang MC nói thì < 1); fadeInMs > 0 thì bắt đầu từ im lặng và nhích dần lên khi bài thực sự phát
            gainWant = c.gain == null ? 1 : c.gain;
            pendingFadeIn = c.fadeInMs > 0 ? c.fadeInMs : 0;
            gain = pendingFadeIn > 0 ? 0 : gainWant;
            if (c.mode === 'iframe') {
              mode = 'iframe';
              frame.style.display = 'block';
              applyVol(); toFrame({ fn: 'mute', on: muted });
              toFrame({ fn: 'load', key: c.key, videoId: c.videoId, startMs: c.startMs, paused: c.paused, volume: Math.round(effVol() * 100) });
            } else {
              mode = 'stream';
              hasAudio = !!(c.src.audio && c.src.audio.url);
              video.style.display = 'block';
              if (c.src.audioOnly) {
                coverTitle.textContent = c.title || ''; cover.style.display = 'flex';
                setBg(c.bg);
                if (bgVideo) bgVideo.play().catch(() => {});
              }
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
            if (pendingFadeIn > 0 && started) startFadeIn();
            break;
          case 'seek':
            if (mode === 'stream') { const t = c.ms / 1000; video.currentTime = t; if (hasAudio) audio.currentTime = t; }
            else if (mode === 'iframe') toFrame({ fn: 'seek', ms: c.ms });
            break;
          case 'volume':
            vol = c.v; lastFrameVol = -1; applyVol();
            break;
          case 'gain':
            // Bài mới nạp đang chờ fade in: chỉ đổi mức đích, khi bài phát sẽ nhích lên đúng mức đó
            if (pendingFadeIn > 0 && c.from == null) { gainWant = c.target; break; }
            rampGain(c.target, c.ms || 0, c.from);
            break;
          case 'sync': {
            // khung phụ (laptop) bám theo khung chính (TV): lệch quá 1,5 giây thì tua lại
            if (mode === 'stream' && started && Math.abs(video.currentTime - c.ms / 1000) > 1.5) {
              video.currentTime = c.ms / 1000; if (hasAudio) audio.currentTime = c.ms / 1000;
            }
            break;
          }
          case 'bg':
            // đổi nền khi đang phát: chỉ có tác dụng trên màn nhạc không hình
            setBg(c.bg);
            if (bgVideo && cover.style.display !== 'none') bgVideo.play().catch(() => {});
            break;
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
