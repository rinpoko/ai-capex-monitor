// AI Capex Monitor — Electronネイティブランチャー。
// プロジェクト本体(app/ 以下のPython/FastAPIバックエンドと静的フロントエンド)はこのMacの
// 固定パスにあり続ける前提で、その場に置かれた .venv の uvicorn サーバーを子プロセスとして
// 起動し、ウィンドウで表示するだけの薄いラッパー。app.js等の更新は再ビルド不要で反映される。
const { app, BrowserWindow, Menu } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PROJECT_ROOT = "/Users/home/Claude/ai-capex-monitor";
const PYTHON = path.join(PROJECT_ROOT, ".venv/bin/python");
const PORT = 8765;
const URL = `http://127.0.0.1:${PORT}`;

let serverProcess = null;
let mainWindow = null;

function isServerUp() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/status`, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

function startServer() {
  // --host 0.0.0.0 で同じWi-Fi内の他端末（iPhone等）からもアクセス可能にする
  serverProcess = spawn(
    PYTHON,
    ["-m", "uvicorn", "app.server:app", "--app-dir", PROJECT_ROOT, "--host", "0.0.0.0", "--port", String(PORT)],
    { cwd: PROJECT_ROOT, stdio: "inherit" }
  );
  serverProcess.on("error", (err) => {
    console.error("バックエンド起動に失敗しました:", err);
  });
}

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 960,
    minWidth: 860,
    minHeight: 640,
    title: "AI Capex Monitor",
    backgroundColor: "#0e1117",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL(URL);
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (!(await isServerUp())) startServer();
  await waitForServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) serverProcess.kill();
});
