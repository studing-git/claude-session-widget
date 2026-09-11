// 임베디드 브라우저로 판별되지 않도록 세션의 브라우저 신원을 Chrome 으로 맞춘다.
//
// UA 문자열만 고치면 부족하다. Chromium 은 클라이언트 힌트(Sec-CH-UA) 헤더로
// 브랜드 목록을 따로 보내는데 거기에 "Electron" 이 남아 있어, Google 로그인이
// "브라우저 또는 앱이 안전하지 않을 수 있습니다" 로 차단된다.

// Electron 이 함께 빌드한 Chromium 버전을 그대로 쓴다.
// 실제 엔진과 다른 버전을 광고하면 오히려 불일치로 걸릴 수 있다.
function chromeMajor(versions = process.versions) {
  return String(versions.chrome || '120').split('.')[0];
}

function chromeUserAgent(platform = process.platform, versions = process.versions) {
  const os = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
           : platform === 'win32'  ? 'Windows NT 10.0; Win64; x64'
           :                         'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
         `Chrome/${chromeMajor(versions)}.0.0.0 Safari/537.36`;
}

// Chrome 이 보내는 것과 같은 모양의 브랜드 목록
function chromeBrands(versions = process.versions) {
  const v = chromeMajor(versions);
  return `"Not_A Brand";v="8", "Chromium";v="${v}", "Google Chrome";v="${v}"`;
}

function platformHint(platform = process.platform) {
  return platform === 'darwin' ? '"macOS"' : platform === 'win32' ? '"Windows"' : '"Linux"';
}

// 헤더 이름은 대소문자가 제각각이라 같은 이름의 다른 표기를 모두 지우고 하나만 남긴다
function setHeader(headers, name, value) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
  headers[name] = value;
}

// 요청 헤더에서 Electron 흔적을 지운다. 순수 함수라 단독으로 검증할 수 있다.
function sanitizeHeaders(headers, opts = {}) {
  const ua       = opts.userAgent || chromeUserAgent(opts.platform, opts.versions);
  const brands   = opts.brands    || chromeBrands(opts.versions);
  const platHint = opts.platformHint || platformHint(opts.platform);

  const out = Object.assign({}, headers);
  setHeader(out, 'User-Agent', ua);
  setHeader(out, 'sec-ch-ua', brands);
  setHeader(out, 'sec-ch-ua-platform', platHint);
  // 전체 버전 목록에도 Electron 이 들어간다. 위장한 값과 어긋나느니 아예 보내지 않는다.
  for (const key of Object.keys(out)) {
    if (key.toLowerCase() === 'sec-ch-ua-full-version-list' ||
        key.toLowerCase() === 'sec-ch-ua-full-version') delete out[key];
  }
  return out;
}

// 세션 하나에 적용한다
function applyTo(ses, opts = {}) {
  const ua = opts.userAgent || chromeUserAgent();
  ses.setUserAgent(ua);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: sanitizeHeaders(details.requestHeaders, opts) });
  });
  return ua;
}

module.exports = {
  chromeUserAgent, chromeBrands, chromeMajor, platformHint,
  sanitizeHeaders, applyTo,
};
