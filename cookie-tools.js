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

// 쿠키를 지우려면 URL 이 필요하다. 도메인·경로·secure 로 되살린다.
function cookieUrl(c) {
  return `${c.secure ? 'https' : 'http'}://${baseDomain(c.domain)}${c.path || '/'}`;
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
  cookiesFor, removeFor, hasAuthCookie, isAuthenticated,
  matchesDomains, cookieUrl, baseDomain,
};
