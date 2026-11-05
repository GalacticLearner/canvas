/** Hardened Electron host exposes a narrow IPC contract and no renderer Node privileges. */
import { app, BrowserWindow, ipcMain, dialog, session } from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NetClient } from "./netClient";
import { discover } from "./discovery";
import { readStore, writeStore } from "./storage";
const arg = process.argv.find((a) => a.startsWith("--user-data-dir="));
if (arg) app.setPath("userData", arg.slice(16));
void app.whenReady().then(() => {
  const userId = (readStore("identity") as string) || crypto.randomUUID();
  writeStore("identity", userId);
  const net = new NetClient(userId);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 650,
    title:
      process.argv.find((a) => a.startsWith("--name="))?.slice(7) || "Canvas",
    backgroundColor: "#F5F5EF",
    icon: join(__dirname, "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const allowed =
      url.protocol === "file:" ||
      url.protocol === "devtools:" ||
      url.protocol === "data:" ||
      url.protocol === "blob:" ||
      (process.env.CANVAS_DEV === "1" && url.hostname === "localhost");
    callback({ cancel: !allowed });
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const emit = (channel: string, data: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, data);
  };
  net.on("message", (e) => emit("net:message", e));
  net.on("status", (s) => emit("net:status", s));
  net.on("rtt", (n) => emit("net:rtt", n));
  ipcMain.handle("net:connect", (_event, options) => net.connect(options));
  ipcMain.handle("net:send", (_event, e) => net.send(e));
  ipcMain.handle("net:ack", (_event, seq) => net.acknowledge(seq));
  ipcMain.handle("net:disconnect", () => net.disconnect());
  ipcMain.handle("net:discover", () => discover());
  ipcMain.handle("storage:read", (_event, key: string) =>
    readStore(
      "board-" + createHash("sha256").update(String(key)).digest("hex"),
    ),
  );
  ipcMain.handle("storage:write", (_event, key: string, value: unknown) =>
    writeStore(
      "board-" + createHash("sha256").update(String(key)).digest("hex"),
      value,
    ),
  );
  ipcMain.handle(
    "file:save",
    async (
      _event,
      { name, data, base64 }: { name: string; data: string; base64?: boolean },
    ) => {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: name.replace(/[/\\]/g, "_"),
      });
      if (!result.canceled && result.filePath) {
        writeFileSync(
          result.filePath,
          base64 ? Buffer.from(data, "base64") : data,
        );
        return true;
      }
      return false;
    },
  );
  ipcMain.handle("file:open", async () => {
    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: "Canvas board", extensions: ["wbboard"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : readFileSync(result.filePaths[0], "utf8");
  });
  if (process.env.CANVAS_DEV === "1")
    void window.loadURL("http://localhost:5173");
  else void window.loadFile(join(__dirname, "renderer/index.html"));
  window.on("closed", () => net.disconnect());
});
app.on("window-all-closed", () => app.quit());
