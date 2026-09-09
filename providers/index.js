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
      return Object.assign(base, {
        state: 'error',
        message: '사용량을 찾지 못했습니다 (페이지 구조 변경 가능성)',
        plan: out.plan || '',
      });
    }
    return Object.assign(base, {
      plan: out.plan || '', note: out.note || '',
      metrics: metrics.map(m => Object.assign({ gauge: true, reset: '', detail: '' }, m)),
    });
  } catch (e) {
    return Object.assign(base, { state: 'error', message: e.message });
  }
}

module.exports = { PROVIDERS, get, parseHtml, ids: PROVIDERS.map(p => p.id) };
