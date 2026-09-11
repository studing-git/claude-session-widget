// 백그라운드 서비스 워커 — 콘텐츠 스크립트가 보낸 사용량을 위젯의
// 로컬 서버로 전달한다. 콘텐츠 스크립트는 https 페이지 안이라 로컬 http 로
// 직접 못 보내지만, 확장의 서비스 워커는 127.0.0.1 로 요청할 수 있다.

const BRIDGE = { port: 47836, token: 'ai-usage-widget-local' };
const base = `http://127.0.0.1:${BRIDGE.port}`;

// 배경 갱신용: 제공자별 사용량 페이지 URL
const USAGE_URLS = {
  claude:  'https://claude.ai/settings/usage',
  gemini:  'https://gemini.google.com/usage',
  // ChatGPT 는 해시 라우트(#settings/Usage). 콘텐츠 스크립트가 설정→사용량을
  // 열도록 유도하므로 배경 갱신에도 포함한다(그래도 실패하면 사용자가 직접 열면 된다).
  chatgpt: 'https://chatgpt.com/#settings/Usage',
};

// 우리가 배경 갱신용으로 연 탭. 보고를 받거나 시간이 지나면 우리가 닫는다.
// (사용자가 직접 연 탭은 여기 없으므로 건드리지 않는다.)
const managedTabs = new Set();

// 탭을 안전하게 닫는다. 이미 닫혀 있으면 chrome.tabs.remove 가 거부(reject)하는데,
// 이걸 처리하지 않으면 "Uncaught (in promise) Error: No tab with id" 가 뜬다.
function closeTab(tabId) {
  if (tabId == null || !managedTabs.has(tabId)) return;
  managedTabs.delete(tabId);
  Promise.resolve(chrome.tabs.remove(tabId)).catch(() => {});   // 이미 닫혔으면 무시
}

// 사용자가 탭을 직접 닫으면 추적 목록에서 뺀다 (나중에 또 닫으려다 오류나지 않도록)
chrome.tabs.onRemoved.addListener((tabId) => { managedTabs.delete(tabId); });

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
  if (!msg || msg.type !== 'usage' || !msg.payload) return;
  forward(msg.payload);
  // 우리가 배경으로 연 탭에서 온 보고라면, 값을 받았으니 바로 닫는다
  // (15초를 기다릴 필요 없이 화면에 잠깐만 떴다 사라진다).
  if (sender && sender.tab) closeTab(sender.tab.id);
});

// 위젯이 켜져 있는지 확인한다. 꺼져 있으면 배경 탭을 열어도 받을 곳이 없다.
async function widgetUp() {
  try { return (await fetch(`${base}/ping`)).ok; } catch (e) { return false; }
}

// 배경 갱신: 사용량 페이지를 배경 탭에서 잠깐 열어 최신값을 받는다.
// 배경 탭이라 포커스를 뺏지 않고, 보고를 받으면(위 리스너에서) 곧바로 닫는다.
async function refreshInBackground(id) {
  const url = USAGE_URLS[id];
  if (!url) return;
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (e) { return; }
  managedTabs.add(tab.id);
  // 보고가 오면 리스너가 닫지만, 안 오는 경우(로그인 안 됨 등)를 위해 안전장치로도 닫는다
  setTimeout(() => closeTab(tab.id), 20000);
}

// 위젯이 켜져 있을 때만 모든 제공자를 배경 갱신한다
async function refreshAll() {
  if (!(await widgetUp())) return;
  for (const id of Object.keys(USAGE_URLS)) refreshInBackground(id);
}

chrome.alarms.create('refresh', { periodInMinutes: 15 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh') refreshAll();
});

// 설치/갱신 직후 한 번 즉시 갱신 (위젯이 켜져 있을 때만 탭을 연다)
chrome.runtime.onInstalled.addListener(() => { refreshAll(); });
