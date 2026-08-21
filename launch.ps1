# Claude 사용량 위젯 백그라운드 실행 (PowerShell) — launch.vbs의 PowerShell 판
#
#   pwsh -ExecutionPolicy Bypass -File .\launch.ps1
#
# 콘솔 창을 띄우지 않고 위젯만 실행한다. 이 창은 곧바로 종료되며 위젯은 계속 떠 있는다.

$dir = $PSScriptRoot
$env:ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

# git pull 실패해도 앱은 실행되도록 ; 로 연결
$cmd = 'git pull --ff-only --quiet; npm start'

Start-Process -FilePath 'pwsh' `
              -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', $cmd `
              -WorkingDirectory $dir `
              -WindowStyle Hidden
