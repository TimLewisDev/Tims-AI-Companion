<#
.SYNOPSIS
  Sets Tatty up on this machine. The Tatty installer runs it after copying its files;
  it can also be run by hand to repair an install (it skips what is already done).

.DESCRIPTION
  Installs only what Tatty needs to run. No LLM tool is needed yet: the Hub connects
  Claude Code, Copilot or Codex later, when you want the agentic features.
  1. Prerequisites: Git for Windows (Git Bash), Python 3, the WebView2 runtime (winget).
  2. The TT toolbox: cloned from GitHub into %LOCALAPPDATA%\Tatty\toolbox (updated when it is there).
  3. Tatty's shortcuts, running the copy of Tatty the installer put in %LOCALAPPDATA%\Tatty\plugin.

  Every step is safe to repeat. -DryRun prints what it would do and changes nothing.
  The log is %LOCALAPPDATA%\Tatty\setup.log.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$NoLaunch,
    [string]$LogFile = '',
    [string]$PluginDir = ''
)
$ErrorActionPreference = 'Stop'

$ToolboxRepo = 'https://github.com/TimLewisDev/Tims-AI-Toolbox.git'

$localApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
$appDir = Join-Path $localApp 'Tatty'
if (-not $LogFile) { $LogFile = Join-Path $appDir 'setup.log' }
if (-not $PluginDir) { $PluginDir = Join-Path $appDir 'plugin' }
$toolboxDir = Join-Path $appDir 'toolbox'
$script:failed = @()

function Log([string]$msg, [string]$level = 'INFO') {
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 's'), $level, $msg
    New-Item -ItemType Directory (Split-Path $LogFile) -Force -ErrorAction SilentlyContinue | Out-Null
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $msg
}

# A step that fails is logged and remembered; the rest of the setup still runs.
function Step([string]$name, [scriptblock]$body) {
    Log ''
    Log "== $name"
    try { & $body }
    catch {
        $script:failed += $name
        Log "FAILED: ${name}: $($_.Exception.Message)" 'ERROR'
    }
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $extra = @("$HOME\.local\bin", "$localApp\Microsoft\WinGet\Links", "$env:ProgramFiles\Git\cmd") -join ';'
    $env:Path = "$machine;$user;$extra;$env:Path"
}

function Have([string]$exe) { [bool](Get-Command $exe -ErrorAction SilentlyContinue) }

# Run an external program; in a dry run only say so. Returns its exit code.
function Run([string]$exe, [string[]]$arguments) {
    $shown = "$exe $($arguments -join ' ')"
    if ($DryRun) { Log "would run: $shown"; return 0 }
    Log "running: $shown"
    # a program's progress on stderr is not an error (and would stop the script under 'Stop')
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        & $exe @arguments 2>&1 | ForEach-Object { Add-Content -Path $LogFile -Value "    $_" -Encoding UTF8; Write-Host "    $_" }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    return $code
}

function Winget-Install([string]$id, [string]$what) {
    if ($DryRun) { Log "would run: winget install --id $id"; return }
    if (-not (Have 'winget')) { throw "$what is missing and winget isn't available. Install $what yourself, then run this again." }
    $code = Run 'winget' @('install', '--id', $id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements')
    Refresh-Path
    # 0 installed; -1978335189 already installed, nothing newer
    if ($code -ne 0 -and $code -ne -1978335189) { throw "winget couldn't install $what (exit $code)" }
}

function Find-Python {
    foreach ($name in 'python', 'python3', 'py') {
        $c = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $c -or $c.Source -like '*\WindowsApps\*') { continue }  # the Store's alias isn't a Python
        $v = & $c.Source --version 2>&1 | Out-String
        if ($v -match 'Python 3\.(\d+)' -and [int]$Matches[1] -ge 8) { return $c.Source }
    }
    return $null
}

