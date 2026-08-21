# claude-session-widget

Claude.ai Max 플랜 사용량을 항상 화면 위에 표시하는 데스크탑 위젯 (Electron)

> **주의**: 개인 사용 목적으로만 제작되었습니다. 배포 및 상업적 사용은 금지합니다.

---

## ⚠️ 주의사항

- **본인 claude.ai 계정으로만 사용**
- **개인 사용 목적으로만 제작됨**
- **Anthropic 이용약관을 준수하세요**

Automated access to claude.ai의 자동 접근은 Anthropic의 서비스 이용약관(Consumer ToS Section 3.7) 위반 소지가 있습니다. 개인 사용은 회색지대이나, 배포 및 상업적 사용은 명확한 위반이므로 금지됩니다.

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
2. **설치 경로 선택** — 그냥 Enter를 누르면 `C:\Program Files\Devdragon\claude-session-widget`에 설치합니다.
3. **관리자 권한 확인** — 기본 경로는 보호된 위치라 권한이 필요합니다. 권한이 없으면 관리자로 다시 실행할지 물어봅니다(UAC).
4. **저장소 clone + `npm install`** — 이미 설치된 폴더면 최신으로 갱신만 합니다.
5. **자동 업데이트 권한 설정** — 아래 참고.
6. **바탕화면 바로가기 생성 여부 확인**

옵션:
```powershell
# 경로를 미리 지정하고 모든 확인을 자동 승인 (무인 설치)
.\install.ps1 -InstallPath 'D:\apps\claude-widget' -Yes

# 바로가기 없이 설치
.\install.ps1 -NoShortcut
```

> 이미 있는 폴더가 비어 있지 않으면 덮어쓰지 않고 중단합니다.

#### Program Files에 설치할 때의 자동 업데이트

`C:\Program Files` 아래는 관리자만 쓸 수 있습니다. 위젯은 자기 폴더에서 `git pull`을 실행해 스스로 업데이트하므로, 일반 권한으로 실행하면 **업데이트가 실패합니다**.

그래서 설치 스크립트는 마지막에 **설치 폴더에 한해** 현재 사용자에게 수정 권한을 줄지 물어봅니다.

- **부여함(기본)** — 위젯이 평소처럼 스스로 업데이트합니다.
- **부여 안 함** — 업데이트하려면 런처를 관리자 권한으로 실행해야 합니다.

> 이 권한 부여는 `Program Files\Devdragon\claude-session-widget` 폴더 하나에만 적용됩니다. 다만 Program Files 아래에 사용자가 쓸 수 있는 폴더가 생기는 것이므로, 이를 피하고 싶다면 사용자 폴더(예: `%USERPROFILE%\claude-session-widget`)에 설치하는 편이 더 안전합니다. 그 경우 권한 조정 없이 자동 업데이트가 동작합니다.

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
- **⊟ 버튼**: 미니 모드 전환 (680×280 ↔ 160×190)
- **↻ 버튼**: 데이터 새로고침 (강제 갱신)
- **⬆ 업데이트 버튼**: 새 버전이 있을 때만 표시 (아래 "자동 업데이트" 참고)
- **─ 버튼**: 창 최소화
- **✕ 버튼**: 앱 종료
- **로그인 버튼**: claude.ai 로그인

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

### 표시 정보
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
- **일반 모드**: 상세 정보 5개 카드 표시 (Claude Design 포함)
- **미니 모드**: 세션·주간 2개 카드 표시

### 특징
- 항상 최상위(Always on Top) 표시
- 중복 실행 방지: 이미 실행 중이면 새 창을 띄우지 않고 기존 창을 앞으로 가져옴
- 화면 모서리에 여백 없이 밀착
- 모드 전환 가능 (일반 ↔ 미니)
- 화면 모서리 자동 스냅 (드래그/모드 전환 시)
- 네트워크 오류 자동 재시도 (Progressive Backoff)
- Claude Design 주간 한도 표시 지원
- 백그라운드 자동 갱신 (5분)
- 세션 쿠키 자동 유지

---

## 기술 정보

### 동작 원리
1. Electron `BrowserView`를 화면 밖(-2000px)에 숨겨 `claude.ai/settings/usage` 페이지를 렌더링
2. `[role="meter"]` 요소가 생길 때까지 0.5초마다 폴링
3. 발견되면 DOM에서 사용량 데이터 추출 (카드 라벨 텍스트 기준 매핑 — 바 순서·개수가 바뀌어도 견딤)
4. 위젯 UI에 렌더링

> claude.ai가 React SPA이므로 단순 fetch로는 렌더링된 DOM을 얻을 수 없어 실제 브라우저 렌더링이 필요합니다.

### 기술 스택
- **Electron 28**: 데스크탑 앱 프레임워크
- **Node.js v24**: 런타임
- **순수 HTML/CSS/JS**: 프론트엔드 (외부 라이브러리 없음)

---

## 알려진 제한사항

- claude.ai HTML 구조 변경 시 파싱이 깨질 수 있음
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

### 2026-08-21
- **설치 스크립트 추가**: `install.ps1` — git/Node.js 확인 및 winget 설치, 설치 경로 선택(기본 `C:\Program Files\Devdragon\claude-session-widget`), UAC 승격, 자동 업데이트 권한 설정, 바탕화면 바로가기 생성
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
