import { app, BrowserWindow, Menu, session } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

app.setName("Third Roll Offline");
// Existing scores live in this folder, so it keeps the earlier name.
const dataPath = process.env.YAHTZEE_OFFLINE_DATA_DIR || join(app.getPath("appData"), "Yahtzee Offline");
mkdirSync(dataPath, { recursive: true });
app.setPath("userData", dataPath);

function createOfflineWindow() {
  const win = new BrowserWindow({
    width: 960, height: 750, minWidth: 800, minHeight: 600, title: "Third Roll Offline",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  void win.loadFile(join(__dirname, "../renderer/offline.html"));
}

async function ready() {
  // Belt and braces: the renderer CSP also forbids connections.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith("file:") && !details.url.startsWith("data:") });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { role: "togglefullscreen" }] },
  ]));
  createOfflineWindow();
}

if (app.requestSingleInstanceLock()) {
  void app.whenReady().then(ready);
  app.on("second-instance", () => { BrowserWindow.getAllWindows()[0]?.focus(); });
  app.on("window-all-closed", () => app.quit());
} else {
  app.quit();
}
