# claude-session-widget

Claude.ai Max 플랜 사용량을 항상 화면 위에 표시하는 데스크탑 위젯 (Electron)

> **주의**: 개인 사용 목적으로만 제작되었습니다. 배포 및 상업적 사용은 금지합니다.

---

## ⚠️ 주의사항

- **본인 claude.ai 계정으로만 사용**
- **개인 사용 목적으로만 제작됨**
- **Anthropic 이용약관을 준수하세요**

claude.ai에 대한 자동 접근은 Anthropic의 서비스 이용약관(Consumer ToS Section 3.7) 위반 소지가 있습니다. **ChatGPT·Gemini 패널도 각 서비스의 페이지를 자동으로 열어 읽으므로 OpenAI·Google 약관에 대해 같은 문제가 적용됩니다.** 개인 사용은 회색지대이나, 배포 및 상업적 사용은 명확한 위반이므로 금지됩니다.

---

## 설치 및 실행

### 요구사항
- Node.js v18 이상
- npm

### 자동 설치 (Windows, 권장)

PowerShell에서 아래 한 줄을 실행하면 필수 구성 요소 확인부터 바로가기 생성까지 안내에 따라 진행됩니다.

```powershell
irm https://raw.githubusercontent.com/studing-git/claude-session-widget/main/install.ps1 | iex
```

설치 스크립트가 하는 일:
1. **git / Node.js(npm) 확인** — 없으면 `winget`으로 설치할지 물어봅니다 (동의 없이 설치하지 않습니다). `winget`이 없으면 공식 다운로드 주소를 안내합니다.
2. **설치 경로 선택** — 그냥 Enter를 누르면 `%USERPROFILE%\claude-session-widget`에 설치합니다.
3. **저장소 clone + `npm install`** — 이미 설치된 폴더면 최신으로 갱신만 합니다.
4. **바탕화면 바로가기 생성 여부 확인**

보호된 위치(`C:\Program Files` 등)를 직접 지정하면 관리자 권한으로 다시 실행할지 물어봅니다(UAC).

옵션:
```powershell
# 경로를 미리 지정하고 모든 확인을 자동 승인 (무인 설치)
.\install.ps1 -InstallPath 'D:\apps\claude-widget' -Yes

# 바로가기 없이 설치
.\install.ps1 -NoShortcut
```

> 이미 있는 폴더가 비어 있지 않으면 덮어쓰지 않고 중단합니다.

#### 설치 위치와 자동 업데이트

위젯은 자기 폴더에서 `git pull`을 실행해 스스로 업데이트합니다. 따라서 **설치 폴더는 위젯을 실행하는 사용자가 쓸 수 있어야 합니다.**

기본값인 사용자 폴더(`%USERPROFILE%\claude-session-widget`)는 이 조건을 만족하므로 아무 설정 없이 자동 업데이트가 동작합니다.

`C:\Program Files` 아래처럼 관리자만 쓸 수 있는 위치를 직접 지정하면, 일반 권한으로 실행되는 위젯이 자기 폴더에 쓸 수 없어 **업데이트가 실패합니다.** 이 경우 설치 스크립트가 경고하고 두 가지 중에 고르게 합니다.

- **사용자 폴더에 설치 (권장)** — 권한 조정 없이 자동 업데이트가 동작합니다.
- **설치 폴더에 쓰기 권한 부여** — 자동 업데이트는 되지만, 보호된 위치에 사용자가 쓸 수 있는 폴더가 생기므로 보안상 권장하지 않습니다. 기본값은 "부여 안 함"입니다.

권한을 부여하지 않고 보호된 위치에 설치했다면, 업데이트할 때 런처를 관리자 권한으로 실행해야 합니다.

### 수동 설치

```bash
git clone https://github.com/studing-git/claude-session-widget.git
cd claude-session-widget
npm install
```

### 실행

#### 1. npm으로 실행 (콘솔 로그 확인 가능)
```bash
npm start
```

#### 2. Windows — 터미널 없이 실행
```bash
start.bat  # 더블클릭
```

