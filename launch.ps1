# Claude 사용량 위젯 백그라운드 실행 (PowerShell) — launch.vbs의 PowerShell 판
#
#   powershell -ExecutionPolicy Bypass -File .\launch.ps1
#   pwsh       -ExecutionPolicy Bypass -File .\launch.ps1
#
# 콘솔 창을 띄우지 않고 위젯만 실행한다. 이 창은 곧바로 종료되며 위젯은 계속 떠 있는다.

$dir = $PSScriptRoot
$env:ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

# 이 스크립트를 실행 중인 PowerShell을 그대로 사용한다.
# (pwsh를 하드코딩하면 Windows PowerShell 5.1만 설치된 환경에서 실패한다)
$psExe = (Get-Process -Id $PID).Path
if (-not $psExe) { $psExe = 'powershell.exe' }

# git pull 실패해도 앱은 실행되도록 ; 로 연결
$cmd = 'git pull --ff-only --quiet; npm start'

Start-Process -FilePath $psExe `
              -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', $cmd `
              -WorkingDirectory $dir `
              -WindowStyle Hidden
