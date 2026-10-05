// claude.ai 사용량 파서
//
// 게이지는 [role="meter"] 이고 aria-valuenow 가 "사용된" 비율이다.
// 카드 개수·순서가 바뀌어도 견디도록 라벨 텍스트로 매핑하고, 실패 시에만 인덱스로 폴백한다.

const id      = 'claude';
const name    = 'Claude';
const accent  = '#d97706';
const url     = 'https://claude.ai/settings/usage';
const loginUrl = 'https://claude.ai/login';
// 계정 전환 시 실제 브라우저에서 열 주소 (로그아웃 후 다른 계정으로 로그인)
const switchUrl = 'https://claude.ai/login';

// 이 선택자가 나타날 때까지 기다린 뒤 HTML을 수집한다
// 예전 defaultSession 에서 로그인을 물려받을 때 옮겨올 쿠키 도메인
const cookieDomains = ['claude.ai', 'anthropic.com'];

// 로그인 여부를 가르는 쿠키. 분석·기기 식별 쿠키(_fbp, anthropic-device-id 등)와 구분한다.
const authCookies = ['sessionKey', 'sessionKey.sig', '__Secure-next-auth.session-token'];

const readySelector = '[role="meter"]';

// claude.ai 의 구독 플랜 이름.
//
// 요소 전체가 플랜명인 경우. 본문의 낱말("Pro tip…")을 플랜으로 오인하지 않는다.
const PLAN_EXACT = /^(?:Max\s*\(\s*\d+\s*x\s*\)|Max|Pro|Team|Enterprise|Free)$/i;
// 다른 글자와 한 요소에 섞여 있어도 안전하게 뽑아낼 수 있는 형태.
//  - "Max (5x)" 는 그 자체로 충분히 특징적이라 그냥 뽑아도 된다
//  - 나머지 등급은 바로 뒤에 "플랜/plan" 이 붙을 때만 (낱말 오인 방지)
const PLAN_INSIDE = /Max\s*\(\s*\d+\s*x\s*\)|\b(?:Max|Pro|Team|Enterprise|Free)\b(?=\s*(?:플랜|plan\b))/i;

// 제목 영역을 먼저 보고, 없으면 문서 전체에서 찾는다. 각 범위에서 "요소 전체가
// 플랜명"인 쪽을 먼저 믿고, 그다음 섞여 있는 경우를 본다.
//
// 섞여 있는 경우를 반드시 봐야 한다: 2.5.0 에서 전체 일치만 보도록 바꿨다가
// "Max (5x) 플랜" 처럼 뒤에 글자가 붙은 구조에서 플랜이 통째로 사라졌다.
function findPlan(doc) {
  const scopes = [
    doc.querySelectorAll('div[class*="items-start"][class*="justify-between"] *'),
    doc.querySelectorAll('p, span, div'),
  ];
  for (const els of scopes) {
    for (const el of els) {
      const t = el.textContent.trim();
      if (t.length <= 20 && PLAN_EXACT.test(t)) return t;
    }
    for (const el of els) {
      const t = el.textContent.trim();
      if (t.length >= 60) continue;          // 긴 문단은 보지 않는다
      const m = t.match(PLAN_INSIDE);
      if (m) return m[0].trim();
    }
  }
  return '';
}

