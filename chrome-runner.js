// 외부 Chrome 을 이용한 로그인·조회
//
// Electron 내장 브라우저로는 Google 로그인이 차단된다
// ("브라우저 또는 앱이 안전하지 않을 수 있습니다"). UA 와 클라이언트 힌트를
// Chrome 으로 맞춰도 막히는 경우가 있어, 진짜 Chrome 을 쓰는 경로를 둔다.
//
//   로그인: 전용 프로필로 Chrome 창을 띄워 사용자가 직접 로그인한다.
//           진짜 Chrome 이므로 Google 이 차단하지 않는다.
//   조회  : 같은 프로필로 --headless=new --dump-dom 을 실행해 렌더된 DOM 을 읽는다.
//           프로필에 쿠키가 남아 있어 로그인 상태가 그대로 쓰인다.

const { spawn, execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');

// 설치 위치 후보. 앞에 있을수록 우선한다.
// Edge 도 Chromium 기반이고 Google 로그인이 허용되므로 차선책으로 둔다.
function chromeCandidates(platform = process.platform, env = process.env) {
  if (env.CHROME_PATH) return [env.CHROME_PATH];

  if (platform === 'win32') {
    const pf   = env['ProgramFiles']       || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)']  || 'C:\\Program Files (x86)';
    const la   = env['LOCALAPPDATA']       || '';
    const join = (...p) => p.filter(Boolean).join('\\');
    return [
      join(pf,   'Google\\Chrome\\Application\\chrome.exe'),
      join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      la && join(la, 'Google\\Chrome\\Application\\chrome.exe'),
      join(pf,   'Microsoft\\Edge\\Application\\msedge.exe'),
      join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    ].filter(Boolean);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  ];
}

function findChrome(candidates = chromeCandidates(), exists = fs.existsSync) {
  return candidates.find(p => { try { return exists(p); } catch (e) { return false; } }) || null;
}

// 제공자마다 프로필을 나눈다. 서비스별로 다른 계정을 쓸 수 있다.
function profileDir(baseDir, providerId) {
  return path.join(baseDir, 'chrome-profiles', providerId);
}

const COMMON_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,OptimizationHints',
];

function loginArgs(profile, url) {
  return [...COMMON_ARGS, `--user-data-dir=${profile}`, '--new-window', url];
}

function fetchArgs(profile, url, budgetMs = 20000, extraArgs = []) {
  return [
    ...COMMON_ARGS,
    ...extraArgs,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    `--virtual-time-budget=${budgetMs}`,
    '--dump-dom',
    url,
  ];
}

// 프로필이 이미 사용 중이면 헤드리스 실행이 실패한다(로그인 창이 열려 있는 경우).
// 사용자에게 알려줄 수 있도록 따로 판별한다.
function isProfileLocked(stderr = '') {
  return /ProcessSingleton|profile (?:appears to be )?in use|Failed to create a ProcessSingleton/i.test(stderr);
}

// 로그인 창을 띄운다. 사용자가 창을 닫는 시점을 알 수 있도록 프로세스를 돌려준다.
function openLogin(chromePath, profile, url) {
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(chromePath, loginArgs(profile, url), {
    detached: false, stdio: 'ignore', windowsHide: false,
  });
  return child;
}

// 렌더된 DOM 을 문자열로 가져온다.
function fetchHtml(chromePath, profile, url, opts = {}) {
  const budget  = opts.budgetMs || 20000;
  const timeout = opts.timeoutMs || budget + 20000;
  return new Promise((resolve) => {
    fs.mkdirSync(profile, { recursive: true });
    execFile(chromePath, fetchArgs(profile, url, budget, opts.extraArgs || []), {
      timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    }, (err, stdout, stderr) => {
      if (isProfileLocked(stderr || '')) {
        resolve({ error: 'chrome_busy',
                  message: 'Chrome 로그인 창을 닫은 뒤 다시 시도해 주세요' });
        return;
      }
      if (err && !stdout) {
        resolve({ error: 'chrome_failed', message: (stderr || err.message || '').trim().slice(0, 200) });
        return;
      }
      if (!stdout || stdout.length < 200) {
        resolve({ error: 'chrome_empty', message: '빈 페이지가 반환되었습니다' });
        return;
      }
      resolve({ html: stdout });
    });
  });
}

module.exports = {
  chromeCandidates, findChrome, profileDir,
  loginArgs, fetchArgs, isProfileLocked,
  openLogin, fetchHtml,
};
