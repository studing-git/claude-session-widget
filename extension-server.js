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

// onReport(report) 는 검증을 통과한 보고를 받는다. isKnownProvider(id) 로 제공자 확인.
// start() 는 { server, close() } 를 돌려준다.
function start({ onReport, isKnownProvider, port = PORT, token = TOKEN }) {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); res.end(); return; }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, corsHeaders()));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && req.url === '/report') {
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
        const report = validateReport(body, isKnownProvider);
        if (!report) { res.writeHead(422, corsHeaders()); res.end('invalid'); return; }
        try { onReport(report); } catch (e) {}
        res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, corsHeaders()));
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404, corsHeaders()); res.end('not found');
  });

  // 루프백에만 바인딩한다
  server.listen(port, '127.0.0.1');
  server.on('error', (e) => { console.error('[extension-server]', e.message); });
  return { server, close: () => { try { server.close(); } catch (e) {} } };
}

module.exports = { start, validateReport, PORT, TOKEN };
