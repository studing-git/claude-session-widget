process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const { app, BrowserWindow, BrowserView, ipcMain, session, screen } = require('electron');
const updater   = require('./updater');
const providers = require('./providers');
const identity  = require('./browser-identity');

const SNAP_MARGIN = 0;
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

let mainWindow, updateTimer;

// Google 은 임베디드 브라우저로 판단되면 로그인을 거부한다
// ("브라우저 또는 앱이 안전하지 않을 수 있습니다").
// UA 문자열뿐 아니라 Sec-CH-UA 클라이언트 힌트에도 "Electron" 이 들어가므로
// 세션마다 둘 다 평범한 Chrome 값으로 맞춘다 (browser-identity.js).
const CHROME_UA = identity.chromeUserAgent();
app.userAgentFallback = CHROME_UA;

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

// 제공자마다 독립된 영구 세션을 쓴다. 서비스별로 다른 계정을 쓸 수 있고,
// 계정 전환 시 해당 파티션만 비우면 다른 서비스 로그인은 유지된다.
const identityApplied = new Set();
function sessionFor(provider) {
  const ses = provider.partition ? session.fromPartition(provider.partition) : session.defaultSession;
  // 세션마다 한 번만 적용한다. onBeforeSendHeaders 는 마지막 리스너만 유효하므로
  // 중복 등록하면 앞의 것이 조용히 대체된다.
  if (!identityApplied.has(ses)) {
    identity.applyTo(ses);
    identityApplied.add(ses);
  }
  return ses;
}

// 사이트가 실제로 무엇을 보는지 확인용. 로그인이 막히면 이 값부터 본다.
ipcMain.handle('browser-identity', () => ({
  userAgent: CHROME_UA,
  brands: identity.chromeBrands(),
  electronInUA: /Electron/i.test(CHROME_UA),
}));

// 로그인 페이지로 튕겼는지 판별. 제공자마다 로그인 URL 모양이 달라 넉넉하게 본다.
function looksLikeLogin(url) {
  return /\/(login|signin|sign-in|auth)\b/i.test(url) ||
         /accounts\.google\.com/i.test(url) ||
         /\/ServiceLogin/i.test(url);
}

// 제공자 한 곳의 사용량 페이지 HTML을 가져온다.
// 각 제공자가 SPA라 readySelector 가 나타날 때까지 폴링한 뒤 수집한다.
function fetchProviderHtml(provider) {
  return new Promise((resolve) => {
    let view = null;
    try {
      view = new BrowserView({
        webPreferences: { session: sessionFor(provider), nodeIntegration: false, contextIsolation: true },
      });
      mainWindow.addBrowserView(view);
      // 화면 밖에 두어 사용자에게 보이지 않게 한다
      view.setBounds({ x: -2000, y: -2000, width: 1280, height: 900 });

      const wc = view.webContents;
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        try { mainWindow.removeBrowserView(view); } catch (e) {}
        try { wc.destroy(); } catch (e) {}
        resolve(Object.assign({ id: provider.id }, result));
      };

      const grabHtml = () => wc.executeJavaScript('document.documentElement.outerHTML');

      const poll = async (n = 0) => {
        if (resolved) return;
        if (n > 20) {                       // 약 10초 기다린 뒤에는 있는 그대로 수집한다
          try { done({ html: await grabHtml() }); } catch (e) { done({ error: 'unknown', message: e.message }); }
          return;
        }
        try {
          const sel = JSON.stringify(provider.readySelector);
          const found = await wc.executeJavaScript(`document.querySelector(${sel}) !== null`);
          if (found) {
            await new Promise(r => setTimeout(r, 600));   // 값이 채워질 여유
            done({ html: await grabHtml() });
          } else {
            setTimeout(() => poll(n + 1), 500);
          }
        } catch (e) {
          setTimeout(() => poll(n + 1), 500);
        }
      };

      wc.on('did-finish-load', () => {
        if (looksLikeLogin(wc.getURL())) {
          done({ error: 'auth', message: '로그인이 필요합니다' });
          return;
        }
        setTimeout(() => poll(0), 1000);
      });
      wc.on('did-fail-load', (e, code, desc, validatedUrl, isMainFrame) => {
        if (isMainFrame) done({ error: 'network', message: desc });
      });
      setTimeout(() => done({ error: 'timeout', message: '시간 초과' }), 25000);
      wc.loadURL(provider.url);
    } catch (e) {
      try { if (view) mainWindow.removeBrowserView(view); } catch (e2) {}
      resolve({ id: provider.id, error: 'unknown', message: e.message });
    }
  });
}

// 제공자 하나만 조회
ipcMain.handle('fetch-provider', async (e, id) => {
  const provider = providers.get(id);
  if (!provider) return { id, error: 'unknown', message: '알 수 없는 제공자' };
  return fetchProviderHtml(provider);
});

// 여러 제공자를 동시에 조회한다. 순차로 돌리면 3사에 10~15초가 걸린다.
// 한 곳이 실패해도 나머지 결과는 그대로 돌려준다.
ipcMain.handle('fetch-all', async (e, ids) => {
  const list = (Array.isArray(ids) && ids.length ? ids : providers.ids)
    .map(id => providers.get(id))
    .filter(Boolean);
  return Promise.all(list.map(fetchProviderHtml));
});

function openLoginWindow(provider) {
  const w = new BrowserWindow({
    width: 520, height: 720, alwaysOnTop: true,
    title: `${provider.name} 로그인`,
    webPreferences: { session: sessionFor(provider) },
  });
  w.loadURL(provider.loginUrl);
  w.on('closed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('login-done', provider.id);
    }
  });
  return w;
}

ipcMain.on('open-login', (e, id) => {
  const provider = providers.get(id);
  if (provider) openLoginWindow(provider);
});

// 계정 전환: 해당 제공자의 쿠키·저장소를 비운 뒤 로그인 창을 연다.
// 비우지 않으면 사이트가 기존 쿠키를 보고 곧바로 로그인 상태로 넘어가
// 계정 선택 화면이 나오지 않는다.
ipcMain.handle('switch-account', async (e, id) => {
  const provider = providers.get(id);
  if (!provider) return { ok: false, message: '알 수 없는 제공자' };
  try {
    const ses = sessionFor(provider);
    await ses.clearStorageData();
    await ses.clearCache();
    openLoginWindow(provider);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});
