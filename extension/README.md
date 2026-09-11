# AI 사용량 위젯 브리지 (Chrome/Edge 확장)

로그인된 브라우저에서 Claude·ChatGPT·Gemini 사용량을 읽어 데스크탑 위젯으로 전달합니다.

## 설치
1. `chrome://extensions` (Edge: `edge://extensions`) 열기
2. **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** → 이 `extension` 폴더 선택

## 사용
위젯을 실행한 상태로 각 서비스의 사용량 페이지를 한 번씩 엽니다.
- https://claude.ai/settings/usage
- https://gemini.google.com/usage
- ChatGPT: 앱에서 설정 › 사용량

이후 위젯이 켜져 있으면 15분마다 배경에서 자동 갱신합니다.

## 구조
- `content-collect.js` — 사용량 페이지의 렌더된 DOM 을 파싱해 백그라운드로 전달
- `background.js` — 위젯 로컬 서버(127.0.0.1:47836)로 전달, 배경 갱신
- `providers/*.js` — 위젯과 동일한 파서 (루트에서 복사됨, `node sync-extension-parsers.js` 로 동기화)
