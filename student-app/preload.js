const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("native", {
  getConfig: () => ipcRenderer.invoke("cfg:get"),
  setConfig: (p) => ipcRenderer.invoke("cfg:set", p),
  deviceId: () => ipcRenderer.invoke("device"),
  setExamMode: (on) => ipcRenderer.invoke("exam:mode", on),
  http: (req) => ipcRenderer.invoke("http", req),
  quit: () => ipcRenderer.invoke("quit"),
  wdStart: (a) => ipcRenderer.invoke("wd:start", a),
  wdEvent: (type, payload) => ipcRenderer.invoke("wd:event", { type, payload }),
  wdToken: (t) => ipcRenderer.invoke("wd:token", t),
  wdFlush: () => ipcRenderer.invoke("wd:flush"),
  wdEnd: (reason) => ipcRenderer.invoke("wd:end", reason),
  wdHealth: () => ipcRenderer.invoke("wd:health"),
  onFocus: (cb) => {
    ipcRenderer.on("focus-lost", () => cb(false));
    ipcRenderer.on("focus-back", () => cb(true));
  },
});
