<#
.SYNOPSIS
  Sets Tatty up on this machine. The Tatty installer runs it after copying its files;
  it can also be run by hand to repair an install (it skips what is already done).

.DESCRIPTION
  1. Prerequisites: Git for Windows (Git Bash), Python 3, the WebView2 runtime (winget).
  2. The LLM tools you chose: Claude Code and/or GitHub Copilot CLI, and their sign-in.
  3. The TT toolbox and Tatty, as Claude Code plugins, from their marketplaces.
  4. Copilot's link to the toolbox (the toolbox's `llms.sh connect copilot`).
  5. Tatty's shortcuts, and your first project in the Hub.

  Every step is safe to repeat. -DryRun prints what it would do and changes nothing.
  The log is %LOCALAPPDATA%\Tatty\setup.log.
#>
[CmdletBinding()]
param(
    [string]$Llm = 'claude',
    [string]$Disciplines = 'engineering',
    [string]$ProjectName = '',
    [string]$ProjectRoot = '',
    [string]$ProjectRepo = '',
    [switch]$SkipSignIn,
    [switch]$DryRun,
    [switch]$NoLaunch,
    [string]$LogFile = ''
)
$ErrorActionPreference = 'Stop'

# powershell -File passes a list as one comma-separated string
$choicesFile = Join-Path (Join-Path $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }) 'Tatty') 'setup-choices.json'
if (-not $PSBoundParameters.ContainsKey('Llm') -and -not $PSBoundParameters.ContainsKey('Disciplines') -and (Test-Path $choicesFile)) {
    # a repair run: the choices made at install
    try {
        $saved = Get-Content $choicesFile -Raw | ConvertFrom-Json
        $Llm = $saved.llm; $Disciplines = $saved.disciplines
    } catch { }
}
$LlmList = @($Llm -split '[,;\s]+' | Where-Object { $_ -in 'claude', 'copilot' })
if (-not $LlmList) { $LlmList = @('claude') }
$DisciplineList = @($Disciplines -split '[,;\s]+' | Where-Object { $_ -in 'engineering', 'design', 'production' })

$ToolboxMarket = 'TimLewisDev/Tims-AI-Toolbox'
$ToolboxName = 'tims-ai-toolbox'
$TattyMarket = 'TimLewisDev/Tims-AI-Companion'
$TattyName = 'tims-ai-companion'

$localApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
$appDir = Join-Path $localApp 'Tatty'
if (-not $LogFile) { $LogFile = Join-Path $appDir 'setup.log' }
$configDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
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
    $extra = @("$HOME\.local\bin", "$localApp\Microsoft\WinGet\Links") -join ';'
    $env:Path = "$machine;$user;$extra;$env:Path"
}

function Have([string]$exe) { [bool](Get-Command $exe -ErrorAction SilentlyContinue) }

