# Claude 사용량 위젯 실행 (PowerShell)
#
#   pwsh -ExecutionPolicy Bypass -File .\start.ps1
#
# 콘솔 창 없이 백그라운드로 띄우려면 README의 "PowerShell로 실행" 항목 참고.

Set-Location -LiteralPath $PSScriptRoot

# 실행 전 최신 버전 받기. 실패(오프라인·로컬 변경사항 등)해도 앱은 그대로 실행한다.
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host '[update] 최신 버전 확인 중...' -ForegroundColor DarkGray
    git pull --ff-only --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[update] 건너뜀 — 오프라인이거나 로컬 변경사항이 있습니다' -ForegroundColor Yellow
    }
} else {
    Write-Host '[update] git이 없어 자동 업데이트를 건너뜁니다' -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
    Write-Host '[setup] 의존성 설치 중...' -ForegroundColor DarkGray
    npm install
}

npm start
