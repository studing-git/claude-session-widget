// git 기반 자동 업데이트 (방법 1)
// 저장소를 그대로 실행하는 구조이므로, origin의 최신 커밋을 받아오는 것만으로 업데이트가 된다.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_DIR = path.join(__dirname);
const GIT_TIMEOUT = 30000;
const NPM_TIMEOUT = 180000;

function git(args, timeout = GIT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: REPO_DIR, timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.detail = (stderr || '').trim() || err.message;
        reject(err);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function npmInstall() {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFile(cmd, ['install', '--no-audit', '--no-fund'], {
      cwd: REPO_DIR,
      timeout: NPM_TIMEOUT,
      windowsHide: true,
      shell: process.platform === 'win32',
    }, (err, stdout, stderr) => {
      if (err) {
        err.detail = (stderr || '').trim() || err.message;
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

// 주기적 확인과 사용자의 업데이트 적용이 겹쳐 git이 동시에 돌지 않게 직렬화한다
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function isGitCheckout() {
  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) return false;
  try {
    return (await git(['rev-parse', '--is-inside-work-tree'])) === 'true';
  } catch (e) {
    return false;
  }
}

async function getBranch() {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  // detached HEAD 상태면 추적할 브랜치를 알 수 없다
  return branch === 'HEAD' ? null : branch;
}

// { available, behind, branch, local, remote, subject } 또는 { available:false, reason }
async function checkForUpdateImpl() {
  if (!(await isGitCheckout())) {
    return { available: false, reason: 'not_git' };
  }
  try {
    const branch = await getBranch();
    if (!branch) return { available: false, reason: 'detached' };

    await git(['fetch', '--quiet', 'origin', branch]);
    const local  = await git(['rev-parse', 'HEAD']);
    const remote = await git(['rev-parse', 'FETCH_HEAD']);
    if (local === remote) return { available: false, branch, local, remote };

    // 로컬이 원격보다 앞서 있는 경우(직접 커밋)는 업데이트가 아니다
    const behind = parseInt(await git(['rev-list', '--count', `HEAD..${remote}`]), 10) || 0;
    if (behind === 0) return { available: false, branch, local, remote };

    let subject = '';
    try { subject = await git(['log', '-1', '--format=%s', remote]); } catch (e) {}
    return { available: true, behind, branch, local, remote, subject };
  } catch (e) {
    return { available: false, reason: 'error', message: e.detail || e.message };
  }
}

// { ok:true, from, to } 또는 { ok:false, reason, message }
async function applyUpdateImpl() {
  if (!(await isGitCheckout())) return { ok: false, reason: 'not_git' };
  try {
    const branch = await getBranch();
    if (!branch) return { ok: false, reason: 'detached', message: '브랜치를 확인할 수 없습니다' };

    // 로컬 수정본을 덮어쓰지 않는다.
    // 추적되지 않는 파일(메모·스크린샷 등)은 업데이트를 막지 않는다 — 충돌이 나면 merge가 알려준다.
    const dirty = await git(['status', '--porcelain', '--untracked-files=no']);
    if (dirty) return { ok: false, reason: 'dirty', message: '로컬에 커밋되지 않은 변경사항이 있습니다' };

    await git(['fetch', '--quiet', 'origin', branch]);
    const from   = await git(['rev-parse', 'HEAD']);
    const remote = await git(['rev-parse', 'FETCH_HEAD']);
    if (from === remote) return { ok: true, from, to: remote, restart: false };

    // 의존성이 바뀌었을 때만 npm install
    let depsChanged = false;
    try {
      const changed = await git(['diff', '--name-only', from, remote]);
      depsChanged = changed.split('\n').some(f => f === 'package.json' || f === 'package-lock.json');
    } catch (e) {
      depsChanged = true; // 판단 불가 시 안전하게 설치
    }

    await git(['merge', '--ff-only', remote]);
    if (depsChanged) await npmInstall();

    return { ok: true, from, to: remote, restart: true };
  } catch (e) {
    return { ok: false, reason: 'error', message: e.detail || e.message };
  }
}

const checkForUpdate = () => serialize(checkForUpdateImpl);
const applyUpdate    = () => serialize(applyUpdateImpl);

module.exports = { checkForUpdate, applyUpdate, isGitCheckout };
