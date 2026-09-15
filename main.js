process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const { app, BrowserWindow, BrowserView, ipcMain, session, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const updater   = require('./updater');
const providers = require('./providers');
const identity  = require('./browser-identity');
const settings  = require('./settings');
const cookieTools = require('./cookie-tools');
const extServer   = require('./extension-server');

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

    cleanupChromeProfiles();   // 예전 위젯 전용 Chrome 프로필 정리

    // 확장 프로그램이 보낸 사용량/쿠키를 받는 로컬 서버
    extServer.start({
      isKnownProvider: (id) => !!providers.get(id),
      onReport: (report) => {
        extensionReports[report.id] = report;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension-report', report.id);
        }
      },
      onCookies: (payload) => { ingestCookies(payload); },
    });
  });
}

// 확장이 보낸 세션 쿠키를 위젯 세션에 주입한다. 한 번 주입하면 defaultSession 이
// 디스크에 보관하므로, 브라우저를 닫아도 위젯이 그 쿠키로 사용량을 단독 조회한다.
// 주입 직후 그 제공자를 한 번 조회해 값을 즉시 갱신하고 렌더러에 알린다.
async function ingestCookies(payload) {
  const provider = providers.get(payload.id);
  if (!provider) return;
  // 확장이 살아 있다는 신호. 사용량 보고(/report)는 사용자가 사용량 페이지에
  // 있을 때만 오므로, 연결 여부는 쿠키 기부 시각으로도 판단해야 한다.
  cookieContact[provider.id] = Date.now();
  try {
    const res = await cookieTools.setCookies(sessionFor(), payload.cookies);
    // 쿠키 값은 절대 남기지 않는다 — 주입 개수만 기록한다
    console.log(`[cookies] ${provider.id}: 주입 ${res.set}개 (실패 ${res.failed})`);
  } catch (e) {
    console.error(`[cookies] ${provider.id}: 주입 실패 — ${e.message}`);
    return;
  }
  // 기부는 주기적으로 오지만 대개 내용이 그대로다. 값이 실제로 바뀐 경우에만
  // 다시 조회해 같은 쿠키로 사이트를 반복 호출하지 않는다.
  const fp = cookieFingerprint(payload.cookies);
  if (fp === cookiePrints[provider.id]) return;
  cookiePrints[provider.id] = fp;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cookies-updated', provider.id);
  }
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

// PR #16 에서 제공자별 파티션으로 나눴다가, 예전 로그인이 끊겨 되돌렸다.
// 세 제공자는 도메인이 다르므로 한 세션을 공유해도 서로 다른 계정을 쓸 수 있고,
// 계정 전환은 해당 도메인 쿠키만 지우면 된다.
let identityApplied = false;
function sessionFor() {
  const ses = session.defaultSession;
  // onBeforeSendHeaders 는 마지막 리스너만 유효하므로 한 번만 등록한다
  if (!identityApplied) { identity.applyTo(ses); identityApplied = true; }
  return ses;
}

// 마지막 조회에서 어디에 도착했고 무엇을 받았는지 기록해 둔다
const lastFetch = {};

// 확장 프로그램이 보낸 최신 사용량 (id -> report)
const extensionReports = {};
const EXTENSION_FRESH_MS = 20 * 60 * 1000;   // 20분 이내 보고만 유효로 본다
function freshExtensionReport(id) {
  const r = extensionReports[id];
  return r && (Date.now() - r.at) < EXTENSION_FRESH_MS ? r : null;
}

// 확장이 마지막으로 쿠키를 넘긴 시각 / 그 쿠키의 지문(값은 보관하지 않는다)
const cookieContact = {};
const cookiePrints  = {};

