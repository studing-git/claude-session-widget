# Claude Usage Widget

Claude.ai Max 플랜 사용량을 항상 화면 위에 표시하는 데스크탑 위젯 (Electron)

> **주의**: 개인 사용 목적으로만 제작되었습니다. 배포 및 상업적 사용은 금지합니다.

---

## 스크린샷

일반 모드 (580×280) / 미니 모드 (160×190)

---

## 설치 및 실행

### 요구사항
- Node.js v18 이상
- npm

### 설치

```bash
git clone https://github.com/studing-git/claude-session-weget.git
cd claude-session-weget
npm install
```

### 실행

```bash
# 개발 모드 (콘솔 로그 확인 가능)
npm start

# Windows — 터미널 없이 실행
start.bat 더블클릭

# Windows — 터미널 창 없이 백그라운드 실행
launch.vbs 더블클릭
```

---

## Windows 시작 시 자동 실행

1. `Win + R` → `shell:startup` 입력
2. 열린 폴더에 `launch.vbs` 바로가기 추가

---

## 동작 원리

1. Electron `BrowserView`를 화면 밖(-2000px)에 숨겨 `claude.ai/settings/usage` 페이지를 렌더링
2. `[role="progressbar"]` 요소가 생길 때까지 0.5초마다 폴링
3. 발견되면 DOM에서 사용량 데이터 추출
4. 위젯 UI에 렌더링 (5분 캐시, 10분 자동 갱신)

> claude.ai가 React SPA이므로 단순 fetch로는 렌더링된 DOM을 얻을 수 없어 실제 브라우저 렌더링이 필요합니다.

---

## 기능

- 현재 세션 / 주간(전체) / 주간(Sonnet) / 추가 사용량 표시
- 원형 게이지 (초록/주황/빨강 색상으로 임박 알림)
- 일반 모드 ↔ 미니 모드 전환
- 항상 최상위(Always on Top)
- 5분 캐시 + 10분 자동 갱신 + 수동 새로고침
- 세션 쿠키 자동 유지 (최초 로그인 후 재인증 불필요)

---

## 알려진 제한사항

- claude.ai HTML 구조 변경 시 파싱이 깨질 수 있음
- 보안 설정 (`nodeIntegration: true`)은 개인 사용 기준이므로 배포 시 preload.js 방식으로 전환 필요
- exe 패키징 미포함 (electron-builder로 직접 빌드 가능)
- macOS에서 동작하나 `launch.vbs`는 Windows 전용

---

## 라이선스

개인 사용 전용. 배포 금지.
