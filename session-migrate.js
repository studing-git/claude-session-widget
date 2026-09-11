// 예전 버전은 세 제공자가 session.defaultSession 을 공유했다.
// 제공자별 파티션(persist:<id>)으로 나누면서 그때까지 쓰던 로그인이 끊겼다.
// 파티션을 처음 쓸 때 defaultSession 에 남아 있는 해당 도메인 쿠키를 옮겨와
// 다시 로그인하지 않아도 되게 한다.

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

module.exports = { migrateCookies, matchesDomains, cookieUrl, toSetDetails, baseDomain };
