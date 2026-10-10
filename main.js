process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const { app, BrowserWindow, BrowserView, ipcMain, session, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const updater   = require('./updater');
const providers = require('./providers');
const identity  = require('./browser-identity');
const settings  = require('./settings');
const cookieTools = require('./cookie-tools');
const chrome      = require('./chrome-runner');

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

    // (전용 Chrome 프로필은 로그인 상태를 담고 있으므로 시작 시 지우지 않는다.
    //  필요하면 reset-chrome-profiles / switch-account 로 그때그때 비운다.)
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

// 로그인 상태 진단: 제공자별로 세션에 쿠키가 몇 개 있는지 본다.
// "로그인했는데 안 된다" 일 때 쿠키가 실제로 저장됐는지부터 확인할 수 있다.
// (Chrome 조회는 쿠키가 Electron 세션이 아니라 전용 Chrome 프로필에 있으므로
//  여기 쿠키수가 0 이어도 정상이다 — 조회방식으로 구분한다.)
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
      최종URL: last.finalUrl || '',
      조회방식: backendOf(p.id),
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
// opts 로 다른 페이지를 같은 방식으로 읽을 수 있다 (예: ChatGPT 결제 화면).
// { url, readySelector, hash } 를 주면 그쪽을 읽고, 없으면 사용량 페이지를 읽는다.
function fetchProviderHtml(provider, opts = {}) {
  const url      = opts.url || provider.url;
  const readySel = opts.readySelector || provider.readySelector;
  const hash     = opts.hash || 'settings/Usage';
  // extract 가 있으면 HTML 을 통째로 받아오는 대신, 그 자바스크립트를 페이지
  // 안에서 평가한 결과만 받는다. main 프로세스에는 DOM 이 없으므로, DOM 이 필요한
  // 추출(플랜 이름 등)은 이렇게 살아 있는 페이지 쪽에서 해야 한다.
  const extractJs = opts.extract || '';
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
      const collect  = async (extra) => extractJs
        ? Object.assign({ value: await wc.executeJavaScript(extractJs) }, extra)
        : Object.assign({ html: await grabHtml(), finalUrl: finalUrl() }, extra);

      const poll = async (n = 0) => {
        if (resolved) return;
        if (n > 20) {                       // 약 10초 기다린 뒤에는 있는 그대로 수집한다
          try { done(await collect({ waited: true })); }
          catch (e) { done({ error: 'unknown', message: e.message }); }
          return;
        }
        try {
          const sel = JSON.stringify(readySel);
          const found = await wc.executeJavaScript(`document.querySelector(${sel}) !== null`);
          if (found) {
            await new Promise(r => setTimeout(r, 600));   // 값이 채워질 여유
            done(await collect());
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
            "location.hash='settings';setTimeout(function(){location.hash=" +
            JSON.stringify(hash) + ";},150);"
          ).catch(() => {});
        }
        setTimeout(() => poll(0), 1000);
      });
      wc.on('did-fail-load', (e, code, desc, validatedUrl, isMainFrame) => {
        if (isMainFrame) done({ error: 'network', message: desc });
      });
      setTimeout(() => done({ error: 'timeout', message: '시간 초과' }), 25000);
      wc.loadURL(url);
    } catch (e) {
      try { if (view) mainWindow.removeBrowserView(view); } catch (e2) {}
      resolve({ id: provider.id, error: 'unknown', message: e.message });
    }
  });
}

// ── 외부 Chrome 경로 ──
function userDataDir() { return app.getPath('userData'); }

