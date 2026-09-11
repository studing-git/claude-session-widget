// 백그라운드 서비스 워커 — 콘텐츠 스크립트가 보낸 사용량을 위젯의
// 로컬 서버로 전달한다. 콘텐츠 스크립트는 https 페이지 안이라 로컬 http 로
// 직접 못 보내지만, 확장의 서비스 워커는 127.0.0.1 로 요청할 수 있다.

const BRIDGE = { port: 47836, token: 'ai-usage-widget-local' };
const base = `http://127.0.0.1:${BRIDGE.port}`;

// 배경 갱신용: 제공자별 사용량 페이지 URL
const USAGE_URLS = {
  claude:  'https://claude.ai/settings/usage',
  gemini:  'https://gemini.google.com/usage',
  // ChatGPT 는 해시 라우트(#settings/Usage)라 배경 탭으로 자동 진입이 불확실하다.
  // 사용자가 사용량 화면을 열어두면 콘텐츠 스크립트가 알아서 보고한다.
};

async function forward(payload) {
  try {
    await fetch(`${base}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-widget-token': BRIDGE.token },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // 위젯이 꺼져 있으면 조용히 무시한다
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'usage' && msg.payload) forward(msg.payload);
});

// 배경 갱신: 일정 주기로 사용량 페이지를 배경 탭에서 잠깐 열어 최신값을 받는다.
// 배경 탭이라 포커스를 뺏지 않고, 보고를 받으면 곧바로 닫는다.
async function refreshInBackground(id) {
  const url = USAGE_URLS[id];
  if (!url) return;
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (e) { return; }
  // 콘텐츠 스크립트가 파싱해 보고할 시간을 준 뒤 닫는다
  setTimeout(() => { try { chrome.tabs.remove(tab.id); } catch (e) {} }, 15000);
}

chrome.alarms.create('refresh', { periodInMinutes: 15 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'refresh') return;
  // 위젯이 켜져 있을 때만 배경 탭을 연다 (꺼져 있으면 굳이 열지 않는다)
  let up = false;
  try { up = (await fetch(`${base}/ping`)).ok; } catch (e) {}
  if (!up) return;
  for (const id of Object.keys(USAGE_URLS)) refreshInBackground(id);
});

// 설치 직후 한 번 즉시 갱신
chrome.runtime.onInstalled.addListener(() => {
  for (const id of Object.keys(USAGE_URLS)) refreshInBackground(id);
});
