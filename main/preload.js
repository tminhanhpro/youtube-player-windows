'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytp', {
  /** Gọi lệnh lên tiến trình chính: ytp.call('skip'), ytp.call('seekTo', [null, 10000]) ... */
  call: (method, args) => ipcRenderer.invoke('ctl', method, args || []),
  /** Nhận sự kiện đẩy từ tiến trình chính (state, player, reaction, message, volume, cats, favs...) */
  on: (channel, cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  send: (channel, data) => ipcRenderer.send(channel, data)
});
