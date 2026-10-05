// chatgpt.com 사용량 파서
//
// 주의 1: 게이지에 role 속성이 없다. 퍼센트는 텍스트("100% 남음")와
//         막대의 inline width 로만 알 수 있다.
// 주의 2: 이 페이지는 "남은 비율"을 표시한다. Claude/Gemini 는 "사용된 비율"이므로
//         used = 100 - remaining 으로 변환해야 한다. 변환을 빠뜨리면 한 번도 쓰지 않은
//         계정(100% 남음)이 100% 사용으로 보여 빨간 경고가 뜬다.
// 주의 3: 이 패널은 Codex/Work 등의 플랜 한도이며 일반 Chat 대화는 포함하지 않는다.

const id       = 'chatgpt';
const name     = 'ChatGPT';
const accent   = '#10a37f';
const url      = 'https://chatgpt.com/#settings/Usage';
const loginUrl = 'https://chatgpt.com/auth/login';
// 계정 전환 시 실제 브라우저에서 열 주소 (로그아웃 후 다른 계정으로 로그인)
const switchUrl = 'https://chatgpt.com/auth/login';

// 예전 defaultSession 에서 로그인을 물려받을 때 옮겨올 쿠키 도메인
const cookieDomains = ['chatgpt.com', 'openai.com'];

// oai-did 같은 기기 쿠키는 로그인과 무관하므로 세션 토큰만 본다.
const authCookies = ['__Secure-next-auth.session-token', '__Secure-next-auth.session-token.0', '_account'];

// 사용량 탭 패널이 그려질 때까지 기다린다.
// 예전에는 Radix 가 만든 '[id$="-content-Usage"]' 를 봤는데, ChatGPT 가 설정
// 패널 구조를 바꾸면서 그 id 가 사라졌다(지금은 React 식 '_r_1na_-available').
// 그래서 역할 기반 선택자를 함께 본다 — 옛 구조도 계속 지원한다.
const readySelector = '[id$="-content-Usage"], [role="tabpanel"]';

// 사용량이 해시 라우트(#settings/Usage)라, 위젯 오프스크린 조회 시 라우트를
// 한 번 흔들어 설정→사용량 화면을 열어야 readySelector 가 나타난다.
const hashNudge = true;

const SCOPE_NOTE = 'Codex · Work';

// "100% 남음" / "12% 사용됨" 을 사용된 비율로 변환
function toUsedPct(text) {
  const remain = text.match(/(\d+)\s*%\s*남음/);
  if (remain) return 100 - parseInt(remain[1], 10);
  const used = text.match(/(\d+)\s*%\s*(?:사용됨|used)/i);
  if (used) return parseInt(used[1], 10);
  return null;
}

// ── 구독 플랜 ──
// 사용량 페이지에는 플랜 이름이 없다(거기 보이는 Plus/Pro 문자열은 화면 텍스트가
// 아니라 스크립트 안 실험 플래그 이름이다). 플랜은 설정의 "결제" 탭에만 있으므로
// 그 화면을 따로 한 번 읽는다. 자주 바뀌지 않으니 호출자가 캐시한다.
const planUrl = 'https://chatgpt.com/#settings/Billing';
const planReadySelector = '[role="tabpanel"], [id$="-content-Billing"]';
const planHash = 'settings/Billing';

// 결제 화면에서 "현재" 플랜을 읽는다.
// 주의: 같은 화면에 결제 이력 표가 있고 거기엔 예전 플랜(Plus 등)이 줄줄이 들어
// 있다. 단순히 첫 번째 ChatGPT ○○ 를 집으면 과거 플랜을 가져오므로, 갱신 문구가
// 있는 행만 보고 표(<td>) 안은 건너뛴다.
//
// 이 함수는 본체가 toString() 으로 직렬화해 조회 중인 페이지 안에서 실행한다
// (main 프로세스엔 DOM 이 없다). 그러니 바깥 변수를 참조하면 안 된다 — 필요한
// 정규식은 전부 안에서 선언한다.
function parsePlan(doc) {
  const RENEW = /플랜\s*자동\s*갱신|자동\s*갱신|renews?\s+on|auto-?renew/i;
  const PLAN  = /^ChatGPT\s+(?:Free|Go|Plus|Pro|Business|Team|Enterprise)\b/i;
  for (const el of doc.querySelectorAll('p, span, div')) {
    if (el.children.length) continue;
    if (!RENEW.test(el.textContent)) continue;
    if (el.closest('td, th, table')) continue;
    let row = el.parentElement, hops = 0;
    while (row && hops < 5) {
      const hit = Array.from(row.querySelectorAll('div, span, h1, h2, h3'))
        .map(e => e.textContent.trim())
        .find(t => PLAN.test(t) && t.length < 60);
      // 좁은 칸에 들어가도록 "ChatGPT " 접두사는 뗀다 → "Pro 100"
      if (hit) return hit.replace(/^ChatGPT\s+/i, '').trim();
      row = row.parentElement; hops++;
    }
  }
  return '';
}

