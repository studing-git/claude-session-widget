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

// 사용량 탭 패널이 그려질 때까지 기다린다
// 예전 defaultSession 에서 로그인을 물려받을 때 옮겨올 쿠키 도메인
const cookieDomains = ['chatgpt.com', 'openai.com'];

// oai-did 같은 기기 쿠키는 로그인과 무관하므로 세션 토큰만 본다.
const authCookies = ['__Secure-next-auth.session-token', '__Secure-next-auth.session-token.0', '_account'];

const readySelector = '[id$="-content-Usage"]';

const SCOPE_NOTE = 'Codex · Work';

// "100% 남음" / "12% 사용됨" 을 사용된 비율로 변환
function toUsedPct(text) {
  const remain = text.match(/(\d+)\s*%\s*남음/);
  if (remain) return 100 - parseInt(remain[1], 10);
  const used = text.match(/(\d+)\s*%\s*(?:사용됨|used)/i);
  if (used) return parseInt(used[1], 10);
  return null;
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

    // 재설정: 버튼의 aria-label 이 "7일 0시간 후 초기화" 처럼 완성된 문장이다
    let reset = '';
    const resetBtn = card.querySelector('button[aria-label*="초기화"], button[aria-label*="reset" i]');
    if (resetBtn) reset = resetBtn.getAttribute('aria-label').trim();
    if (!reset) {
      const m = card.textContent.match(/[^\s][^\n]{0,20}후\s*초기화/);
      if (m) reset = m[0].trim();
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
  return { plan: SCOPE_NOTE, metrics, note: 'Chat 대화 미포함' };
}

const _api = { id, name, accent, url, loginUrl, cookieDomains, authCookies, readySelector, parse, toUsedPct };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
// 확장 프로그램의 콘텐츠 스크립트에서도 같은 파서를 쓴다
if (typeof globalThis !== 'undefined') (globalThis.AIUsageProviders = globalThis.AIUsageProviders || {})[id] = _api;
