const { app, BrowserWindow, BrowserView, ipcMain, session, screen } = require('electron');
const path = require('path');

const SNAP_MARGIN = 10; // 화면 모서리로부터의 여백(px)

function getSnapPosition(w, h, snapX, snapY) {
  const [wx, wy] = mainWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: wx, y: wy });
  const wa = display.workArea;
  const x = snapX === 'left' ? wa.x + SNAP_MARGIN : wa.x + wa.width - w - SNAP_MARGIN;
  const y = snapY === 'top'  ? wa.y + SNAP_MARGIN : wa.y + wa.height - h - SNAP_MARGIN;
  return { x, y };
}

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 580,
    height: 280,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('index.html');
});

app.on('window-all-closed', () => {
  app.quit();
});

// 창 드래그 이동
ipcMain.on('move-window', (e, { x, y }) => {
  const [wx, wy] = mainWindow.getPosition();
  mainWindow.setPosition(wx + x, wy + y);
});

// 앱 종료
ipcMain.on('close-window', () => {
  app.quit();
});

// 창 최소화
ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

// 모드 전환 시 창 크기 변경 + 모서리 유지
ipcMain.on('set-size', (e, { w, h, snapX, snapY }) => {
  mainWindow.setResizable(true);
  mainWindow.setSize(w, h);
  mainWindow.setResizable(false);
  if (snapX && snapY) {
    const { x, y } = getSnapPosition(w, h, snapX, snapY);
    mainWindow.setPosition(x, y);
  }
});

// 드래그 종료 후 가장 가까운 모서리로 snap
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

// 로그인 창 열기
ipcMain.on('open-login', () => {
  const loginWin = new BrowserWindow({
    width: 500,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  loginWin.loadURL('https://claude.ai/login');

  loginWin.webContents.on('did-navigate', (e, url) => {
    if (url.startsWith('https://claude.ai') && !url.includes('/login')) {
      mainWindow.webContents.send('login-done');
      loginWin.close();
    }
  });
});

// usage 데이터 fetch
ipcMain.handle('fetch-usage', async () => {
  return new Promise((resolve, reject) => {
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: session.defaultSession,
      },
    });

    mainWindow.addBrowserView(view);
    // 화면 밖에 숨김
    view.setBounds({ x: -2000, y: -2000, width: 1280, height: 900 });

    view.webContents.loadURL('https://claude.ai/settings/usage');

    view.webContents.once('did-finish-load', () => {
      // 1초 대기 후 폴링 시작
      setTimeout(() => {
        let attempts = 0;
        const maxAttempts = 40; // 최대 20초

        const poll = setInterval(async () => {
          attempts++;
          try {
            const found = await view.webContents.executeJavaScript(
              `document.querySelectorAll('[role="progressbar"]').length > 0`
            );

            if (found || attempts >= maxAttempts) {
              clearInterval(poll);

              if (!found) {
                mainWindow.removeBrowserView(view);
                view.webContents.destroy();
                reject(new Error('progressbar not found after timeout'));
                return;
              }

              // 0.5초 추가 대기 후 추출
              setTimeout(async () => {
                try {
                  const html = await view.webContents.executeJavaScript(
                    `document.body.outerHTML`
                  );
                  mainWindow.removeBrowserView(view);
                  view.webContents.destroy();
                  resolve(html);
                } catch (err) {
                  mainWindow.removeBrowserView(view);
                  view.webContents.destroy();
                  reject(err);
                }
              }, 500);
            }
          } catch (err) {
            clearInterval(poll);
            mainWindow.removeBrowserView(view);
            view.webContents.destroy();
            reject(err);
          }
        }, 500);
      }, 1000);
    });

    view.webContents.once('did-fail-load', (e, code, desc) => {
      mainWindow.removeBrowserView(view);
      view.webContents.destroy();
      reject(new Error(`Page load failed: ${desc}`));
    });
  });
});
