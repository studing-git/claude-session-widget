const { app, BrowserWindow, BrowserView, ipcMain, session, screen } = require('electron');

const SNAP_MARGIN = 10;

let mainWindow, fetchView;

function getSnapPosition(w, h, snapX, snapY) {
  const [wx, wy] = mainWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: wx, y: wy });
  const wa = display.workArea;
  const x = snapX === 'left' ? wa.x + SNAP_MARGIN : wa.x + wa.width  - w - SNAP_MARGIN;
  const y = snapY === 'top'  ? wa.y + SNAP_MARGIN : wa.y + wa.height - h - SNAP_MARGIN;
  return { x, y };
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 580,
    height: 280,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F12') mainWindow.webContents.openDevTools({ mode: 'detach' });
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('move-window', (e, { dx, dy }) => {
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});
ipcMain.on('close-window', () => app.quit());
ipcMain.on('minimize-window', () => mainWindow.minimize());

ipcMain.on('set-size', (e, { w, h, snapX, snapY }) => {
  mainWindow.setResizable(true);
  mainWindow.setSize(w, h);
  mainWindow.setResizable(false);
  if (snapX && snapY) {
    const { x, y } = getSnapPosition(w, h, snapX, snapY);
    mainWindow.setPosition(x, y);
  }
});

ipcMain.handle('snap-to-edge', () => {
  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const wa = display.workArea;

  const distLeft   = bounds.x - wa.x;
  const distRight  = (wa.x + wa.width)  - (bounds.x + bounds.width);
  const distTop    = bounds.y - wa.y;
  const distBottom = (wa.y + wa.height) - (bounds.y + bounds.height);

  const snapX = distLeft  <= distRight  ? 'left' : 'right';
  const snapY = distTop   <= distBottom ? 'top'  : 'bottom';

  const { x, y } = getSnapPosition(bounds.width, bounds.height, snapX, snapY);
  mainWindow.setPosition(x, y);
  return { snapX, snapY };
});

ipcMain.handle('fetch-usage', async () => {
  return new Promise((resolve) => {
    try {
      if (fetchView) {
        try { mainWindow.removeBrowserView(fetchView); } catch(e) {}
        try { fetchView.webContents.destroy(); } catch(e) {}
        fetchView = null;
      }
      fetchView = new BrowserView({
        webPreferences: { session: session.defaultSession, nodeIntegration: false, contextIsolation: true },
      });
      mainWindow.addBrowserView(fetchView);
      fetchView.setBounds({ x: -2000, y: -2000, width: 1280, height: 800 });

      const wc = fetchView.webContents;
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        try { mainWindow.removeBrowserView(fetchView); } catch(e) {}
        try { fetchView.webContents.destroy(); } catch(e) {}
        fetchView = null;
        resolve(result);
      };

      const poll = async (n = 0) => {
        if (resolved) return;
        if (n > 20) {
          const html = await wc.executeJavaScript('document.documentElement.outerHTML');
          done({ html });
          return;
        }
        try {
          const found = await wc.executeJavaScript(`document.querySelector('[role="progressbar"]') !== null`);
          if (found) {
            await new Promise(r => setTimeout(r, 500));
            const html = await wc.executeJavaScript('document.documentElement.outerHTML');
            done({ html });
          } else {
            setTimeout(() => poll(n + 1), 500);
          }
        } catch(e) {
          setTimeout(() => poll(n + 1), 500);
        }
      };

      wc.on('did-finish-load', () => {
        const url = wc.getURL();
        if (url.includes('/login') || url.includes('/auth')) {
          done({ error: 'auth', message: '로그인이 필요합니다' });
          return;
        }
        setTimeout(() => poll(0), 1000);
      });
      wc.on('did-fail-load', (e, code, desc) => done({ error: 'network', message: desc }));
      setTimeout(() => done({ error: 'timeout', message: '시간 초과' }), 20000);
      wc.loadURL('https://claude.ai/settings/usage');
    } catch(e) {
      resolve({ error: 'unknown', message: e.message });
    }
  });
});

ipcMain.on('open-login', () => {
  const w = new BrowserWindow({
    width: 500, height: 700, alwaysOnTop: true,
    webPreferences: { session: session.defaultSession },
  });
  w.loadURL('https://claude.ai/login');
  w.on('closed', () => mainWindow.webContents.send('login-done'));
});
