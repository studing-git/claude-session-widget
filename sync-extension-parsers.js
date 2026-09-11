#!/usr/bin/env node
// providers/*.js 를 extension/providers/ 로 복사한다.
// 확장의 콘텐츠 스크립트는 확장 폴더 밖의 파일을 참조할 수 없어 복사본이 필요하다.
// 파서를 고치면 이 스크립트를 다시 실행한다: node sync-extension-parsers.js
const fs = require('fs');
const path = require('path');
const files = ['claude.js', 'chatgpt.js', 'gemini.js'];
let changed = 0;
for (const f of files) {
  const src = path.join(__dirname, 'providers', f);
  const dst = path.join(__dirname, 'extension', 'providers', f);
  const a = fs.readFileSync(src, 'utf8');
  const b = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null;
  if (a !== b) { fs.writeFileSync(dst, a); changed++; console.log('updated', dst); }
}
console.log(changed ? `${changed}개 갱신됨` : '이미 최신');

// --check 모드: 차이가 있으면 0이 아닌 코드로 종료 (테스트/CI 용)
if (process.argv.includes('--check')) {
  for (const f of files) {
    const a = fs.readFileSync(path.join(__dirname, 'providers', f), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, 'extension', 'providers', f), 'utf8');
    if (a !== b) { console.error('DRIFT:', f); process.exit(1); }
  }
}
