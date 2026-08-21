process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const { app, BrowserWindow, BrowserView, ipcMain, session, screen } = require('electron');
const updater = require('./updater');

const SNAP_MARGIN = 10;
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

let mainWindow, fetchView, updateTimer;

function getSnapPosition(w, h, snapX, snapY) {
  const [wx, wy] = mainWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: wx, y: wy });
  const wa = display.workArea;
  const x = snapX === 'left' ? wa.x + SNAP_MARGIN : wa.x + wa.width  - w - SNAP_MARGIN;
  const y = snapY === 'top'  ? wa.y + SNAP_MARGIN : wa.y + wa.height - h - SNAP_MARGIN;
  return { x, y };
}

// 위젯이 중복 실행되면 두 프로세스가 같은 캐시 디렉터리를 다투게 되어
// "Unable to move the cache (0x5)" 류의 오류가 나고 창도 여러 개 뜬다.
// 두 번째 실행은 기존 창을 앞으로 가져오고 스스로 종료한다.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
      width: 580,
      height: 240,
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

    // 시작 시 확인은 렌더러가 준비된 뒤 직접 호출한다(check-update). 이후 30분마다 재확인.
    updateTimer = setInterval(runUpdateCheck, UPDATE_CHECK_INTERVAL);
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (updateTimer) clearInterval(updateTimer); });

async function runUpdateCheck() {
  const res = await updater.checkForUpdate();
  if (res.available && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-available', res);
  }
  return res;
}

ipcMain.handle('check-update', () => runUpdateCheck());

ipcMain.handle('apply-update', async () => {
  const res = await updater.applyUpdate();
  if (res.ok && res.restart) {
    setTimeout(() => {
      // relaunch는 "현재 인스턴스가 종료될 때" 새 인스턴스를 띄우므로 락이 겹칠 수 있다.
      // 미리 해제해 두어야 재시작된 인스턴스가 중복으로 판단되어 즉시 종료되지 않는다.
      app.releaseSingleInstanceLock();
      app.relaunch();
      app.exit(0);
    }, 400);
  }
  return res;
});

ipcMain.on('move-window', (e, { dx, dy }) => {
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});
ipcMain.on('close-window', () => app.quit());
ipcMain.on('minimize-window', () => mainWindow.minimize());

ipcMain.on('set-size', (e, { w, h, snapX, snapY }) => {
  const [, ch] = mainWindow.getSize();
  const newH = h ?? ch;
  mainWindow.setResizable(true);
  mainWindow.setSize(w, newH);
  mainWindow.setResizable(false);
  if (snapX && snapY) {
    const { x, y } = getSnapPosition(w, newH, snapX, snapY);
    mainWindow.setPosition(x, y);
  }
});

ipcMain.on('resize-height', (e, { h, snapX, snapY }) => {
  const [w] = mainWindow.getSize();
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
          const found = await wc.executeJavaScript(`document.querySelector('[role="meter"]') !== null`);
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
