# Claude 사용량 위젯 설치 스크립트 (Windows)
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# 또는 내려받지 않고 바로:
#   irm https://raw.githubusercontent.com/studing-git/claude-session-widget/main/install.ps1 | iex
#
# 하는 일:
#   1. git / Node.js(npm) 설치 여부 확인 — 없으면 winget으로 설치할지 물어본다
#   2. 설치 경로를 물어보고 저장소를 clone (이미 있으면 최신으로 갱신)
#   3. npm install
#   4. 바탕화면 바로가기를 만들지 물어본다
#
# 매개변수 없이 실행하면 모든 항목을 대화형으로 물어본다.
# -Yes 를 주면 확인 없이 진행한다(무인 설치).

[CmdletBinding()]
param(
    [string] $InstallPath,
    [switch] $NoShortcut,
    [switch] $Yes
)

$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/studing-git/claude-session-widget.git'
$AppName = 'Claude 사용량 위젯'

function Write-Step  ([string] $Message) { Write-Host ''; Write-Host "== $Message" -ForegroundColor Cyan }
function Write-Ok    ([string] $Message) { Write-Host "   $Message" -ForegroundColor Green }
function Write-Note  ([string] $Message) { Write-Host "   $Message" -ForegroundColor Yellow }

function Confirm-Step {
    param([string] $Question, [bool] $DefaultYes = $true)
    if ($Yes) { return $true }
    $suffix = if ($DefaultYes) { '[Y/n]' } else { '[y/N]' }
    $answer = Read-Host "   $Question $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $DefaultYes }
    return ($answer -match '^\s*(y|yes|예)\s*$')
}

# winget 설치 직후에는 현재 세션의 PATH에 반영되지 않으므로 다시 읽어온다
function Update-SessionPath {
    $parts = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) | Where-Object { $_ }
    if ($parts) { $env:Path = ($parts -join ';') }
}

function Test-Tool([string] $Name) {
    return [bool] (Get-Command $Name -ErrorAction SilentlyContinue)
}

# 필수 도구가 없으면 winget으로 설치할지 물어본다. 설치했으면 $true.
function Install-Requirement {
    param(
        [string] $Command,      # 확인할 실행 파일 이름 (git, npm ...)
        [string] $WingetId,     # winget 패키지 ID
        [string] $Label,        # 사람이 읽는 이름
        [string] $ManualUrl     # winget이 없을 때 안내할 주소
    )

    if (Test-Tool $Command) {
        Write-Ok "$Label 확인됨"
        return $true
    }

    Write-Note "$Label 이(가) 설치되어 있지 않습니다."

    if (-not (Test-Tool 'winget')) {
        Write-Note "winget을 찾을 수 없어 자동 설치할 수 없습니다."
        Write-Note "직접 설치한 뒤 다시 실행해 주세요: $ManualUrl"
        return $false
    }

    if (-not (Confirm-Step "$Label 을(를) winget으로 지금 설치할까요?" $true)) {
        Write-Note "건너뜁니다. 직접 설치: $ManualUrl"
        return $false
    }

    winget install --id $WingetId --exact --source winget `
                   --accept-package-agreements --accept-source-agreements
    Update-SessionPath

    if (Test-Tool $Command) {
        Write-Ok "$Label 설치 완료"
        return $true
    }

    Write-Note "$Label 설치를 확인하지 못했습니다. PowerShell 창을 새로 연 뒤 다시 실행해 주세요."
    return $false
}

function Get-PowerShellExe {
    foreach ($name in @('pwsh', 'powershell')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) { return $cmd.Source }
    }
    return 'powershell.exe'
}

function New-DesktopShortcut([string] $TargetDir) {
    $desktop  = [Environment]::GetFolderPath('Desktop')
    $linkPath = Join-Path $desktop "$AppName.lnk"
    $launcher = Join-Path $TargetDir 'launch.ps1'

    $shell    = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath       = Get-PowerShellExe
    $shortcut.Arguments        = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
    $shortcut.WorkingDirectory = $TargetDir
    $shortcut.Description      = 'Claude.ai 사용량 위젯'

    $icon = Join-Path $TargetDir 'node_modules\electron\dist\electron.exe'
    if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = $icon }

    $shortcut.Save()
    return $linkPath
}

# ── 실행 ──────────────────────────────────────────────────────────────

if ($IsLinux -or $IsMacOS) {
    throw '이 설치 스크립트는 Windows 전용입니다. 다른 OS에서는 git clone 후 npm install을 직접 실행해 주세요.'
}

Write-Host ''
Write-Host "  $AppName 설치" -ForegroundColor White

Write-Step '필수 구성 요소 확인'
$hasGit = Install-Requirement -Command 'git' -WingetId 'Git.Git' -Label 'Git' `
                              -ManualUrl 'https://git-scm.com/downloads'
$hasNpm = Install-Requirement -Command 'npm' -WingetId 'OpenJS.NodeJS.LTS' -Label 'Node.js (npm)' `
                              -ManualUrl 'https://nodejs.org/'

if (-not $hasGit -or -not $hasNpm) {
    throw '필수 구성 요소가 준비되지 않아 설치를 중단합니다.'
}

Write-Step '설치 경로'
if (-not $InstallPath) {
    $default = Join-Path $HOME 'claude-session-widget'
    if ($Yes) {
        $InstallPath = $default
    } else {
        $entered = Read-Host "   설치할 폴더 (그냥 Enter = $default)"
        $InstallPath = if ([string]::IsNullOrWhiteSpace($entered)) { $default } else { $entered.Trim('"').Trim() }
    }
}
$InstallPath = [System.IO.Path]::GetFullPath(
    [System.IO.Path]::Combine((Get-Location).Path, [Environment]::ExpandEnvironmentVariables($InstallPath))
)
Write-Ok $InstallPath

Write-Step '내려받기'
if (Test-Path -LiteralPath (Join-Path $InstallPath '.git')) {
    Write-Ok '이미 설치되어 있어 최신 버전으로 갱신합니다'
    git -C $InstallPath pull --ff-only --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Note '갱신을 건너뜁니다 — 로컬 변경사항이 있거나 오프라인입니다'
    }
} else {
    if (Test-Path -LiteralPath $InstallPath) {
        $existing = Get-ChildItem -LiteralPath $InstallPath -Force -ErrorAction SilentlyContinue |
                    Select-Object -First 1
        if ($existing) {
            throw "폴더가 비어 있지 않습니다: $InstallPath`n다른 경로를 지정하거나 폴더를 비운 뒤 다시 실행해 주세요."
        }
    }
    git clone --quiet $RepoUrl $InstallPath
    if ($LASTEXITCODE -ne 0) { throw '저장소를 내려받지 못했습니다.' }
    Write-Ok '완료'
}

Write-Step '의존성 설치'
Push-Location -LiteralPath $InstallPath
try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install에 실패했습니다.' }
} finally {
    Pop-Location
}
Write-Ok '완료'

if (-not $NoShortcut) {
    Write-Step '바탕화면 바로가기'
    if (Confirm-Step '바탕화면에 바로가기를 만들까요?' $true) {
        $link = New-DesktopShortcut $InstallPath
        Write-Ok "생성됨: $link"
    } else {
        Write-Note '건너뜀'
    }
}

Write-Step '설치 완료'
Write-Host "   위치: $InstallPath"
Write-Host '   실행: launch.ps1 (백그라운드) 또는 start.ps1 (콘솔)'
Write-Host ''

if (Confirm-Step '지금 위젯을 실행할까요?' $true) {
    & (Join-Path $InstallPath 'launch.ps1')
}
