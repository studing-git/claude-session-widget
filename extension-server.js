// 확장 프로그램이 보낸 사용량을 받는 로컬 서버.
// 127.0.0.1 에만 바인딩하고 토큰으로 최소한의 보호를 한다.
// (개인용 위젯 기준. 루프백이라 외부에서 접근할 수 없고, 토큰은 다른
//  로컬 페이지가 실수로 값을 밀어넣는 것을 막는 정도의 역할이다.)

const http = require('http');

const PORT = 47836;
const TOKEN = 'ai-usage-widget-local';

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-widget-token',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  };
}

// 확장이 보낸 payload 를 검증한다. 통과하면 정규화된 객체, 아니면 null.
function validateReport(body, isKnownProvider) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.id !== 'string' || !isKnownProvider(body.id)) return null;
  if (!Array.isArray(body.metrics) || !body.metrics.length) return null;
  const metrics = body.metrics
    .filter(m => m && typeof m === 'object')
    .map(m => ({
      key: String(m.key || ''),
      label: String(m.label || ''),
      pct: Number.isFinite(m.pct) ? m.pct : 0,
      reset: typeof m.reset === 'string' ? m.reset : '',
      detail: typeof m.detail === 'string' ? m.detail : '',
      gauge: m.gauge !== false,
      value: m.value != null ? String(m.value) : undefined,
    }));
  if (!metrics.length) return null;
  return {
    id: body.id,
    plan: typeof body.plan === 'string' ? body.plan : '',
    note: typeof body.note === 'string' ? body.note : '',
    metrics,
    url: typeof body.url === 'string' ? body.url : '',
    at: Date.now(),
  };
}

// 확장이 보낸 쿠키 묶음을 검증한다. 통과하면 정규화된 객체, 아니면 null.
// (값 자체는 검증에서 건드리지 않으며, 로깅하지도 않는다.)
function validateCookies(body, isKnownProvider) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.id !== 'string' || !isKnownProvider(body.id)) return null;
  if (!Array.isArray(body.cookies) || !body.cookies.length) return null;
  const cookies = body.cookies
    .filter(c => c && typeof c === 'object' &&
      typeof c.name === 'string' && typeof c.value === 'string' &&
      typeof c.domain === 'string')
    .map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: typeof c.path === 'string' ? c.path : '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      hostOnly: !!c.hostOnly,
      sameSite: typeof c.sameSite === 'string' ? c.sameSite : undefined,
      expirationDate: Number.isFinite(c.expirationDate) ? c.expirationDate : undefined,
    }));
  if (!cookies.length) return null;
  return { id: body.id, cookies, at: Date.now() };
}

// onReport(report) 는 검증을 통과한 보고를 받는다. isKnownProvider(id) 로 제공자 확인.
// onCookies(payload) 는 확장이 보낸 쿠키 묶음을 받는다(선택).
// start() 는 { server, close() } 를 돌려준다.
function start({ onReport, onCookies, isKnownProvider, port = PORT, token = TOKEN }) {
  // 토큰을 확인하고 JSON 본문을 읽은 뒤, validate 를 통과하면 handle 을 부른다.
  // /report 와 /cookies 가 같은 틀(토큰 게이트·256KB 제한·검증)을 공유한다.
  function acceptJson(req, res, validate, handle) {
    if (req.headers['x-widget-token'] !== token) {
      res.writeHead(401, corsHeaders()); res.end('unauthorized'); return;
    }
    let raw = '';
    let tooBig = false;
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 256 * 1024) { tooBig = true; req.destroy(); }   // 폭주 방지
    });
    req.on('end', () => {
      if (tooBig) return;
      let body;
      try { body = JSON.parse(raw); } catch (e) {
        res.writeHead(400, corsHeaders()); res.end('bad json'); return;
      }
      const out = validate(body, isKnownProvider);
      if (!out) { res.writeHead(422, corsHeaders()); res.end('invalid'); return; }
      try { handle(out); } catch (e) {}
      res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, corsHeaders()));
      res.end(JSON.stringify({ ok: true }));
    });
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); res.end(); return; }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, corsHeaders()));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && req.url === '/report') {
      acceptJson(req, res, validateReport, (report) => { if (onReport) onReport(report); });
      return;
    }

    // 확장이 chrome.cookies 로 읽은 세션 쿠키를 위젯으로 넘긴다 → 위젯이 주입해
    // 브라우저가 꺼져 있어도 단독으로 사용량을 조회할 수 있다.
    if (req.method === 'POST' && req.url === '/cookies') {
      acceptJson(req, res, validateCookies, (payload) => { if (onCookies) onCookies(payload); });
      return;
    }

    res.writeHead(404, corsHeaders()); res.end('not found');
  });

  // 루프백에만 바인딩한다
  server.listen(port, '127.0.0.1');
  server.on('error', (e) => { console.error('[extension-server]', e.message); });
  return { server, close: () => { try { server.close(); } catch (e) {} } };
}

module.exports = { start, validateReport, validateCookies, PORT, TOKEN };