#### 3. Windows — 백그라운드 실행 (권장)
```bash
launch.vbs  # 더블클릭
```

#### 4. PowerShell로 실행

PowerShell 7(`pwsh`) 기준입니다. `.ps1`은 기본 실행 정책에서 차단될 수 있어 `-ExecutionPolicy Bypass`를 함께 씁니다.

**콘솔에서 실행** (로그 확인 가능, 창을 닫으면 위젯도 종료됨)
```powershell
cd C:\경로\claude-session-widget
pwsh -ExecutionPolicy Bypass -File .\start.ps1
```

**백그라운드 실행** (콘솔 없이, `launch.vbs`와 동일한 동작)
```powershell
pwsh -ExecutionPolicy Bypass -File .\launch.ps1
```

**스크립트 없이 한 줄로**
```powershell
cd C:\경로\claude-session-widget; git pull --ff-only; npm start
```
> `;`로 연결하면 `git pull`이 실패해도(오프라인 등) 위젯은 그대로 실행됩니다.
> `&&`는 PowerShell 7 이상에서만 동작하며, pull 실패 시 실행이 중단됩니다.

#### 5. Windows 시작 시 자동 실행

**방법 A — 시작 폴더**
1. `Win + R` → `shell:startup` 입력
2. 열린 폴더에 `launch.vbs` 바로가기 추가 (PowerShell을 쓰려면 아래 대상으로 바로가기 생성)
   ```
   pwsh -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\경로\claude-session-widget\launch.ps1"
   ```

**방법 B — 작업 스케줄러 (PowerShell로 등록)**
```powershell
$dir    = 'C:\경로\claude-session-widget'
$action = New-ScheduledTaskAction -Execute 'pwsh' `
          -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\launch.ps1`"" `
          -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'ClaudeUsageWidget' -Action $action -Trigger $trigger
