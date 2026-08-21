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
    [switch] $Yes,

    # 관리자 권한으로 다시 실행할 때 원래 사용자를 넘겨받는다.
    # (승격 시 계정이 바뀌면 권한을 엉뚱한 사용자에게 주게 되므로)
    [string] $GrantUser
)

$ErrorActionPreference = 'Stop'

$RepoUrl     = 'https://github.com/studing-git/claude-session-widget.git'
$AppName     = 'Claude 사용량 위젯'
$InstallRoot = 'C:\Program Files\Devdragon'
$FolderName  = 'claude-session-widget'

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

function Test-Administrator {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# 해당 경로(없으면 존재하는 가장 가까운 상위 폴더)에 실제로 파일을 만들어 볼 수 있는지 확인한다.
# ACL은 상속·거부 규칙이 얽혀 있어 계산으로 판단하기 어렵기 때문에 직접 시도한다.
function Test-Writable([string] $Path) {
    $probe = $Path
    while ($probe -and -not (Test-Path -LiteralPath $probe)) {
        $parent = Split-Path -Parent $probe
        if ($parent -eq $probe) { break }
        $probe = $parent
    }
    if (-not $probe -or -not (Test-Path -LiteralPath $probe)) { return $false }

    $testFile = Join-Path $probe ('.write-test-' + [Guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllText($testFile, 'x')
        Remove-Item -LiteralPath $testFile -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

# 관리자 권한으로 이 스크립트를 다시 실행한다. 성공하면 현재 프로세스는 종료해야 한다.
function Invoke-SelfElevate([string] $TargetPath) {
    if (-not $PSCommandPath) {
        Write-Note '관리자 권한이 필요하지만, 파이프로 실행된 스크립트는 자동으로 승격할 수 없습니다.'
        Write-Note 'PowerShell을 "관리자 권한으로 실행"한 뒤 다시 시도해 주세요.'
        return $false
    }

    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'),
                 '-InstallPath', ('"' + $TargetPath + '"'),
                 '-GrantUser',   ('"' + $currentUser + '"'))
    if ($NoShortcut) { $argList += '-NoShortcut' }
    if ($Yes)        { $argList += '-Yes' }

    try {
        Start-Process -FilePath (Get-PowerShellExe) -ArgumentList $argList -Verb RunAs | Out-Null
        return $true
    } catch {
        Write-Note "관리자 권한 요청이 취소되었습니다: $($_.Exception.Message)"
        return $false
    }
}

# Program Files처럼 보호된 위치에 설치하면 위젯이 자기 폴더에 git pull을 할 수 없어
# 자동 업데이트가 동작하지 않는다. 설치 폴더에 한해 현재 사용자에게 수정 권한을 준다.
function Grant-UpdatePermission([string] $TargetDir, [string] $User) {
    $user = if ($User) { $User } else { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
    $acl  = Get-Acl -LiteralPath $TargetDir
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $user, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $TargetDir -AclObject $acl
    return $user
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
    $default = "$InstallRoot\$FolderName"
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

# Program Files 등 보호된 위치는 관리자 권한이 필요하다
if (-not (Test-Writable $InstallPath)) {
    Write-Note '이 경로에 쓰려면 관리자 권한이 필요합니다.'
    if (Test-Administrator) {
        throw "관리자 권한으로 실행 중인데도 쓸 수 없습니다: $InstallPath"
    }
    if (-not (Confirm-Step '관리자 권한으로 다시 실행할까요?' $true)) {
        throw '설치를 중단합니다. 다른 경로를 지정하거나 관리자 권한으로 실행해 주세요.'
    }
    if (Invoke-SelfElevate $InstallPath) {
        Write-Ok '관리자 권한 창에서 설치를 계속합니다.'
        return
    }
    throw '관리자 권한을 얻지 못해 설치를 중단합니다.'
}

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

# 관리자 권한으로 Program Files에 설치한 경우, 위젯을 일반 권한으로 실행하면
# 자기 폴더에 git pull을 할 수 없어 자동 업데이트가 실패한다.
Write-Step '자동 업데이트 권한'
if (Test-Administrator) {
    $user = if ($GrantUser) { $GrantUser } else { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
    Write-Note "$InstallPath 는 관리자만 쓸 수 있어, 일반 권한으로 실행하면 자동 업데이트가 실패합니다."
    Write-Note "이 폴더에 한해 $user 에게 수정 권한을 주면 위젯이 스스로 업데이트할 수 있습니다."
    if (Confirm-Step '쓰기 권한을 부여할까요?' $true) {
        $granted = Grant-UpdatePermission $InstallPath $user
        Write-Ok "$granted 에게 수정 권한 부여됨 — 자동 업데이트가 동작합니다"
    } else {
        Write-Note '건너뜀 — 업데이트하려면 런처를 관리자 권한으로 실행해야 합니다.'
    }
} else {
    Write-Ok '현재 사용자가 쓸 수 있는 위치입니다 — 자동 업데이트가 동작합니다'
}

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
