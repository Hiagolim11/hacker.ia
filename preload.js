'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  on: (ch, cb) => ipcRenderer.on(ch, (_e, ...a) => cb(...a)),
  toggleListen: () => ipcRenderer.send('toggle-listen'),
  askText: t => ipcRenderer.send('ask-text', t),
  stopSpeak: () => ipcRenderer.send('stop-speak'),
});