// 한 제공자의 전용 Chrome 프로필만 지운다 (계정 전환 시).
function removeChromeProfile(id) {
  try {
    const dir = chrome.profileDir(userDataDir(), id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
}

// 전용 Chrome 프로필을 모두 지우고 조회 방식을 Electron 으로 되돌린다.
// (reset-chrome-profiles IPC — 사용자가 Chrome 방식을 완전히 접을 때)
function cleanupChromeProfiles() {
  try {
    const dir = path.join(userDataDir(), 'chrome-profiles');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {}
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

// Chrome 조회가 HTML 을 못 받고 실패했을 때, 실제 원인(종료 코드·stderr·실행 인자)을
// 파일로 남긴다. "command failed / 읽기 실패" 가 떴을 때 사용자가 이 파일만 보내 주면
// 잠금인지, 실행 실패인지, 시간 초과인지 바로 알 수 있다. (민감정보는 담기지 않는다 —
// 쿠키 값은 stderr/인자에 없다.)
function saveChromeError(id, res) {
  try {
    const dir = path.join(userDataDir(), 'debug');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}-chrome.txt`);
    fs.writeFileSync(file, [
      `[${new Date().toISOString()}] ${id}`,
      `error    : ${res.error || ''}`,
      `message  : ${res.message || ''}`,
      `exitCode : ${res.exitCode}`,
      `args     : ${(res.args || []).join(' ')}`,
      '--- stderr ---',
      res.stderr || '(없음)',
    ].join('\n'));
    return file;
  } catch (e) { return ''; }
}

// ── 구독 플랜 ──
// 플랜은 사용량과 다른 화면에 있고(ChatGPT 는 설정의 결제 탭) 거의 바뀌지 않는다.
// 조회가 비싸므로 캐시해 두고 오래됐을 때만 다시 읽는다. 값은 설정 파일에 남겨
// 위젯을 재시작해도 곧바로 보여줄 수 있게 한다.
const PLAN_TTL_MS = 12 * 60 * 60 * 1000;
const planCache = {};          // id -> { plan, at }
let planLoaded = false;

function loadPlanCache() {
  if (planLoaded) return;
  planLoaded = true;
  const saved = (settings.read(userDataDir()) || {}).plans || {};
  for (const [id, v] of Object.entries(saved)) {
    if (v && typeof v.plan === 'string') planCache[id] = { plan: v.plan, at: v.at || 0 };
  }
}

function cachedPlan(id) {
  loadPlanCache();
  const c = planCache[id];
  return c ? c.plan : '';
}

function savePlanCache() {
  const data = settings.read(userDataDir()) || {};
  data.plans = planCache;
  settings.write(userDataDir(), data);
}

// 플랜 화면을 읽어 캐시를 채운다. 느려도 사용자 체감에 영향이 없도록
// 호출자는 기다리지 않는다(결과는 다음 갱신이나 plan-updated 알림에 반영).
let planInFlight = {};
async function ensurePlan(provider) {
  if (!provider.planUrl || typeof provider.parsePlan !== 'function') return;
  loadPlanCache();
  const c = planCache[provider.id];
  if (c && c.plan && (Date.now() - c.at) < PLAN_TTL_MS) return;
  if (planInFlight[provider.id]) return;
  planInFlight[provider.id] = true;
  try {
    // main 프로세스엔 DOM 이 없으므로 파서를 페이지 안에서 실행한다
    const res = await fetchProviderHtml(provider, {
      url: provider.planUrl,
      readySelector: provider.planReadySelector,
      hash: provider.planHash,
      extract: '(' + provider.parsePlan.toString() + ')(document)',
    });
    const plan = typeof res.value === 'string' ? res.value.trim() : '';
    const before = c && c.plan;
    // 못 읽었는데 예전 값이 있으면 지우지 않는다 (일시적 실패로 표시가 사라지지 않게)
    planCache[provider.id] = { plan: plan || before || '', at: Date.now() };
    savePlanCache();
    if (plan) console.log(`[plan] ${provider.id}: ${plan}`);
    if (plan && plan !== before && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('plan-updated', provider.id);
    }
  } catch (e) {
    console.error(`[plan] ${provider.id}: 읽기 실패 — ${e.message}`);
  } finally {
    planInFlight[provider.id] = false;
  }
}

// ── 전용 Chrome 조회 ──
// Electron 임베디드 브라우저는 Google 에 "안전하지 않은 브라우저"로 막힌다.
// 진짜 Chrome(전용 프로필)으로 로그인·조회하면 막히지 않는다. Chrome 이 설치돼
// 있으면 이 방식을 기본으로 쓰고, 없으면 Electron 조회로 폴백한다.
let chromePathCache;
function chromePath() {
  if (chromePathCache === undefined) chromePathCache = chrome.findChrome();
  return chromePathCache;
}
// 제공자별 조회 방식. Chrome 이 없으면 무조건 electron.
function backendOf(id) {
  return chromePath() ? settings.getBackend(userDataDir(), id) : 'electron';
}
function fetchViaChrome(provider) {
  return chrome
    .fetchHtml(chromePath(), chrome.profileDir(userDataDir(), provider.id), provider.url)
    .then(res => Object.assign({ id: provider.id }, res));
}

async function fetchOne(provider) {
  // 플랜은 사용량과 다른 화면에 있어 따로 읽는다. 조회가 느려지지 않도록
  // 기다리지 않고, 캐시에 있는 값을 먼저 쓴다(처음엔 비어 있다가 곧 채워진다).
  ensurePlan(provider).catch(() => {});
  const planned = (plan) => (plan ? { planOverride: plan } : {});

  const useChrome = backendOf(provider.id) === 'chrome';
  const res = useChrome ? await fetchViaChrome(provider) : await fetchProviderHtml(provider);
  if (res.html) res.debugFile = saveDebugHtml(provider.id, res.html);
  else if (useChrome && res.error) res.debugFile = saveChromeError(provider.id, res);
  lastFetch[provider.id] = { finalUrl: res.finalUrl || '', debugFile: res.debugFile || '' };
  // 지표를 못 찾았을 때 원인이 미로그인인지 구분할 수 있게 인증 여부를 함께 보낸다.
  // Chrome 프로필의 쿠키는 Electron 세션에 없으므로 그쪽은 인증 판정을 건너뛴다.
  if (!useChrome) {
    try {
      res.authed = await cookieTools.isAuthenticated(
        sessionFor(), provider.cookieDomains, provider.authCookies);
    } catch (e) { /* 판단 불가면 그대로 둔다 */ }
  }
  return Object.assign(res, planned(cachedPlan(provider.id)));
}

// 전용 Chrome 조회가 가능한지 / 어느 제공자가 Chrome 조회인지 알린다.
ipcMain.handle('chrome-status', () => ({
  available: !!chromePath(),
  backends: Object.fromEntries(providers.ids.map(id => [id, backendOf(id)])),
}));

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

// ── 위젯 안에서 직접 로그인 ──
// 확장 없이도 쓸 수 있는 기본 경로. 이 창에서 로그인하면 쿠키가 위젯 세션
// (defaultSession, 디스크 영속)에 바로 저장되고, 기존 오프스크린 조회가 그
// 쿠키를 그대로 쓴다. 사이트가 직접 심어 주는 쿠키라 확장이 넘겨준 세션 쿠키에
// 만료를 억지로 붙일 필요도 없다.
//
// 한때 이 경로를 들어냈던 이유는 Google 이었다 — 임베디드 브라우저에서 Google
// 로그인을 거부한다("브라우저 또는 앱이 안전하지 않을 수 있습니다"). Gemini 를
// 뺀 지금은 Claude·ChatGPT 의 이메일 로그인만 쓰면 되므로 다시 쓸 수 있다.
// 다만 Google 계정으로 로그인하면 여전히 막히므로, 그때는 확장 경로를 쓴다.
function openLoginWindow(provider) {
  const label = `[위젯] ${provider.name} 로그인`;
  const w = new BrowserWindow({
    width: 520, height: 720, alwaysOnTop: true,
    title: label, autoHideMenuBar: true,
    webPreferences: { session: sessionFor() },
  });
  // 페이지가 제목을 덮어쓰면 위젯 창인지 별도 앱인지 구분할 수 없다
  w.setTitle(label);
  w.on('page-title-updated', (e) => { e.preventDefault(); });

  const notify = (authed) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('login-done', provider.id, { authed });
    }
  };

  // 로그인이 끝나면 창은 그냥 그 서비스 앱 화면이 된다. 창을 닫을 때까지 기다리면
  // 위젯이 아무 신호도 못 받으므로, 인증 쿠키가 생기는 순간을 직접 감시한다.
  let done = false;
  const timer = setInterval(async () => {
    if (done || w.isDestroyed()) return;
    let authed = false;
    try {
      authed = await cookieTools.isAuthenticated(
        sessionFor(), provider.cookieDomains, provider.authCookies);
    } catch (e) { return; }
    if (!authed) return;
    done = true;
    clearInterval(timer);
    if (!w.isDestroyed()) w.setTitle(`${label} — 완료, 창을 닫아도 됩니다`);
    notify(true);                       // 창이 열려 있어도 위젯은 바로 갱신된다
  }, 1000);

  w.on('closed', async () => {
    clearInterval(timer);
    if (done) { notify(true); return; }
    let authed = null;
    try {
      authed = await cookieTools.isAuthenticated(
        sessionFor(), provider.cookieDomains, provider.authCookies);
    } catch (e) {}
    notify(authed);
  });

  // 인증 쿠키 이름을 잘못 알고 있을 수도 있다. 쿠키에 의존하지 않는 신호도 함께 본다:
  // 로그인 페이지를 벗어나 그 서비스의 일반 페이지로 이동하면 로그인된 것으로 본다.
  w.webContents.on('did-navigate', (e, url) => {
    if (done || looksLikeLogin(url)) return;
    setTimeout(() => {
      if (done || w.isDestroyed()) return;
      done = true;
      clearInterval(timer);
      if (!w.isDestroyed()) w.setTitle(`${label} — 완료, 창을 닫아도 됩니다`);
      notify(true);
    }, 1500);          // 리다이렉트가 이어질 수 있어 잠시 기다린다
  });

  w.loadURL(provider.loginUrl);
  return w;
}

// 위젯 안에서 로그인한다 (확장 없이 쓰는 기본 경로)
// 진짜 Chrome 창을 띄워 로그인하고, 그 제공자를 Chrome 조회로 전환한다.
//
// 예전에는 spawn 한 프로세스의 'exit' 를 로그인 완료 신호로 삼았는데, Windows 에서는
// 기존 Chrome 인스턴스가 떠 있으면 실행한 chrome.exe 런처가 (실제 브라우저 창을
// 띄운 뒤) 로그인 전에 먼저 끝나 버린다. 그러면 위젯이 "로그인 끝" 으로 오판해
// 로그인 창이 아직 열려 있는데 조회를 시도하고, 같은 프로필이 잠겨 있어 실패했다.
// 그래서 'exit' 에 기대지 않는다. 완료 감지는 렌더러가 "조회가 될 때까지" 폴링한다
// (startLoginWatch) — 로그인 창이 열려 있는 동안엔 프로필 잠금(busy)이라 계속 기다리고,
// 사용자가 창을 닫아 잠금이 풀리면 그때 조회가 성공한다.
function openChromeLogin(provider) {
  const exe = chromePath();
  const profile = chrome.profileDir(userDataDir(), provider.id);
  const child = chrome.openLogin(exe, profile, provider.loginUrl);
  settings.setBackend(userDataDir(), provider.id, 'chrome');
  child.on('error', (err) => console.error(`[login] ${provider.id}: Chrome 실행 실패 — ${err.message}`));
  return child;
}

ipcMain.handle('open-login', (e, id) => {
  const provider = providers.get(id);
  if (!provider) return { ok: false, message: '알 수 없는 제공자' };
  try {
    if (chromePath()) { openChromeLogin(provider); return { ok: true, backend: 'chrome' }; }
    openLoginWindow(provider);                 // Chrome 이 없으면 Electron 창
    return { ok: true, backend: 'electron' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// 계정 전환: 그 제공자의 로그인을 비우고 다시 로그인한다.
//  - Chrome 조회면 전용 프로필 폴더를 통째로 지운다(그 프로필의 로그인만).
//  - Electron 조회면 위젯 세션의 그 도메인 쿠키만 지운다.
// 지우지 않으면 사이트가 기존 로그인을 인정해 계정 선택 화면이 안 나온다.
ipcMain.handle('switch-account', async (e, id) => {
  const provider = providers.get(id);
  if (!provider) return { ok: false, message: '알 수 없는 제공자' };
  try {
    if (backendOf(provider.id) === 'chrome') {
      removeChromeProfile(provider.id);
      openChromeLogin(provider);
      return { ok: true, backend: 'chrome' };
    }
    const res = await cookieTools.removeFor(sessionFor(), provider.cookieDomains);
    console.log(`[switch] ${provider.id}: 쿠키 ${res.removed}/${res.found}개 삭제`);
    openLoginWindow(provider);
    return { ok: true, backend: 'electron' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

