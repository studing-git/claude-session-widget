// 아주 작은 설정 저장소. userData 아래 JSON 한 개만 쓴다.
// 지금은 제공자별 조회 방식(electron | chrome)만 담는다.

const fs   = require('fs');
const path = require('path');

function filePath(baseDir) {
  return path.join(baseDir, 'settings.json');
}

function read(baseDir) {
  try {
    return JSON.parse(fs.readFileSync(filePath(baseDir), 'utf8')) || {};
  } catch (e) {
    return {};                       // 없거나 깨졌으면 기본값으로 시작한다
  }
}

function write(baseDir, data) {
  try {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(filePath(baseDir), JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

// 제공자의 조회 방식. 기본은 Electron 내장 브라우저.
function getBackend(baseDir, providerId) {
  const b = (read(baseDir).backends || {})[providerId];
  return b === 'chrome' ? 'chrome' : 'electron';
}

function setBackend(baseDir, providerId, backend) {
  const data = read(baseDir);
  data.backends = data.backends || {};
  if (backend === 'electron') delete data.backends[providerId];
  else data.backends[providerId] = 'chrome';
  write(baseDir, data);
  return getBackend(baseDir, providerId);
}

module.exports = { filePath, read, write, getBackend, setBackend };
