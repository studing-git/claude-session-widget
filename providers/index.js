// 제공자 레지스트리
//
// 각 제공자는 다음을 내보낸다:
//   id, name, accent, url, loginUrl, readySelector, parse(doc) -> { plan, metrics, note? }
//
// parse 가 돌려주는 metrics 는 우선순위 순서다. 통합 패널은 앞의 두 개를 요약으로 쓰고,
// 상세 화면은 전부 보여준다. 각 항목의 pct 는 언제나 "사용된 비율"이다
// (ChatGPT 처럼 잔여율을 표시하는 곳은 파서가 변환한다).

const claude  = require('./claude');
const chatgpt = require('./chatgpt');
const gemini  = require('./gemini');

const PROVIDERS = [claude, chatgpt, gemini];

function get(id) {
  return PROVIDERS.find(p => p.id === id) || null;
}

// HTML 문자열 → 정규화된 결과. DOMParser 가 있는 렌더러에서 호출한다.
function parseHtml(id, html, DOMParserImpl) {
  const provider = get(id);
  if (!provider) return { id, state: 'error', message: '알 수 없는 제공자' };

  const base = {
    id: provider.id, name: provider.name, accent: provider.accent,
    plan: '', note: '', metrics: [], state: 'ok', message: '',
  };

  try {
    const doc = new DOMParserImpl().parseFromString(html, 'text/html');
    const out = provider.parse(doc) || {};
    const metrics = Array.isArray(out.metrics) ? out.metrics : [];

    if (!metrics.length) {
      // 지표가 하나도 없는 원인은 두 가지다: 로그아웃이거나, 페이지 구조가 바뀌어
      // 파서가 못 읽거나. 여기서는 구분할 수 없으므로 'parse' 로 돌려보내고,
      // 인증 쿠키가 없다는 걸 아는 호출자(렌더러)가 'auth' 로 올린다.
      // 예전처럼 무조건 "로그인을 확인해 주세요" 라고 하면, 멀쩡히 로그인된
      // 사용자가 파서가 깨진 줄 모르고 재로그인만 반복하게 된다.
      const sawGauges = out.meterCount > 0;
      return Object.assign(base, {
        state: 'parse',
        message: sawGauges
          ? '사용량을 읽지 못했습니다 — 페이지 구조가 바뀐 것 같습니다'
          : '사용량을 찾지 못했습니다 — 로그인 또는 페이지 구조를 확인해 주세요',
        plan: out.plan || '',
      });
    }
    // 일부만 읽힌 경우에도 알려 준다 (예: 게이지 4개 중 1개만 해석됨)
    const partial = Number.isFinite(out.meterCount) && Number.isFinite(out.readCount) &&
                    out.readCount > 0 && out.readCount < out.meterCount;
    return Object.assign(base, {
      plan: out.plan || '', note: out.note || '',
      partial,
      message: partial ? `일부 항목을 읽지 못했습니다 (${out.readCount}/${out.meterCount})` : '',
      metrics: metrics.map(m => Object.assign({ gauge: true, reset: '', detail: '' }, m)),
    });
  } catch (e) {
    // 파서가 예외를 던진 것도 파싱 실패다 — 네트워크 오류와 구분해서 보여 준다
    return Object.assign(base, { state: 'parse', message: `파싱 오류: ${e.message}` });
  }
}

module.exports = { PROVIDERS, get, parseHtml, ids: PROVIDERS.map(p => p.id) };
