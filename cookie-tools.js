// 제공자 도메인 단위로 쿠키를 다루는 도구.
//
// 세 제공자는 session.defaultSession 을 공유한다. 도메인이 서로 다르므로
// 서비스마다 다른 계정을 써도 충돌하지 않는다. 계정을 바꿀 때만
// 해당 제공자의 도메인 쿠키를 지우면 된다.

function baseDomain(domain) {
  return String(domain || '').replace(/^\./, '').toLowerCase();
}

function matchesDomains(cookieDomain, domains) {
  const d = baseDomain(cookieDomain);
  if (!d) return false;
  return domains.some(x => {
    const t = x.toLowerCase();
    return d === t || d.endsWith('.' + t);
  });
}

// 쿠키를 다시 심으려면 URL 이 필요하다. 도메인·경로·secure 로 되살린다.
function cookieUrl(c) {
  return `${c.secure ? 'https' : 'http'}://${baseDomain(c.domain)}${c.path || '/'}`;
}

function toSetDetails(c) {
  const details = {
    url: cookieUrl(c),
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
  };
  // hostOnly 쿠키에 domain 을 주면 하위 도메인까지 퍼지는 쿠키가 되어 버린다
  if (!c.hostOnly) details.domain = c.domain;
  // 세션 쿠키는 만료가 없다
  if (c.expirationDate) details.expirationDate = c.expirationDate;
  return details;
}

// fromSes 의 domains 에 해당하는 쿠키를 toSes 로 복사한다.
// 개별 쿠키 실패는 무시하고 최대한 옮긴다.
async function migrateCookies(fromSes, toSes, domains) {
  let all = [];
  try {
    all = await fromSes.cookies.get({});
  } catch (e) {
    return { found: 0, copied: 0, error: e.message };
  }
  const mine = all.filter(c => matchesDomains(c.domain, domains));
  let copied = 0;
  for (const c of mine) {
    try {
      await toSes.cookies.set(toSetDetails(c));
      copied++;
    } catch (e) { /* 하나 실패해도 나머지는 계속 옮긴다 */ }
  }
  return { found: mine.length, copied };
}

// 확장 프로그램이 chrome.cookies 로 읽어 보낸 원본 쿠키를 세션에 주입한다.
// 크롬 쿠키 객체 모양(name/value/domain/path/secure/httpOnly/sameSite/
//  expirationDate/hostOnly)은 toSetDetails 가 그대로 다룰 수 있다.
// 한 번 주입하면 defaultSession 이 디스크에 보관하므로, 브라우저를 닫아도
// 위젯이 그 쿠키로 사용량 페이지를 단독 조회할 수 있다.
async function setCookies(ses, rawCookies) {
  const list = Array.isArray(rawCookies) ? rawCookies : [];
  let set = 0, failed = 0;
  for (const c of list) {
    if (!c || !c.name || !c.domain) { failed++; continue; }
    const details = toSetDetails(c);
    // Electron 은 sameSite='no_restriction' 인데 secure=false 이면 거부한다.
    // 크롬에서 넘어온 값이 어긋나면 unspecified 로 낮춰 주입을 살린다.
    if (details.sameSite === 'no_restriction' && !details.secure) {
      details.sameSite = 'unspecified';
    }
    try { await ses.cookies.set(details); set++; }
    catch (e) { failed++; /* 하나 실패해도 나머지는 계속 주입한다 */ }
  }
  return { set, failed };
}

// 제공자 도메인에 해당하는 쿠키만 추린다
async function cookiesFor(ses, domains) {
  try {
    const all = await ses.cookies.get({});
    return all.filter(c => matchesDomains(c.domain, domains));
  } catch (e) {
    return [];
  }
}

// 계정 전환: 해당 제공자의 쿠키만 지운다. 다른 서비스 로그인은 그대로 남는다.
// 지우지 않으면 사이트가 기존 로그인을 인정해 계정 선택 화면이 나오지 않는다.
async function removeFor(ses, domains) {
  const mine = await cookiesFor(ses, domains);
  let removed = 0;
  for (const c of mine) {
    try { await ses.cookies.remove(cookieUrl(c), c.name); removed++; }
    catch (e) { /* 개별 실패는 건너뛴다 */ }
  }
  return { found: mine.length, removed };
}

// 로그인 여부 판정.
// 쿠키 개수만 보면 분석·기기 쿠키 때문에 로그인된 것처럼 착각하기 쉽다
// (예: claude.ai 에 _fbp·anthropic-device-id 가 20개 있어도 sessionKey 가 없으면 미로그인).
// 그래서 인증 쿠키 이름으로만 판단한다.
function hasAuthCookie(cookies, authNames) {
  if (!authNames || !authNames.length) return null;      // 판단 근거 없음
  const names = new Set(cookies.map(c => c.name));
  return authNames.some(n => names.has(n));
}

async function isAuthenticated(ses, domains, authNames) {
  return hasAuthCookie(await cookiesFor(ses, domains), authNames);
}

module.exports = {
  migrateCookies, setCookies, cookiesFor, removeFor, hasAuthCookie, isAuthenticated,
  matchesDomains, cookieUrl, toSetDetails, baseDomain,
};