```
해제하려면 `Unregister-ScheduledTask -TaskName 'ClaudeUsageWidget'`

---

## 사용 방법

### 기본 조작
- **타이틀바 드래그**: 위젯 창 이동
- **⊞ / ⊟ 버튼**: 모드 순환 — 통합(360×약257) → Claude 상세(580×약268) → 미니(144×약123)
- **↻ 버튼**: 데이터 새로고침 (강제 갱신)
- **⬆ 업데이트 버튼**: 새 버전이 있을 때만 표시 (아래 "자동 업데이트" 참고)
- **─ 버튼**: 창 최소화
- **✕ 버튼**: 앱 종료
- **로그인 버튼**: 해당 서비스 로그인 창 열기
- **전환 버튼**: 해당 서비스에서 로그아웃하고 다른 계정으로 로그인 (행에 마우스를 올리면 표시)

### 자동 업데이트

저장소를 그대로 실행하는 구조라 `git pull`이 곧 업데이트입니다. 두 단계로 동작합니다.

1. **실행할 때**: `start.bat` / `launch.vbs`가 앱을 띄우기 전에 `git pull --ff-only`를 실행합니다. 오프라인이거나 pull이 실패해도 앱은 그대로 실행됩니다.
2. **실행 중일 때**: 앱이 시작 5초 후와 이후 30분마다 `git fetch`로 새 커밋을 확인합니다. 새 버전이 있으면 타이틀바에 주황색 **⬆ 업데이트** 배지가 나타나고, 클릭하면 pull → (필요 시) `npm install` → 자동 재시작합니다.

**안전장치**
- 로컬에 커밋되지 않은 변경사항이 있으면 업데이트를 중단합니다 (작업 내용 보호)
- `--ff-only`만 사용하므로 히스토리가 갈라지면 진행하지 않습니다
- `package.json` / `package-lock.json`이 바뀐 경우에만 `npm install`을 실행합니다
- git 저장소가 아니거나(zip 다운로드 등) detached HEAD면 업데이트 기능이 조용히 비활성화됩니다
- 로컬 커밋이 원격보다 앞서 있으면 업데이트로 간주하지 않습니다

> 요구사항: 실행 환경에 `git`이 설치되어 있고, `git clone`으로 받은 디렉터리여야 합니다.

### 데이터 업데이트
- **5분 캐시**: 5분 이내 재요청 시 이전 데이터 표시
- **5분 자동 갱신**: 백그라운드에서 자동으로 최신 데이터 가져오기
- **수동 새로고침**: ↻ 버튼으로 즉시 갱신
- **자동 재시도**: 네트워크 오류 시 30초→60초→120초→300초 간격으로 자동 재시도, 하단에 카운트다운 표시

### 첫 실행 시
1. 앱 시작
2. 데이터 로딩 중... 화면 표시
3. 로그인 필요 시 "로그인" 버튼 클릭
4. 인증 완료 후 자동으로 데이터 표시
5. 이후 세션 쿠키 자동 유지 (재로그인 불필요)

---

## 기능

### 통합 패널 (기본 화면)

Claude · ChatGPT · Gemini 사용량을 한 화면에서 봅니다. 제공자마다 한 행이며, 각 행은 요약 지표 2개를 가로 막대로 보여줍니다. 로그인되지 않은 서비스는 그 행에만 **로그인** 버튼이 뜨고, 나머지는 정상 표시됩니다.

#### 계정 · 로그인

세 제공자는 **하나의 세션(`defaultSession`)을 공유**합니다. 쿠키는 도메인별로 저장되므로 서비스마다 서로 다른 계정을 써도 충돌하지 않습니다.

> 한때 제공자별 세션 파티션(`persist:<id>`)으로 나눴으나, 그때까지 쓰던 로그인이 끊기는 문제가 있어 되돌렸습니다. 계정 격리는 도메인 단위로 이미 보장됩니다.

- **로그인** — 연결되지 않은 행의 `로그인` 버튼을 누르면 해당 서비스 로그인 창이 열립니다. 창을 닫으면 자동으로 다시 조회합니다.
- **계정 전환** — 연결된 행에 마우스를 올리면 `전환` 버튼이 나타납니다. **해당 제공자의 도메인 쿠키만** 지운 뒤 로그인 창을 엽니다(다른 서비스 로그인은 유지). 쿠키를 비우지 않으면 사이트가 기존 로그인을 그대로 인정해 **계정 선택 화면이 나오지 않기 때문**입니다. 실행 전 확인을 받습니다.

| 제공자 | 출처 | 요약 지표 |
|---|---|---|
| Claude | `claude.ai/settings/usage` | 세션 · 주간 |
| ChatGPT | `chatgpt.com` 설정 › 사용량 | 주간 한도 · 크레딧 |
| Gemini | `gemini.google.com/usage` | 현재 · 주간 |

**ChatGPT 수치의 범위** — 해당 페이지는 *"Codex, Work, 워크스페이스 에이전트, Excel용 ChatGPT에서 공유됩니다. Chat 대화는 포함되지 않습니다"* 라고 명시합니다. 즉 **일반 ChatGPT 대화 사용량이 아닙니다.** 위젯에도 `Codex · Work` 로 표기해 구분합니다.

**퍼센트 의미 통일** — ChatGPT는 잔여율("100% 남음"), Claude·Gemini는 사용률("29% 사용됨")을 표시합니다. 위젯은 모두 **사용률**로 변환해 같은 기준으로 보여줍니다.

### Claude 상세 (표시 정보)
- **현재 세션**: 현재 대화 세션의 사용률
- **주간(전체)**: 일주일 전체 모델의 사용률
- **주간(모델별)**: claude.ai가 표시하는 모델별 주간 사용률 (라벨은 페이지에서 읽어 표시)
- **사용 크레딧**: 유료 추가 사용 금액 및 잔액

### 시각적 표현
- **원형 게이지**: 
  - 🟢 초록색 (0~49%): 여유 있음
  - 🟠 주황색 (50~79%): 주의 필요
  - 🔴 빨강색 (80~100%): 임박함
- **재설정 시간**: 각 제한이 초기화되는 시간 표시
- **통합 모드**: 3사를 행으로 나열, 각 행에 가로 막대 2개
- **Claude 상세**: Claude 지표를 원형 게이지 카드로 표시
- **미니 모드**: 3사를 한 줄씩 요약 (재설정 시각은 hover 시 툴팁으로 확인)

### 특징
- 항상 최상위(Always on Top) 표시
- 중복 실행 방지: 이미 실행 중이면 새 창을 띄우지 않고 기존 창을 앞으로 가져옴
- 화면 모서리에 여백 없이 밀착
- 모드 순환 (통합 ↔ Claude 상세 ↔ 미니)
- 제공자별 독립 상태: 한 서비스가 실패해도 나머지는 정상 표시
- 화면 모서리 자동 스냅 (드래그/모드 전환 시)
- 네트워크 오류 자동 재시도 (Progressive Backoff)
- Claude Design 주간 한도 표시 지원
- 백그라운드 자동 갱신 (5분)
- 세션 쿠키 자동 유지

---

## 기술 정보

### 동작 원리
1. 제공자마다 Electron `BrowserView`를 화면 밖(-2000px)에 띄워 사용량 페이지를 렌더링 (3사 동시 진행)
2. 각 제공자의 `readySelector`가 나타날 때까지 0.5초마다 폴링
3. 수집한 HTML을 `providers/<id>.js` 파서가 정규화된 지표 배열로 변환
4. 위젯 UI에 렌더링

> 세 서비스 모두 SPA라 단순 fetch로는 렌더링된 DOM을 얻을 수 없어 실제 브라우저 렌더링이 필요합니다.

**제공자별 파싱 훅**

| 제공자 | 게이지 role | 파싱 근거 |
|---|---|---|
| Claude | `role="meter"` | `aria-valuenow` + 카드 라벨 텍스트 |
| ChatGPT | 없음 | `"N% 남음"` 텍스트 → 사용률로 변환, 재설정은 버튼 `aria-label` |
| Gemini | 없음 | `data-test-id="gxu-currently"` / `"gxu-weekly"` |

**브라우저 신원 위장** (`browser-identity.js`) — Google은 임베디드 브라우저로 판단되면 로그인을 거부합니다(*"브라우저 또는 앱이 안전하지 않을 수 있습니다"*). Claude·ChatGPT를 Google 계정으로 로그인하는 경우에도 같은 화면에서 막힙니다.

UA 문자열만 고쳐서는 부족합니다. Chromium은 **`Sec-CH-UA` 클라이언트 힌트**로 브랜드 목록을 따로 보내는데 거기에 `"Electron";v="28"`이 남기 때문입니다. 그래서 세션마다 다음을 모두 맞춥니다.

| 헤더 | 위장 후 |
|---|---|
| `User-Agent` | `Mozilla/5.0 (...) Chrome/<버전>.0.0.0 Safari/537.36` |
| `sec-ch-ua` | `"Not_A Brand";v="8", "Chromium";v="<버전>", "Google Chrome";v="<버전>"` |
| `sec-ch-ua-platform` | `"Windows"` / `"macOS"` / `"Linux"` |
| `Sec-CH-UA-Full-Version-List` | 제거 (Electron 버전이 드러나고 위장값과 어긋남) |

광고하는 Chrome 버전은 Electron이 실제로 내장한 Chromium 버전을 그대로 씁니다. 다른 버전을 광고하면 오히려 불일치로 걸릴 수 있습니다.

실제로 무엇이 전송되는지는 F12 콘솔에서 확인할 수 있습니다.
```js
await require('electron').ipcRenderer.invoke('browser-identity')
```

**로그인 진단** — 앱을 켜면 F12 콘솔에 제공자별 쿠키 상태가 표로 찍힙니다. 직접 부를 수도 있습니다.
```js
console.table(await require('electron').ipcRenderer.invoke('session-report'))
```
| 제공자 | 로그인 | 쿠키수 | 인증쿠키 | 조회방식 |
|---|---|---|---|---|
| Claude | 아니오 | 20 | 없음 | electron |
| Gemini | 예 | 25 | SSID, SAPISID | electron |

**`쿠키수`로 판단하면 안 됩니다.** 분석·기기 식별 쿠키(`_fbp`, `anthropic-device-id` 등)가 수십 개 쌓여 있어도 로그인과는 무관합니다. `로그인` 열은 제공자별 **인증 쿠키**(Claude `sessionKey`, ChatGPT `__Secure-next-auth.session-token`, Google `SID`/`SSID`/`__Secure-1PSID`)가 있는지로만 판정합니다.

- `로그인: 아니오` → 로그인이 실제로 안 된 상태. 위젯도 "로그인 필요"로 표시합니다.
- `로그인: 예` 인데 사용량이 안 나옴 → 파싱이나 페이지 구조 문제.

#### 그래도 막히면 — Chrome 방식

Google 의 탐지는 헤더 외 신호도 봅니다. 위 위장으로도 차단되면 **진짜 Chrome 을 쓰는 경로**로 전환할 수 있습니다.

로그인되지 않은 행에 `로그인` 옆으로 **`Chrome`** 버튼이 나타납니다(Chrome 또는 Edge 가 설치된 경우).

1. 누르면 **전용 프로필**로 진짜 Chrome 창이 열립니다. 진짜 Chrome 이므로 Google 이 차단하지 않습니다.
2. 로그인한 뒤 **창을 닫으면** 그 제공자가 Chrome 방식으로 전환됩니다.
3. 이후 조회는 같은 프로필로 `--headless=new --dump-dom` 을 실행해 렌더된 DOM 을 읽습니다. 프로필에 쿠키가 남아 있어 로그인 상태가 유지됩니다.

Chrome 방식인 제공자는 플랜 옆에 **`·C`** 표시가 붙습니다.

- 프로필은 제공자별로 분리됩니다 (`<userData>/chrome-profiles/<id>`). 서비스마다 다른 계정을 쓸 수 있고, 사용자의 평소 Chrome 프로필은 건드리지 않습니다.
- 조회 중 **Chrome 로그인 창이 열려 있으면 프로필이 잠겨** 조회가 실패합니다. 이 경우 창을 닫으라고 안내합니다.
- 계정 전환(`전환` 버튼)은 Chrome 방식에서도 동작합니다 — 해당 프로필 폴더를 비우고 로그인 창을 다시 엽니다.
- Chrome 이 없으면 Edge 를 대신 찾습니다. 경로를 직접 지정하려면 `CHROME_PATH` 환경변수를 쓰세요.

### 기술 스택
- **Electron 28**: 데스크탑 앱 프레임워크
- **Node.js v24**: 런타임
- **순수 HTML/CSS/JS**: 프론트엔드 (외부 라이브러리 없음)

---

## 알려진 제한사항

- 각 서비스의 HTML 구조 변경 시 파싱이 깨질 수 있음 (ChatGPT·Gemini는 게이지에 `role`이 없어 Claude보다 취약)
- ChatGPT 패널은 Codex/Work 한도이며 일반 Chat 대화 사용량은 포함하지 않음
- 보안 설정(`nodeIntegration: true`)은 개인 사용 기준 — 배포 시 preload.js 방식으로 전환 필요
- exe 패키징 미포함 (electron-builder로 직접 빌드 가능)
- macOS에서 동작하나 `launch.vbs`는 Windows 전용

---

## 문제 해결

### `Unable to move the cache: 액세스가 거부되었습니다 (0x5)` / `Gpu Cache Creation failed`

위젯이 두 개 이상 동시에 실행되어 같은 캐시 디렉터리를 다툴 때 나타납니다. 중복 실행 방지가 적용된 이후로는 두 번째 실행이 기존 창을 앞으로 가져오고 스스로 종료하므로 발생하지 않습니다.

이미 여러 개가 떠 있다면 모두 종료 후 다시 실행하세요.
```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process
```

### `fatal: not a git repository`

zip 등으로 파일만 받은 폴더입니다. 자동 업데이트는 git 저장소에서만 동작합니다. 제자리에서 전환하려면(추적 파일이 덮어써지므로 직접 수정한 내용은 먼저 백업):
```powershell
git init
git remote add origin https://github.com/studing-git/claude-session-widget.git
git fetch origin main
git checkout -f -B main origin/main
```

## 변경 이력

### 2026-09-09
- **통합 패널 추가**: Claude · ChatGPT · Gemini 사용량을 한 화면에서 확인. 제공자별 행 레이아웃(360px)
- **모드 순환**: 통합 → Claude 상세 → 미니
- **제공자별 로그인**: 미로그인 서비스는 해당 행에서만 로그인 안내, 나머지는 정상 표시
- **제공자별 세션 분리 및 계정 전환**: 서비스마다 쿠키를 분리해 서로 다른 계정 사용 가능, `전환` 버튼으로 계정 변경
- **파서 계층 분리**: `providers/` 로 제공자별 파서 분리 및 정규화 모델 도입
- **동시 조회**: 3사를 병렬로 조회해 대기 시간 단축, 한 곳이 실패해도 나머지는 표시
- **User-Agent 정리**: Electron·앱 토큰을 제거해 Google 로그인 차단 가능성 완화
- **Chrome 방식 조회**: Google 로그인이 막힐 때 진짜 Chrome 으로 로그인·조회하는 경로 추가

### 2026-08-21
- **미니 모드 축소**: 160×183 → 144×141. 재설정 텍스트를 화면에서 빼고(게이지 hover 시 툴팁으로 확인) 여백을 조임
- **설치 스크립트 추가**: `install.ps1` — git/Node.js 확인 및 winget 설치, 설치 경로 선택(기본 `%USERPROFILE%\claude-session-widget`), 보호된 위치 지정 시 UAC 승격, 바탕화면 바로가기 생성
- **모서리 여백 제거**: 스냅 시 화면 가장자리에 밀착 (`SNAP_MARGIN` 10 → 0)
- **런처 이식성**: `launch.ps1`이 `pwsh` 하드코딩 대신 실행 중인 PowerShell을 사용 (Windows PowerShell 5.1 지원)
- **중복 실행 방지**: 두 인스턴스가 같은 캐시를 다투며 발생하던 `Unable to move the cache` 오류 해소
- **런처 출력 정리**: `git pull`에 `--quiet` 적용 (실패 시 오류는 그대로 표시)
- **PowerShell 지원**: `start.ps1` / `launch.ps1` 추가
- **자동 업데이트 추가**: 실행 시 `git pull`, 실행 중에는 30분마다 새 커밋 감지 → ⬆ 배지 클릭으로 업데이트 후 자동 재시작
- **파싱 수정**: claude.ai 사용량 페이지 리뉴얼 대응 (`[role="progressbar"]` → `[role="meter"]`, 라벨 기반 카드 매핑, 플랜·크레딧·잔액 선택자 갱신)

### 2026-04-28
- **Claude Design 카드 추가**: Max 플랜의 주간 Claude Design 사용률을 일반 모드에 표시
- **창 너비 확장**: 일반 모드 580px → 680px (5카드 레이아웃)
- **파싱 개선**: claude.ai HTML 구조 변경(bars 인덱스 이동) 대응, CSS 클래스 기반 선택자로 전환
- **자동 재시도**: 네트워크·타임아웃 오류 시 Progressive Backoff 자동 재시도 (30s→60s→120s→300s)
- **재시도 카운트다운**: 하단 푸터에 "N초 후 재시도" 실시간 표시
- **자동 갱신 주기**: 10분 → 5분 단축

### 2026-04-27
- **UI 전면 개선**: 다크 테마, 원형 게이지, 타이틀바 아이콘 버튼(⊟/⊞/↻)
- **화면 모서리 스냅**: 드래그 종료 및 모드 전환 시 가장 가까운 모서리로 자동 스냅
- **사용률 색상 연동**: 카드 테두리·배경이 사용률(0~49%/50~79%/80%+)에 따라 변화
- **재설정 시간 툴팁**: 게이지 hover 시 재설정 시각 표시
- **업데이트 타이머**: 마지막 갱신 후 경과 시간 실시간 카운트업

---

## 라이선스

개인 사용 전용. 배포 금지.