function parse(doc) {
  const bars = Array.from(doc.querySelectorAll('[role="meter"]'));

  // 게이지를 감싸는 "카드"를 찾는다: 게이지가 2개 이상 포함되기 직전까지 부모를 거슬러 올라간다
  function getCard(bar) {
    let card = bar.parentElement;
    while (card) {
      const parent = card.parentElement;
      if (!parent || parent.querySelectorAll('[role="meter"]').length > 1) break;
      card = parent;
    }
    return card;
  }

  function getResetText(card) {
    if (!card) return '';
    for (const el of card.querySelectorAll('p, span')) {
      const t = el.textContent.trim();
      if (t && (t.includes('재설정') || t.toLowerCase().includes('reset') || t.includes('아직'))) return t;
    }
    return '';
  }

  const entries = bars.map(bar => {
    const card = getCard(bar);
    // aria-valuenow 가 사라지거나 이름이 바뀌면 예전에는 `|| 0` 때문에 0% 로 둔갑해
    // "사용량 0" 을 정상값처럼 보여줬다. 못 읽으면 null 로 두어 실패가 드러나게 한다.
    const n = Number.parseInt(bar.getAttribute('aria-valuenow'), 10);
    return {
      card,
      text:  card ? card.textContent : '',
      pct:   Number.isFinite(n) ? n : null,
      reset: getResetText(card),
    };
  });

  const byLabel = (...labels) =>
    entries.find(e => labels.some(l => e.text.toLowerCase().includes(l.toLowerCase())));

  const sessionE = byLabel('현재 세션', 'Current session') || entries[0];
  const allE     = byLabel('모든 모델', 'All models')      || entries[1];
  const extraE   = byLabel('사용 크레딧', 'usage credit')  ||
                   (entries.length >= 4 ? entries[entries.length - 1] : null);
  const modelE   = entries.find(e => e !== sessionE && e !== allE && e !== extraE) || null;

  // 모델별 카드의 라벨(예: "Fable")을 카드 안에서 읽어온다
  let modelLabel = '';
  if (modelE && modelE.card) {
    for (const el of modelE.card.querySelectorAll('p, span, div, h1, h2, h3')) {
      const t = el.textContent.trim();
      if (t && t.length < 40 && !t.includes('%') && !t.includes('재설정') &&
          !t.includes('사용됨') && !t.includes('US$') && !t.includes('아직')) { modelLabel = t; break; }
    }
  }

  // 크레딧 잔액 / 사용액
  let extraUsed = '', extraBalance = '';
  for (const el of doc.querySelectorAll('p, span, div')) {
    const t = el.textContent.trim();
    const m = t.match(/US\$[\d.]+\s*사용/);
    if (m && t.length < 60) { extraUsed = m[0]; break; }
  }
  for (const el of doc.querySelectorAll('p, span, div')) {
    const t = el.textContent;
    if (!t.includes('현재 잔액') || t.length > 120) continue;
    let scope = el, hops = 0;
    while (scope && hops < 4) {
      const amounts = scope.textContent.match(/US\$[\d.]+(?:\s*사용)?/g) || [];
      const bal = amounts.find(a => !a.includes('사용'));
      if (bal) { extraBalance = bal; break; }
      scope = scope.parentElement; hops++;
    }
    break;
  }

  // 플랜: 제목 영역에 들어가는 구독 이름.
  const plan = findPlan(doc);

  // 통합 패널은 metrics 의 앞 2개를 요약으로 쓴다.
  // 값을 못 읽은(pct === null) 게이지는 넣지 않는다 — 넣으면 0% 로 보여 오해를 준다.
  const metrics = [];
  const add = (e, m) => { if (e && e.pct !== null) metrics.push(Object.assign(m, { pct: e.pct, reset: e.reset })); };
  add(sessionE, { key: 'session',      label: '세션' });
  add(allE,     { key: 'weekly_all',   label: '주간' });
  add(modelE,   { key: 'weekly_model', label: modelLabel || '모델' });
  add(extraE,   { key: 'extra',        label: '크레딧',
                  detail: extraBalance ? `잔액 ${extraBalance}` : extraUsed });

  // meterCount = 화면에서 찾은 게이지 수, readCount = 그중 값까지 읽어낸 수.
  // 게이지는 있는데 하나도 못 읽었다면 로그아웃이 아니라 페이지 구조가 바뀐 것이다.
  return { plan, metrics, meterCount: bars.length,
           readCount: entries.filter(e => e.pct !== null).length };
}

const _api = { id, name, accent, url, loginUrl, switchUrl, cookieDomains, authCookies, readySelector, parse };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
// 확장 프로그램의 콘텐츠 스크립트에서도 같은 파서를 쓴다
if (typeof globalThis !== 'undefined') (globalThis.AIUsageProviders = globalThis.AIUsageProviders || {})[id] = _api;