function Find-GitBash {
    $git = Get-Command git -ErrorAction SilentlyContinue
    $roots = @()
    if ($git) { $roots += (Split-Path (Split-Path $git.Source)) }
    $roots += "$env:ProgramFiles\Git", "${env:ProgramFiles(x86)}\Git", "$localApp\Programs\Git"
    foreach ($r in $roots) {
        foreach ($rel in 'bin\bash.exe', 'usr\bin\bash.exe') {
            $p = Join-Path $r $rel
            if (Test-Path $p) { return $p }
        }
    }
    return $null
}

function Has-WebView2 {
    $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($k in "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$guid",
                   "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid",
                   "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$guid") {
        $v = (Get-ItemProperty $k -ErrorAction SilentlyContinue).pv
        if ($v -and $v -ne '0.0.0.0') { return $true }
    }
    return $false
}

function To-Posix([string]$p) { ($p -replace '\\', '/') }

Log "Tatty setup, $(Get-Date -Format 'u')$(if ($DryRun) { ' (dry run)' })"
if (-not $DryRun) { New-Item -ItemType Directory $appDir -Force | Out-Null }
Refresh-Path

Step 'Git for Windows' {
    if (Find-GitBash) { Log 'Git Bash is installed'; return }
    Winget-Install 'Git.Git' 'Git for Windows'
}

Step 'Python 3' {
    if (Find-Python) { Log 'Python 3 is installed'; return }
    Winget-Install 'Python.Python.3.12' 'Python 3'
}

Step 'WebView2 runtime' {
    if (Has-WebView2) { Log 'the WebView2 runtime is installed'; return }
    Winget-Install 'Microsoft.EdgeWebView2Runtime' 'the WebView2 runtime'
}

Step 'The TT toolbox' {
    if ($DryRun) {
        if (Test-Path (Join-Path $toolboxDir '.git')) { Log "would run: git -C $toolboxDir pull --ff-only" }
        else { Log "would run: git clone $ToolboxRepo $toolboxDir" }
        return
    }
    if (-not (Have 'git')) { throw 'Git is not available, so the toolbox cannot be fetched' }
    if (Test-Path (Join-Path $toolboxDir '.git')) {
        $code = Run 'git' @('-C', $toolboxDir, 'pull', '--ff-only', '--quiet')
        if ($code -ne 0) { Log "the toolbox could not be updated (exit $code); keeping the copy that is there" 'WARN' }
        return
    }
    if (Test-Path $toolboxDir) { throw "$toolboxDir exists but is not a git clone. Move it away, then run this again." }
    $code = Run 'git' @('clone', '--quiet', $ToolboxRepo, $toolboxDir)
    if ($code -ne 0) { throw "git clone of the toolbox failed (exit $code). Check your internet connection, then run Repair Tatty." }
}

Step 'Tatty shortcuts' {
    if ($DryRun) { Log "would run tatty.sh install --pin from $PluginDir (the Desktop and Start menu shortcuts)"; return }
    $script = Join-Path $PluginDir 'scripts\tatty.sh'
    $bash = Find-GitBash
    if (-not (Test-Path $script)) { throw "Tatty's files were not found at $PluginDir" }
    if (-not $bash) { throw 'Git Bash was not found' }
    # pinned: the launcher runs this copy, which only a new installer changes
    $code = Run $bash @((To-Posix $script), 'install', '--pin')
    if ($code -ne 0) { throw "tatty.sh install failed (exit $code)" }
}

Log ''
if ($script:failed.Count) {
    Log "Setup finished, but these steps need attention: $($script:failed -join '; ')" 'WARN'
    Log "Details: $LogFile"
    exit 1
}
Log 'Setup finished. Open Tatty, then connect an LLM and make your first project in the Hub.'
if (-not $NoLaunch -and -not $DryRun) {
    $exe = Join-Path $appDir 'launcher\bin\Tatty.exe'
    if (Test-Path $exe) { Start-Process $exe }
}
exit 0
