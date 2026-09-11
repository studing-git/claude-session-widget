// gemini.google.com 사용량 파서
//
// 셋 중 훅이 가장 안정적이다: data-test-id="gxu-currently" / "gxu-weekly".
// 주간 항목에는 막대가 없고 "3% 사용됨" 텍스트만 있다.

const id       = 'gemini';
const name     = 'Gemini';
const accent   = '#4285f4';
const url      = 'https://gemini.google.com/usage';
const loginUrl = 'https://gemini.google.com/';

// 예전 defaultSession 에서 로그인을 물려받을 때 옮겨올 쿠키 도메인
const cookieDomains = ['google.com', 'googleusercontent.com'];

// Google 계정 인증 쿠키.
const authCookies = ['__Secure-1PSID', '__Secure-3PSID', 'SID', 'SSID', 'SAPISID'];

const readySelector = '[data-test-id="gxu-currently"], usage-metrics-window';

function pctOf(el) {
  const m = el && el.textContent.match(/(\d+)\s*%\s*(?:사용됨|used)/i);
  return m ? parseInt(m[1], 10) : null;
}

function resetOf(el) {
  if (!el) return '';
  for (const p of el.querySelectorAll('p, span, div')) {
    if (p.children.length) continue;
    const t = p.textContent.trim();
    if (t && (t.includes('초기화') || t.includes('재설정') || /reset/i.test(t))) return t;
  }
  return '';
}

function parse(doc) {
  const root = doc.querySelector('usage-metrics-window') || doc.body;
  const metrics = [];

  const cur = root.querySelector('[data-test-id="gxu-currently"]');
  const wk  = root.querySelector('[data-test-id="gxu-weekly"]');

  const curPct = pctOf(cur);
  if (curPct !== null) metrics.push({ key: 'current', label: '현재', pct: curPct, reset: resetOf(cur) });

  const wkPct = pctOf(wk);
  if (wkPct !== null) metrics.push({ key: 'weekly', label: '주간', pct: wkPct, reset: resetOf(wk) });

  // 플랜: 헤더의 tier-pill (예: "PRO")
  let plan = '';
  const pill = root.querySelector('.tier-pill');
  if (pill) {
    const t = pill.textContent.trim();
    // "PRO" → "Pro" 로 다듬어 다른 제공자 표기와 맞춘다
    plan = /^[A-Z\s]+$/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
  }

  return { plan, metrics };
}

const _api = { id, name, accent, url, loginUrl, cookieDomains, authCookies, readySelector, parse };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
// 확장 프로그램의 콘텐츠 스크립트에서도 같은 파서를 쓴다
if (typeof globalThis !== 'undefined') (globalThis.AIUsageProviders = globalThis.AIUsageProviders || {})[id] = _api;
