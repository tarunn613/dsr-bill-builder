// Electron main process.
//
// The desktop app is just a thin native shell around the existing local web app:
//   1. spawn the Express backend as a child process (pure Node, via
//      ELECTRON_RUN_AS_NODE) on a free port, pointing SESSIONS_DIR at the OS
//      user-data folder so a contractor's tenders live in a safe per-user place;
//   2. show a small loading screen immediately, then swap it for the real app
//      once the backend answers.
//
// Nothing about the Phase 2/3/4 code changes — exceljs/pdfkit/the DSR JSON and
// the session store all run exactly as they do in `npm run dev`.
//
// Windows gotcha (why this file has a loading screen + retry, not just a
// straight wait-then-fail): startBackend() re-spawns process.execPath, which
// in a packaged app is the app's own large .exe run with ELECTRON_RUN_AS_NODE.
// The first time Windows Defender / other AV sees that freshly-installed
// binary get *executed*, it can real-time-scan it, adding anywhere from a
// couple of seconds to 20-30+ before the process actually starts running —
// entirely outside our control, and gone on the next launch once AV has
// cached it as known-good. A tight timeout + hard quit turns that transient
// delay into a scary, easy-to-hit "contact your administrator" error. The
// fixes here: a generous timeout, a splash so the wait doesn't look frozen,
// and an in-place Retry so a slow first start doesn't require relaunching.

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

// Use a clean, human-friendly name for the per-user data folder
// (~/Library/Application Support/DSR Bill Builder, %APPDATA%\DSR Bill Builder).
// Must be set before any app.getPath('userData') call.
app.setName('DSR Bill Builder');

let backendProc = null;
let mainWindow = null;
let backendPort = 0;

// Resolve the backend folder: loose on disk in dev, in resources/ when packaged.
function backendDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function stopBackend() {
  if (backendProc) {
    try { backendProc.kill(); } catch { /* already gone */ }
    backendProc = null;
  }
}

function startBackend(port) {
  stopBackend(); // never leave a stale process behind if this is a retry
  const serverEntry = path.join(backendDir(), 'src', 'server.js');
  const sessionsDir = path.join(app.getPath('userData'), 'sessions');
  backendProc = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // run the script as plain Node, not a second Electron
      PORT: String(port),
      SESSIONS_DIR: sessionsDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProc.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backendProc.stderr.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  backendProc.on('exit', (code) => { backendProc = null; if (code) console.error('[backend] exited with', code); });
}

// poll /api/meta until the server is up (or give up after timeoutMs). 45s
// (was 20s) gives real headroom for a slow AV-scanned first launch on Windows
// without masking a genuinely broken install — a broken spawn fails fast
// (ECONNREFUSED every 250ms), it doesn't fail slow.
function waitForServer(port, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/meta', timeout: 1500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) reject(new Error('backend did not come up in time'));
      else setTimeout(attempt, 250);
    };
    attempt();
  });
}

// self-contained loading screen (no external files — keeps packaging simple)
// shown the instant the window opens, so the occasional long wait for the
// backend never looks like a frozen or broken app.
const LOADING_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0;background:#f4f5f3;display:flex;align-items:center;
    justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .box{text-align:center;color:#1f4e23;}
  .spinner{width:34px;height:34px;border:3px solid #d9d9d9;border-top-color:#1f4e23;
    border-radius:50%;margin:0 auto 14px;animation:spin 0.9s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg);}}
  .title{font-weight:700;font-size:15px;}
  .sub{color:#6b7280;font-size:12px;margin-top:6px;}
</style></head><body>
  <div class="box">
    <div class="spinner"></div>
    <div class="title">Starting DSR Bill Builder…</div>
    <div class="sub">This can take a little longer the first time you open it.</div>
  </div>
</body></html>`)}`;

async function bootBackend() {
  backendPort = await getFreePort();
  startBackend(backendPort);
  await waitForServer(backendPort);
}

// runs the backend boot sequence; on failure, offers Retry in place (this
// used to quit the whole app, forcing the user to relaunch it by hand).
async function startAndConnect() {
  try {
    await bootBackend();
    if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);
  } catch (e) {
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'DSR Bill Builder — startup error',
      message: 'The application engine could not start.',
      detail: (e && e.message ? e.message : String(e))
        + '\n\nThis is usually antivirus software scanning the app the first time it '
        + 'runs, and clears up on its own — Retry usually works.\n\n'
        + 'If this keeps happening, contact your administrator.',
      buttons: ['Retry', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0 && mainWindow) return startAndConnect();
    app.quit();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'DSR Bill Builder',
    backgroundColor: '#f4f5f3',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(LOADING_HTML);

  // external links (if any) open in the user's browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  startAndConnect();
}

// only allow one running copy (a second launch focuses the existing window)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    // a minimal, friendly menu (File→Quit, Edit clipboard, View→Reload/Zoom)
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', stopBackend);
  app.on('quit', stopBackend);
  process.on('exit', stopBackend);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}
