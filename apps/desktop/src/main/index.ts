import { app, BrowserWindow, Menu } from "electron";
import { join } from "path";

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: "Third Roll",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const menu = Menu.buildFromTemplate([
    {
      label: "View",
      submenu: [
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          click: () => {
            const level = win.webContents.getZoomLevel();
            win.webContents.setZoomLevel(level + 0.5);
          },
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => {
            const level = win.webContents.getZoomLevel();
            win.webContents.setZoomLevel(level - 0.5);
          },
        },
        {
          label: "Reset Zoom",
          accelerator: "CmdOrCtrl+0",
          click: () => {
            win.webContents.setZoomLevel(0);
          },
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(process.env.NODE_ENV === "development"
          ? [{ role: "toggleDevTools" as const }]
          : []),
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
