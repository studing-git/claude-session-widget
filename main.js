const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');

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

// 모드 전환 시 창 크기 변경
ipcMain.on('set-size', (e, { w, h }) => {
  mainWindow.setResizable(true);
  mainWindow.setSize(w, h);
  mainWindow.setResizable(false);
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
