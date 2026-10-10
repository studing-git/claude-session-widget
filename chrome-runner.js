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
const fs     = require('fs');
const path   = require('path');
const net    = require('net');
const http   = require('http');
const crypto = require('crypto');

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
  // 임의 디버깅 포트(0)를 연다. 전용(비기본) 프로필이라 크롬 136+ 의 "기본 프로필
  // 디버깅 차단"에 걸리지 않고, 127.0.0.1 에만 바인딩된다. 위젯이 이 포트로 로그인
  // 창의 탭 URL 을 들여다봐(헤드리스 조회를 반복 띄우지 않는다) 로그인 완료를 감지하고,
  // 끝나면 Browser.close 로 창을 자동으로 닫는다(프로필 잠금 해제).
  return [...COMMON_ARGS, `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--new-window', url];
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
  // 로그인 창이 같은 프로필을 점유 중 — 오류가 아니라 "창을 닫으면 됩니다" 안내 대상
  if (isProfileLocked(stderr)) {
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

// ── 로그인 창 감시용 DevTools 헬퍼 ──
// 로그인 창을 직접 들여다보기 위한 최소한의 DevTools 접근. 조회(fetchHtml)와 달리
// 여기서는 헤드리스를 띄우지 않고, 이미 떠 있는 로그인 창의 상태만 읽는다.

// Chrome 은 디버깅 포트가 열리면 프로필에 DevToolsActivePort 파일을 쓴다.
//   1행 = 포트 번호, 2행 = 브라우저 WebSocket 경로(/devtools/browser/<id>)
function readDevToolsPort(profile) {
  try {
    const lines = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
    const port = parseInt(lines[0], 10);
    const wsPath = (lines[1] || '').trim();
    if (!port || !wsPath) return null;
    return { port, wsPath };
  } catch (e) { return null; }
}

// DevToolsActivePort 파일이 나타날 때까지 기다린다. 못 얻으면 null(구형 Chrome 등).
function waitDevToolsPort(profile, timeoutMs = 15000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const dt = readDevToolsPort(profile);
      if (dt) return resolve(dt);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function httpGetJson(port, reqPath, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: reqPath, timeout: timeoutMs }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// 열린 page 탭들의 URL. 포트가 죽었으면(창이 닫혔으면) null 을 돌려준다.
async function listPageUrls(port) {
  const list = await httpGetJson(port, '/json/list');
  if (!Array.isArray(list)) return null;
  return list.filter(t => t.type === 'page').map(t => t.url || '');
}

// 길이 125 이하의 짧은 텍스트 메시지 하나를 마스킹한 WebSocket 프레임으로 만든다.
function wsTextFrame(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
}

// Browser.close 를 최소 WebSocket 으로 보내 브라우저를 깨끗이 종료한다.
// (탭을 닫는 것만으로는 헤드풀/Mac 에서 프로세스가 남아 프로필이 계속 잠길 수 있다.)
// 의존성 없이 raw 소켓으로 핸드셰이크 + 프레임 하나만 보낸다. Origin 헤더를 보내지
// 않으므로 브라우저 엔드포인트의 origin 검사에 걸리지 않는다.
function closeBrowser(port, wsPath, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false, handshook = false;
    const sock = net.connect(port, '127.0.0.1', () => {
      const key = crypto.randomBytes(16).toString('base64');
      sock.write(
        `GET ${wsPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    const finish = (ok) => { if (!done) { done = true; try { sock.end(); } catch (e) {} resolve(ok); } };
    sock.on('data', (buf) => {
      if (handshook) return;
      const first = buf.toString('latin1').split('\r\n')[0];
      if (/ 101 /.test(first)) {
        handshook = true;
        sock.write(wsTextFrame(JSON.stringify({ id: 1, method: 'Browser.close' })));
        setTimeout(() => finish(true), 300);
      } else { finish(false); }
    });
    sock.on('error', () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}

module.exports = {
  chromeCandidates, findChrome, profileDir,
  loginArgs, fetchArgs, isProfileLocked, classifyFetch,
  openLogin, fetchHtml,
  readDevToolsPort, waitDevToolsPort, listPageUrls, wsTextFrame, closeBrowser,
};
