// Electron main process.
//
// The desktop app is just a thin native shell around the existing local web app:
//   1. spawn the Express backend as a child process (pure Node, via
//      ELECTRON_RUN_AS_NODE) on a free port, pointing SESSIONS_DIR at the OS
//      user-data folder so a contractor's tenders live in a safe per-user place;
//   2. wait until it answers, then open a window on it.
//
// Nothing about the Phase 2/3/4 code changes — exceljs/pdfkit/the DSR JSON and
// the session store all run exactly as they do in `npm run dev`.

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

function startBackend(port) {
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

// poll /api/meta until the server is up (or give up after timeoutMs)
function waitForServer(port, timeoutMs = 20000) {
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

async function createWindow() {
  try {
    backendPort = await getFreePort();
    startBackend(backendPort);
    await waitForServer(backendPort);
  } catch (e) {
    dialog.showErrorBox('DSR Bill Builder — startup error',
      'The application engine could not start.\n\n' + (e && e.message ? e.message : String(e))
      + '\n\nPlease reopen the app. If this keeps happening, contact your administrator.');
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'DSR Bill Builder',
    backgroundColor: '#f4f5f3',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);

  // external links (if any) open in the user's browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function stopBackend() {
  if (backendProc) {
    try { backendProc.kill(); } catch { /* already gone */ }
    backendProc = null;
  }
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