function parse(doc) {
  const panel = doc.querySelector('[id$="-content-Usage"]') || doc.body;
  const metrics = [];

  // 한도 카드: "주간 한도" 같은 제목 + 퍼센트 텍스트 + 막대를 한 덩어리에서 찾는다.
  // 퍼센트 텍스트를 기준으로 삼고 카드까지 거슬러 올라가는 편이 클래스 이름보다 안정적이다.
  const pctEls = Array.from(panel.querySelectorAll('span, div'))
    .filter(el => el.children.length === 0 && /^\s*\d+\s*%\s*(남음|사용됨)\s*$/.test(el.textContent));

  for (const pctEl of pctEls) {
    const pct = toUsedPct(pctEl.textContent);
    if (pct === null) continue;

    // 퍼센트를 포함하는 카드(제목과 재설정 문구가 같이 있는 조상)를 찾는다
    let card = pctEl.parentElement, hops = 0;
    while (card && hops < 5 && !/한도|limit/i.test(card.textContent)) { card = card.parentElement; hops++; }
    if (!card) card = pctEl.parentElement;

    // 제목: "주간 한도", "5시간 한도" 등
    let label = '주간';
    for (const el of card.querySelectorAll('div, span, h3, h4')) {
      const t = el.textContent.trim();
      if (el.children.length === 0 && /^[^\n]{2,20}한도$/.test(t)) {
        label = t.replace(/\s*한도$/, '');
        break;
      }
    }

    // 재설정 문구. 예전에는 버튼의 aria-label("7일 0시간 후 초기화")이었는데
    // 지금은 평범한 텍스트("초기화까지 4일 14시간 남았습니다")로 바뀌었다.
    // card.textContent 로 찾으면 옆 텍스트까지 붙어 오므로("…남았습니다69%")
    // 자식이 없는 말단 요소만 본다. "사용 한도 초기화"(버튼 이름) 같은 조작용
    // 문구는 시간 표현을 요구해 걸러낸다.
    let reset = '';
    const resetBtn = card.querySelector('button[aria-label*="초기화"], button[aria-label*="reset" i]');
    if (resetBtn) reset = (resetBtn.getAttribute('aria-label') || '').trim();
    if (!reset) {
      for (const e of card.querySelectorAll('span, p, div')) {
        if (e.children.length) continue;
        const t = e.textContent.trim();
        if (t.length < 40 && /(초기화까지[^]*남았|후\s*초기화|resets?\s+in)/.test(t)) { reset = t; break; }
      }
    }

    metrics.push({ key: 'limit-' + metrics.length, label, pct, reset });
  }

  // 크레딧: "0 크레딧 남음"
  let credits = null;
  for (const el of panel.querySelectorAll('div, span')) {
    if (el.children.length) continue;
    const m = el.textContent.trim().match(/^([\d,]+)\s*크레딧\s*남음$/);
    if (m) { credits = m[1]; break; }
  }
  if (credits !== null) {
    // 크레딧은 한도가 아니라 잔량이므로 게이지를 채우지 않는다
    const auto = panel.querySelector('button[role="switch"][aria-label*="자동 충전"]');
    const autoOn = auto && auto.getAttribute('aria-checked') === 'true';
    metrics.push({
      key: 'credits', label: '크레딧', pct: 0, gauge: false,
      value: credits, reset: '', detail: auto ? (autoOn ? '자동 충전 켜짐' : '자동 충전 꺼짐') : '',
    });
  }

  // 이 패널에는 플랜 이름이 없다. 무엇을 집계하는지 알려주는 편이 오해를 막는다.
  // plan 은 결제 화면에서 따로 읽어 호출자가 덮어쓴다. 그걸 못 구했을 때를 대비해
  // 기존처럼 집계 범위를 넣어 두면, 최악이어도 지금과 같은 화면이 된다.
  return { plan: SCOPE_NOTE, metrics, note: SCOPE_NOTE + ' · Chat 대화 미포함' };
}

const _api = { id, name, accent, url, loginUrl, switchUrl, cookieDomains, authCookies,
               readySelector, hashNudge, parse, toUsedPct,
               planUrl, planReadySelector, planHash, parsePlan };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
// 확장 프로그램의 콘텐츠 스크립트에서도 같은 파서를 쓴다
if (typeof globalThis !== 'undefined') (globalThis.AIUsageProviders = globalThis.AIUsageProviders || {})[id] = _api;
