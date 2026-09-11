// claude.ai 사용량 파서
//
// 게이지는 [role="meter"] 이고 aria-valuenow 가 "사용된" 비율이다.
// 카드 개수·순서가 바뀌어도 견디도록 라벨 텍스트로 매핑하고, 실패 시에만 인덱스로 폴백한다.

const id      = 'claude';
const name    = 'Claude';
const accent  = '#d97706';
const url     = 'https://claude.ai/settings/usage';
// 제공자마다 쿠키를 분리한다. 서비스별로 다른 계정을 쓸 수 있고,
// 계정 전환 시 이 파티션만 비우면 다른 서비스 로그인은 그대로 남는다.
const partition = 'persist:claude';
const loginUrl = 'https://claude.ai/login';

// 이 선택자가 나타날 때까지 기다린 뒤 HTML을 수집한다
// 예전 defaultSession 에서 로그인을 물려받을 때 옮겨올 쿠키 도메인
const cookieDomains = ['claude.ai', 'anthropic.com'];

const readySelector = '[role="meter"]';

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
    return {
      card,
      text:  card ? card.textContent : '',
      pct:   parseInt(bar.getAttribute('aria-valuenow')) || 0,
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

  // 플랜: 제목 영역의 "Max (5x)" 패턴
  let plan = '';
  for (const el of doc.querySelectorAll('div[class*="items-start"][class*="justify-between"] *')) {
    const t = el.textContent.trim();
    if (/^Max \(\d+x\)$/.test(t)) { plan = t; break; }
  }
  if (!plan) {
    for (const el of doc.querySelectorAll('p, span, div')) {
      const t = el.textContent.trim();
      const m = t.length < 60 && t.match(/Max \(\d+x\)/);
      if (m) { plan = m[0]; break; }
    }
  }

  // 통합 패널은 metrics 의 앞 2개를 요약으로 쓴다
  const metrics = [];
  if (sessionE) metrics.push({ key: 'session',    label: '세션', pct: sessionE.pct, reset: sessionE.reset });
  if (allE)     metrics.push({ key: 'weekly_all', label: '주간', pct: allE.pct,     reset: allE.reset });
  if (modelE)   metrics.push({ key: 'weekly_model', label: modelLabel || '모델', pct: modelE.pct, reset: modelE.reset });
  if (extraE)   metrics.push({
    key: 'extra', label: '크레딧', pct: extraE.pct, reset: extraE.reset,
    detail: extraBalance ? `잔액 ${extraBalance}` : extraUsed,
  });

  return { plan, metrics, meterCount: bars.length };
}

module.exports = { id, name, accent, url, loginUrl, partition, cookieDomains, readySelector, parse };