# Run an external program; in a dry run only say so. Returns its exit code.
function Run([string]$exe, [string[]]$arguments) {
    $shown = "$exe $($arguments -join ' ')"
    if ($DryRun) { Log "would run: $shown"; return 0 }
    Log "running: $shown"
    & $exe @arguments 2>&1 | ForEach-Object { Add-Content -Path $LogFile -Value "    $_" -Encoding UTF8; Write-Host "    $_" }
    return $LASTEXITCODE
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

# Where Claude Code put an installed plugin (its installed_plugins.json).
function Plugin-Path([string]$id) {
    $f = Join-Path $configDir 'plugins\installed_plugins.json'
    if (-not (Test-Path $f)) { return $null }
    try {
        $entries = (Get-Content $f -Raw | ConvertFrom-Json).plugins.$id
        foreach ($e in @($entries)) { if ($e.installPath -and (Test-Path $e.installPath)) { return $e.installPath } }
    } catch { }
    return $null
}

function Claude-Plugin-Install([string]$plugin, [string]$market) {
    if (-not $DryRun -and (Plugin-Path "$plugin@$market")) { Log "$plugin@$market is already installed"; return }
    $code = Run 'claude' @('plugin', 'install', "$plugin@$market", '--scope', 'user')
    if ($code -ne 0) { throw "claude plugin install $plugin@$market failed (exit $code)" }
}

Log "Tatty setup, $(Get-Date -Format 'u')$(if ($DryRun) { ' (dry run)' })"
Log "LLMs: $($LlmList -join ', '); toolbox: core $($DisciplineList -join ', ')"
if (-not $DryRun) {
    New-Item -ItemType Directory $appDir -Force | Out-Null
    @{ llm = ($LlmList -join ','); disciplines = ($DisciplineList -join ',') } | ConvertTo-Json | Set-Content -Path $choicesFile -Encoding UTF8
}
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

# Tatty and the toolbox are Claude Code plugins, so Claude Code hosts the
# workflow whichever LLMs were chosen to work in.
Step 'Claude Code' {
    if (Have 'claude') { Log 'Claude Code is installed' }
    else { Winget-Install 'Anthropic.ClaudeCode' 'Claude Code' }
}

if (($LlmList -contains 'claude') -and -not $SkipSignIn) {
    Step 'Claude Code sign-in' {
        if ($DryRun) { Log 'would check `claude auth status`, and run `claude auth login` when not signed in'; return }
        if (-not (Have 'claude')) { throw 'Claude Code is not installed, so it cannot sign in' }
        & claude auth status *> $null
        if ($LASTEXITCODE -eq 0) { Log 'Claude Code is signed in'; return }
        Log 'Signing in to Claude Code: a browser window opens.'
        $code = Run 'claude' @('auth', 'login')
        & claude auth status *> $null
        if ($LASTEXITCODE -ne 0) { throw "Claude Code isn't signed in yet (exit $code). Run `claude auth login` yourself, then run this setup again." }
    }
}

if ($LlmList -contains 'copilot') {
    Step 'GitHub Copilot CLI' {
        if (Have 'copilot') { Log 'Copilot CLI is installed' }
        else { Winget-Install 'GitHub.Copilot' 'GitHub Copilot CLI' }
    }
    if (-not $SkipSignIn) {
        Step 'Copilot sign-in' {
            $state = Join-Path $appDir 'copilot-signin.done'
            if (Test-Path $state) { Log 'Copilot sign-in was done before (delete copilot-signin.done to repeat it)'; return }
            if ($DryRun) { Log 'would run `copilot login`'; return }
            if (-not (Have 'copilot')) { throw 'Copilot CLI is not installed, so it cannot sign in' }
            Log 'Signing in to GitHub Copilot: a browser window opens.'
            $code = Run 'copilot' @('login')
            if ($code -ne 0) { throw "copilot login failed (exit $code). Run `copilot login` yourself later." }
            Set-Content -Path $state -Value (Get-Date -Format 's')
        }
    }
}

Step 'The TT toolbox and Tatty' {
    if (-not $DryRun -and -not (Have 'claude')) { throw 'Claude Code is not available, so the plugins cannot be installed' }
    foreach ($m in @($ToolboxMarket, $TattyMarket)) {
        $code = Run 'claude' @('plugin', 'marketplace', 'add', $m)  # adding a known marketplace is harmless
        if ($code -ne 0) { Log "marketplace ${m}: claude said exit $code (it may already be added)" 'WARN' }
    }
    $plugins = @('core') + $DisciplineList
    foreach ($p in $plugins) { Claude-Plugin-Install $p $ToolboxName }
    Claude-Plugin-Install 'tatty' $TattyName
}

if ($LlmList -contains 'copilot') {
    Step 'Link Copilot to the toolbox' {
        if ($DryRun) { Log "would run the toolbox's llms.sh: connect copilot"; return }
        $core = Plugin-Path "core@$ToolboxName"
        $script = if ($core) { Join-Path $core 'skills\tt-connections\scripts\llms.sh' } else { $null }
        $bash = Find-GitBash
        if (-not $script -or -not (Test-Path $script)) { throw "the toolbox's llms.sh was not found (is core installed?)" }
        if (-not $bash) { throw 'Git Bash was not found' }
        $code = Run $bash @((To-Posix $script), 'connect', 'copilot')
        if ($code -ne 0) { throw "llms.sh connect copilot failed (exit $code)" }
    }
}

Step 'Tatty shortcuts' {
    if ($DryRun) { Log 'would run tatty.sh install (the Desktop and Start menu shortcuts)'; return }
    $plugin = Plugin-Path "tatty@$TattyName"
    $bash = Find-GitBash
    if (-not $plugin) { throw 'the Tatty plugin was not found' }
    if (-not $bash) { throw 'Git Bash was not found' }
    $code = Run $bash @((To-Posix (Join-Path $plugin 'scripts\tatty.sh')), 'install')
    if ($code -ne 0) { throw "tatty.sh install failed (exit $code)" }
}

Step 'Your first project' {
    if (-not $ProjectName -and -not $ProjectRoot) { Log 'no first project asked for; make one in the Hub'; return }
    if ($DryRun) { Log "would add the project '$ProjectName' to the Hub"; return }
    $plugin = Plugin-Path "tatty@$TattyName"
    $bash = Find-GitBash
    if (-not $plugin -or -not $bash) { throw 'Tatty or Git Bash was not found' }
    $tatty = To-Posix (Join-Path $plugin 'scripts\tatty.sh')
    $root = if ($ProjectRoot) { $ProjectRoot } else { Join-Path (Join-Path $HOME 'Tatty') $ProjectName }
    $existing = (& $bash $tatty hub list 2>$null | Out-String).Replace('\', '/')
    if ($existing.ToLower().Contains((To-Posix $root).ToLower())) { Log 'that project is already in the Hub'; return }
    $a = @($tatty, 'hub', 'add', '--name', $ProjectName, '--root', (To-Posix $root))
    if ($ProjectRepo) { $a += @('--repo', (To-Posix $ProjectRepo)) }
    $code = Run $bash $a
    if ($code -ne 0) { throw "tatty.sh hub add failed (exit $code)" }
}

Log ''
if ($script:failed.Count) {
    Log "Setup finished, but these steps need attention: $($script:failed -join '; ')" 'WARN'
    Log "Details: $LogFile"
    exit 1
}
Log 'Setup finished.'
if (-not $NoLaunch -and -not $DryRun) {
    $exe = Join-Path $appDir 'launcher\bin\Tatty.exe'
    if (Test-Path $exe) { Start-Process $exe }
}
exit 0
