// 콘텐츠 스크립트 — 사용자의 로그인된 Chrome 안에서, 실제로 렌더된
// 사용량 페이지 DOM 을 읽어 파싱한 뒤 백그라운드로 보낸다.
//
// 이 파일 앞에 해당 제공자의 파서(providers/<id>.js)가 함께 주입된다.
// 파서는 globalThis.AIUsageProviders 에 자신을 등록해 둔다.
(function () {
  'use strict';

  const registry = globalThis.AIUsageProviders || {};
  // 이 페이지에는 한 제공자의 파서만 주입된다
  const provider = Object.values(registry)[0];
  if (!provider) return;

  const BRIDGE = { port: 47836, token: 'ai-usage-widget-local' };

  function report() {
    let out;
    try {
      out = provider.parse(document) || {};
    } catch (e) {
      return false;
    }
    const metrics = Array.isArray(out.metrics) ? out.metrics : [];
    if (!metrics.length) return false;

    // 콘텐츠 스크립트는 https 페이지 안이라 http://127.0.0.1 로 직접 못 보낸다
    // (혼합 콘텐츠 차단). 백그라운드 서비스 워커를 거쳐 위젯으로 전달한다.
    chrome.runtime.sendMessage({
      type: 'usage',
      payload: {
        id: provider.id,
        plan: out.plan || '',
        note: out.note || '',
        metrics,
        url: location.href,
        at: Date.now(),
      },
    });
    return true;
  }

  // SPA 라 값이 늦게 채워진다. 나타날 때까지 폴링하다가, 한 번 성공하면
  // 이후에도 주기적으로 갱신해 최신 값을 유지한다.
  let settled = false;
  let tries = 0;
  const poll = setInterval(() => {
    tries++;
    const sel = provider.readySelector;
    if (document.querySelector(sel) && report()) {
      settled = true;
      clearInterval(poll);
      // 페이지가 열려 있는 동안 2분마다 갱신
      setInterval(report, 120000);
    } else if (tries > 40) {          // 약 20초 뒤 포기
      clearInterval(poll);
    }
  }, 500);

  // 백그라운드가 즉시 갱신을 요청할 수 있다
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'refresh') { sendResponse({ ok: report() }); }
    return true;
  });

  void BRIDGE; void settled;
})();
