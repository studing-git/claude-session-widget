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
  // 로그인 창은 "평범한 Chrome" 이어야 한다. 한때 디버깅 포트(--remote-debugging-port)를
  // 붙여 로그인 완료를 자동 감지하려 했으나, Cloudflare 의 "사람인지 확인(Turnstile)"이
  // 그 포트를 봇 신호로 보고 무한 루프에 빠뜨렸다(체크해도 안 넘어감). 그래서 자동화
  // 냄새가 나는 플래그는 붙이지 않는다. 사용자가 로그인한 뒤 창을 닫으면 반영한다.
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
//
// "Failed to create a ProcessSingleton" 은 플랫폼 공통 메시지(chrome_main_delegate)
// 이지만, Windows·mac 은 상황에 따라 다른 문구를 내므로 넉넉하게 본다.
function isProfileLocked(stderr = '') {
  return /ProcessSingleton|SingletonLock|lock ?file|profile (?:appears to be |is )?in use|in use by another|being used by|already (?:running|in use)|the process cannot access the file because it is being used/i
    .test(stderr);
}

// execFile 결과를 조회 결과로 분류한다. 실행 실패·잠금·시간초과·빈 페이지를 구분해야
// 호출자가 "로그인 창을 닫으세요(busy)" 와 "진짜 실패(failed)" 를 다르게 안내할 수 있다.
// 순수 함수로 두어 단위 테스트가 쉽다.
//   errCode : execFile err.code (정상 종료는 0, 실행 파일 없음은 'ENOENT', 그 외 종료 코드)
//   killed  : 타임아웃 등으로 강제 종료됐는지
function classifyFetch({ errCode = 0, killed = false, stdout = '', stderr = '' } = {}) {
  const out = stdout || '';
  if (errCode === 'ENOENT') {
    return { error: 'chrome_failed', message: 'Chrome 실행 파일을 찾지 못했습니다' };
  }
  // 로그인 창이 같은 프로필을 점유 중 — 오류가 아니라 "창을 닫으면 됩니다" 안내 대상.
  // Windows 는 이때 stderr 없이 종료 코드 21(프로필 사용 중/ProcessSingleton)만 남긴다.
  // 리눅스에서도 같은 코드라, 메시지를 못 알아봐도 코드로 잠금을 판단한다.
  if (errCode === 21 || isProfileLocked(stderr)) {
    return { error: 'chrome_busy', message: 'Chrome 로그인 창을 닫은 뒤 다시 시도해 주세요' };
  }
  // 강제 종료되고 아무것도 못 받음 — 대개 로그인 창이 아직 열려 있거나 페이지가 멈춘 경우
  if (killed && !out) {
    return { error: 'chrome_timeout',
             message: '조회 시간이 초과되었습니다 — 로그인 창이 아직 열려 있지 않은지 확인해 주세요' };
  }
  // 비정상 종료 + 빈 출력 — 잠금 메시지를 못 알아봤을 가능성이 크다
  if (errCode && errCode !== 0 && !out) {
    return { error: 'chrome_failed',
             message: (stderr || '').trim().slice(0, 200) || `Chrome 이 비정상 종료했습니다 (code ${errCode})` };
  }
  if (out.length < 200) {
    return { error: 'chrome_empty', message: '빈 페이지가 반환되었습니다' };
  }
  return { html: out };
}

// 로그인 창을 띄운다. 사용자가 창을 닫는 시점을 알 수 있도록 프로세스를 돌려준다.
function openLogin(chromePath, profile, url) {
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(chromePath, loginArgs(profile, url), {
    detached: false, stdio: 'ignore', windowsHide: false,
  });
  return child;
}

// 렌더된 DOM 을 문자열로 가져온다. 실패해도 진단할 수 있도록 실행 정보
// (exitCode·stderr·args)를 결과에 함께 담아 돌려준다.
function fetchHtml(chromePath, profile, url, opts = {}) {
  const budget  = opts.budgetMs || 20000;
  const timeout = opts.timeoutMs || budget + 20000;
  const args    = fetchArgs(profile, url, budget, opts.extraArgs || []);
  return new Promise((resolve) => {
    fs.mkdirSync(profile, { recursive: true });
    execFile(chromePath, args, {
      timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    }, (err, stdout, stderr) => {
      const exitCode = err ? (typeof err.code !== 'undefined' ? err.code : null) : 0;
      const result = classifyFetch({ errCode: exitCode, killed: !!(err && err.killed), stdout, stderr });
      // 진단 메타 — "command failed / 읽기 실패" 의 실제 원인을 파일로 남길 수 있게 한다
      result.exitCode = exitCode;
      result.stderr   = (stderr || '').trim().slice(0, 4000);
      result.args     = args;
      resolve(result);
    });
  });
}

module.exports = {
  chromeCandidates, findChrome, profileDir,
  loginArgs, fetchArgs, isProfileLocked, classifyFetch,
  openLogin, fetchHtml,
};
