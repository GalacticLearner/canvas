/** Context-isolated bridge exposes only application operations, never generic IPC or filesystem. */
import { contextBridge, ipcRenderer } from "electron";
const on = (channel: string, callback: (value: any) => void) => {
  const listener = (_event: unknown, value: unknown) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld("canvas", {
  connect: (options: unknown) => ipcRenderer.invoke("net:connect", options),
  send: (e: unknown) => ipcRenderer.invoke("net:send", e),
  ack: (seq: number) => ipcRenderer.invoke("net:ack", seq),
  disconnect: () => ipcRenderer.invoke("net:disconnect"),
  discover: () => ipcRenderer.invoke("net:discover"),
  onMessage: (fn: (v: any) => void) => on("net:message", fn),
  onStatus: (fn: (v: any) => void) => on("net:status", fn),
  onRtt: (fn: (v: number) => void) => on("net:rtt", fn),
  read: (key: string) => ipcRenderer.invoke("storage:read", key),
  write: (key: string, value: unknown) =>
    ipcRenderer.invoke("storage:write", key, value),
  save: (options: unknown) => ipcRenderer.invoke("file:save", options),
  open: () => ipcRenderer.invoke("file:open"),
});
