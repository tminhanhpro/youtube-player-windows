'use strict';
// Cửa sổ chiếu lên màn hình lớn (HDMI): chỉ có khung phát toàn màn hình, không có giao diện điều khiển.
const $ = id => document.getElementById(id);
const bridge = window.ytp; // KHÔNG đặt tên trùng "ytp": contextBridge đã khai báo window.ytp, khai báo lại bằng const sẽ gây SyntaxError
const player = window.createPlayer($('vbox'), (kind, key, a, b) => bridge.send('player-event', { kind, key, a, b }));
bridge.on('player', c => player.command(c));

// hiệu ứng cổ vũ + tin nhắn chạy phủ lên video
const fx = window.createFx($('fx'));
bridge.on('reaction', id => fx.react(id));
bridge.on('message', m => fx.message(m.sender, m.text));

bridge.on('state', ({ snap }) => {
  const st = snap.state;
  const playing = st === 'PLAYING' || st === 'PAUSED';
  $('idle').classList.toggle('off', playing);
  $('idleText').textContent = playing ? '' : (
    snap.netWait ? 'Mất kết nối mạng, đang thử lại…' :
    st === 'ERROR' ? 'Không phát được bài này, đang chuyển bài…' :
    st === 'IDLE' ? 'Youtube Player\nChọn bài trên máy tính hoặc điện thoại' : 'Đang tải bài hát…');
});

let volT = null;
bridge.on('volume', v => {
  $('voltext').textContent = 'Âm lượng: ' + v + '%'; $('volfill').style.width = v + '%'; $('volbox').hidden = false;
  clearTimeout(volT); volT = setTimeout(() => { $('volbox').hidden = true; }, 1800);
});

// Cố gắng chọn thiết bị âm thanh HDMI/Display (nếu Windows cho biết tên); không được thì dùng thiết bị mặc định.
(async () => {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const hd = devs.find(d => /hdmi|display audio|nvidia high definition|amd high definition|intel.*display/i.test(d.label));
    if (hd) await player.setSink(hd.deviceId);
  } catch (e) { /* dùng mặc định */ }
})();

bridge.send('player-ready');