// 쿠키가 실제로 바뀌었는지만 알면 되므로 해시로 비교한다(원본 값은 남기지 않는다)
function cookieFingerprint(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  const text = list.map(c => `${c.name}=${c.value}`).sort().join('\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

// 확장과 연결돼 있는가 — 사용량 보고 또는 쿠키 기부 중 하나만 최근이면 연결로 본다.
// 사용량 보고는 사용자가 사용량 페이지에 있을 때만 오므로 그것만 보면
// 멀쩡히 동작하는 중에도 "끊김" 으로 보인다.
function extensionLinked(id) {
  if (freshExtensionReport(id)) return true;
  const at = cookieContact[id];
  return !!at && (Date.now() - at) < EXTENSION_FRESH_MS;
}

// 로그인 상태 진단: 제공자별로 세션에 쿠키가 몇 개 있는지 본다.
// "로그인했는데 안 된다" 일 때 쿠키가 실제로 저장됐는지부터 확인할 수 있다.
ipcMain.handle('session-report', async () => {
  const ses = sessionFor();
  const rows = [];
  for (const p of providers.PROVIDERS) {
    const cookies = await cookieTools.cookiesFor(ses, p.cookieDomains);
    const authed = cookieTools.hasAuthCookie(cookies, p.authCookies);
    const last = lastFetch[p.id] || {};
    rows.push({
      제공자: p.name,
      로그인: authed === null ? '?' : authed ? '예' : '아니오',
      쿠키수: cookies.length,
      // 인증 쿠키 이름을 못 맞혔을 수도 있으므로 전체 이름을 그대로 보여준다
      쿠키이름: cookies.map(c => c.name).join(' '),
      확장: extensionLinked(p.id) ? '연결됨' : '없음',
      최종URL: last.finalUrl || '',
      조회방식: freshExtensionReport(p.id) ? 'extension' : 'widget',
    });
  }
  return rows;
});

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
        webPreferences: { session: sessionFor(), nodeIntegration: false, contextIsolation: true },
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
      const finalUrl = () => { try { return wc.getURL(); } catch (e) { return ''; } };

      const poll = async (n = 0) => {
        if (resolved) return;
        if (n > 20) {                       // 약 10초 기다린 뒤에는 있는 그대로 수집한다
          try { done({ html: await grabHtml(), finalUrl: finalUrl(), waited: true }); }
          catch (e) { done({ error: 'unknown', message: e.message }); }
          return;
        }
        try {
          const sel = JSON.stringify(provider.readySelector);
          const found = await wc.executeJavaScript(`document.querySelector(${sel}) !== null`);
          if (found) {
            await new Promise(r => setTimeout(r, 600));   // 값이 채워질 여유
            done({ html: await grabHtml(), finalUrl: finalUrl() });
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
        // ChatGPT 는 사용량이 해시 라우트(#settings/Usage)라 새로 로드하면 설정
        // 패널이 자동으로 안 열린다. 라우트를 한 번 흔들어 사용량 화면을 띄운다
        // (확장 content-collect.js 의 nudgeChatgptUsage 와 같은 방식).
        if (provider.hashNudge) {
          wc.executeJavaScript(
            "location.hash='settings';setTimeout(function(){location.hash='settings/Usage';},150);"
          ).catch(() => {});
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

// ── 외부 Chrome 경로 ──
function userDataDir() { return app.getPath('userData'); }

// 예전에 쓰던 위젯 전용 Chrome 프로필을 정리한다.
// 그 프로필은 사용자의 실제(로그인된) 브라우저와 무관한 빈 프로필이라
// 혼란만 준다. 이제 실제 브라우저 활용은 확장 프로그램이 담당한다.
function cleanupChromeProfiles() {
  try {
    const dir = path.join(userDataDir(), 'chrome-profiles');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
  // 조회 방식이 chrome 으로 저장돼 있던 것을 모두 위젯 세션으로 되돌린다
  try {
    for (const id of providers.ids) {
      if (settings.getBackend(userDataDir(), id) === 'chrome') {
        settings.setBackend(userDataDir(), id, 'electron');
      }
    }
  } catch (e) {}
}

// 받아온 HTML 을 파일로 남긴다. "로그인했는데 안 된다" 일 때
// 실제로 무엇을 받았는지(로그인 페이지인지 사용량 페이지인지) 직접 볼 수 있어야 한다.
function saveDebugHtml(id, html) {
  try {
    const dir = path.join(userDataDir(), 'debug');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.html`);
    fs.writeFileSync(file, html);
    return file;
  } catch (e) { return ''; }
}

async function fetchOne(provider) {
  // 확장 프로그램이 최근에 보낸 값이 있으면 브라우저 조회 없이 그대로 쓴다.
  // 사용자의 로그인된 실제 브라우저에서 읽은 값이라 별도 로그인이 필요 없다.
  const ext = freshExtensionReport(provider.id);
  if (ext) {
    return { id: provider.id, fromExtension: true,
             plan: ext.plan, note: ext.note, metrics: ext.metrics };
  }
  const res = await fetchProviderHtml(provider);
  if (res.html) res.debugFile = saveDebugHtml(provider.id, res.html);
  lastFetch[provider.id] = { finalUrl: res.finalUrl || '', debugFile: res.debugFile || '' };
  // 지표를 못 찾았을 때 원인이 미로그인인지 구분할 수 있게 인증 여부를 함께 보낸다
  try {
    res.authed = await cookieTools.isAuthenticated(
      sessionFor(), provider.cookieDomains, provider.authCookies);
  } catch (e) { /* 판단 불가면 그대로 둔다 */ }
  return res;
}

ipcMain.handle('extension-status', () => ({
  connected: providers.ids.filter(extensionLinked),
}));

// 사용자의 실제(기본) 브라우저에서 사용량 페이지를 연다 — 이미 그 브라우저가
// 켜져 있으면 새 탭으로 열린다. 그 페이지에서 확장 프로그램의 콘텐츠 스크립트가
// 실행되어 위젯으로 값을 보낸다. (로그인 URL 이 아니라 사용량 URL 을 열어야
//  콘텐츠 스크립트의 matches 에 걸린다)
ipcMain.handle('open-external', async (e, target) => {
  const provider = providers.get(target);
  const url = provider ? provider.url : (typeof target === 'string' ? target : '');
  if (!/^https?:\/\//.test(url)) return { ok: false, message: '잘못된 주소' };
  try { await shell.openExternal(url); return { ok: true }; }
  catch (err) { return { ok: false, message: err.message }; }
});

// 위젯이 만들었던 Chrome 전용 프로필을 삭제하고 조회 방식을 되돌린다
ipcMain.handle('reset-chrome-profiles', () => {
  cleanupChromeProfiles();
  return { ok: true };
});

// 제공자 하나만 조회
ipcMain.handle('fetch-provider', async (e, id) => {
  const provider = providers.get(id);
  if (!provider) return { id, error: 'unknown', message: '알 수 없는 제공자' };
  return fetchOne(provider);
});

// 여러 제공자를 동시에 조회한다. 순차로 돌리면 3사에 10~15초가 걸린다.
// 한 곳이 실패해도 나머지 결과는 그대로 돌려준다.
ipcMain.handle('fetch-all', async (e, ids) => {
  const list = (Array.isArray(ids) && ids.length ? ids : providers.ids)
    .map(id => providers.get(id))
    .filter(Boolean);
  return Promise.all(list.map(fetchOne));
});

// 계정 전환: 확장 프로그램은 사용자의 평소 브라우저 계정을 그대로 읽으므로,
// 위젯 내장 창이 아니라 실제 브라우저에서 계정을 바꾸도록 그 브라우저를 연다.
// (구글은 계정 선택 화면, Claude·ChatGPT 는 로그인 화면 — 로그아웃 후 다른 계정으로)
// 계정을 바꾸고 사용량 페이지를 열면 확장이 새 계정 값을 위젯으로 보낸다.
ipcMain.handle('switch-account', async (e, id) => {
  const provider = providers.get(id);
  if (!provider) return { ok: false, message: '알 수 없는 제공자' };
  const url = provider.switchUrl || provider.loginUrl || provider.url;
  if (!/^https?:\/\//.test(url)) return { ok: false, message: '잘못된 주소' };
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});
