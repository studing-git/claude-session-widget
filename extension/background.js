// 백그라운드 서비스 워커.
//
// 두 가지를 위젯의 로컬 서버(127.0.0.1:47836)로 전달한다.
//  1) 콘텐츠 스크립트가 사용량 페이지에서 파싱한 값(POST /report) — 그 페이지에
//     사용자가 있을 때의 즉시 갱신.
//  2) 이 프로필의 세션 쿠키(POST /cookies) — 위젯이 자체 세션에 주입해 두면,
//     브라우저를 닫아도 위젯이 그 쿠키로 사용량을 단독 조회할 수 있다.
//
// 확장은 "쿠키 기부자" 역할이라, 예전처럼 배경 탭으로 AI 사이트를 열지 않는다.

const BRIDGE = { port: 47836, token: 'ai-usage-widget-local' };
const base = `http://127.0.0.1:${BRIDGE.port}`;

// 제공자별 쿠키 도메인 (providers/<id>.js 의 cookieDomains 와 동일하게 유지).
// chrome.cookies.getAll({domain}) 는 해당 도메인과 그 하위 도메인 쿠키를 준다.
const COOKIE_DOMAINS = {
  claude:  ['claude.ai', 'anthropic.com'],
  chatgpt: ['chatgpt.com', 'openai.com'],
  gemini:  ['google.com', 'googleusercontent.com'],
};

// 위젯이 켜져 있는지 확인한다. 꺼져 있으면 보낼 곳이 없다.
async function widgetUp() {
  try { return (await fetch(`${base}/ping`)).ok; } catch (e) { return false; }
}

async function post(pathname, payload) {
  try {
    await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-widget-token': BRIDGE.token },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // 위젯이 꺼져 있으면 조용히 무시한다
  }
}

// 콘텐츠 스크립트가 파싱한 사용량 값
function forwardUsage(payload) { return post('/report', payload); }

// 이 프로필에서 제공자 도메인의 쿠키를 모아 위젯으로 넘긴다.
// 로그인돼 있지 않아 쿠키가 없으면 보내지 않는다(빈 값으로 덮어쓰지 않는다).
async function donateCookies(id) {
  const domains = COOKIE_DOMAINS[id];
  if (!domains) return;
  const seen = new Set();
  const cookies = [];
  for (const domain of domains) {
    let list = [];
    try { list = await chrome.cookies.getAll({ domain }); } catch (e) { continue; }
    for (const c of list) {
      const key = `${c.name}|${c.domain}|${c.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cookies.push({
        name: c.name, value: c.value, domain: c.domain, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly, hostOnly: c.hostOnly,
        sameSite: c.sameSite, expirationDate: c.expirationDate,
      });
    }
  }
  if (!cookies.length) return;
  await post('/cookies', { id, cookies });
}

// 위젯이 켜져 있을 때만 3사 쿠키를 기부한다
async function donateAll() {
  if (!(await widgetUp())) return;
  for (const id of Object.keys(COOKIE_DOMAINS)) donateCookies(id);
}

async function onUsage(payload) {
  forwardUsage(payload);
  // 사용량 페이지가 열렸다는 건 이 프로필에 로그인돼 있다는 확증이다.
  // 그 김에 해당 제공자 쿠키도 기부해 위젯이 이후 단독 조회할 수 있게 한다.
  if (await widgetUp()) donateCookies(payload.id);
}

// 응답을 돌려주지 않으므로 리스너에서 Promise 를 반환하지 않는다
// (반환하면 "message port closed" 경고가 뜰 수 있다). fire-and-forget.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'usage' && msg.payload) { onUsage(msg.payload); }
});

// 주기 기부: 위젯이 켜져 있으면 30분마다 최신 쿠키를 넘긴다
chrome.alarms.create('donate', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'donate') donateAll();
});

// 설치/갱신 직후 한 번 기부
chrome.runtime.onInstalled.addListener(() => { donateAll(); });
