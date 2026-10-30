<#
.SYNOPSIS
  Checks the installer without installing anything: bootstrap.ps1 parses and its dry run
  plans the right steps, and Tatty.iss agrees with the plugin (paths, version).
  Runs in CI before the installer is built. Exit code 1 when anything fails.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$bootstrap = Join-Path $repo 'installer\bootstrap.ps1'
$iss = Get-Content (Join-Path $repo 'installer\Tatty.iss') -Raw
$server = Get-Content (Join-Path $repo 'plugins\tatty\app\server.py') -Raw
$pass = 0
$fail = 0

function Check([string]$name, [bool]$ok, [string]$detail = '') {
    if ($ok) { $script:pass++; Write-Host "  ok   $name" }
    else { $script:fail++; Write-Host "  FAIL $name $detail" -ForegroundColor Red }
}

Write-Host '# bootstrap.ps1'
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($bootstrap, [ref]$null, [ref]$errors)
Check 'parses' ($errors.Count -eq 0) ($errors | Out-String)

function Dry([string[]]$extra) {
    $log = Join-Path ([IO.Path]::GetTempPath()) "tatty-installer-test-$([guid]::NewGuid().ToString('N')).log"
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $bootstrap -DryRun -LogFile $log @extra 2>&1 | Out-String
    $code = $LASTEXITCODE
    $logged = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
    Remove-Item $log -ErrorAction SilentlyContinue
    return @{ out = $out; code = $code; log = $logged }
}

$r = Dry @('-Llm', 'claude,copilot', '-Disciplines', 'engineering,design', '-ProjectName', 'Demo')
Check 'dry run succeeds' ($r.code -eq 0) $r.out
Check 'dry run adds both marketplaces' (($r.out -match 'marketplace add TimLewisDev/Tims-AI-Toolbox') -and ($r.out -match 'marketplace add TimLewisDev/Tims-AI-Companion'))
Check 'dry run installs core, the chosen disciplines and tatty' (($r.out -match 'install core@tims-ai-toolbox') -and ($r.out -match 'install engineering@tims-ai-toolbox') -and ($r.out -match 'install design@tims-ai-toolbox') -and ($r.out -match 'install tatty@tims-ai-companion') -and ($r.out -notmatch 'install production@'))
Check 'dry run links Copilot to the toolbox' ($r.out -match 'llms\.sh: connect copilot')
Check 'dry run adds the first project' ($r.out -match "add the project 'Demo'")
Check 'dry run writes the log' ($r.log -match 'Setup finished')

$r = Dry @('-Llm', 'claude')
Check 'claude only: no Copilot steps' ($r.code -eq 0 -and $r.out -notmatch 'Copilot')
Check 'claude only: no first project asked for' ($r.out -match 'no first project asked for')

Write-Host '# Tatty.iss'
Check 'installs per user' ($iss -match 'PrivilegesRequired=lowest')
foreach ($rel in 'installer\bootstrap.ps1', 'plugins\tatty\assets\tatty.ico') {
    Check "$rel exists" (Test-Path (Join-Path $repo $rel))
}
Check 'puts the prebuilt exes where the plugin looks' (($iss -match [regex]::Escape('{localappdata}\Tatty\prebuilt')) -and ($server -match '"Tatty" / "prebuilt"'))
Check 'ships both exes' (($iss -match 'TtCompanion\.exe') -and ($iss -match 'Source: "[^"]*\\Tatty\.exe"'))
Check 'runs bootstrap.ps1' ($iss -match 'bootstrap\.ps1')
Check 'removes the shortcuts on uninstall' ($iss -match '--remove-shortcuts')

Write-Host '# build script and release'
$build = Get-Content (Join-Path $repo 'tools\build-installer.ps1') -Raw
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'tools\build-installer.ps1'), [ref]$null, [ref]$errors)
Check 'build-installer.ps1 parses' ($errors.Count -eq 0) ($errors | Out-String)
Check 'build-installer.ps1 passes the version to Inno Setup' ($build -match '/DAppVersion')
Check 'release workflow exists' (Test-Path (Join-Path $repo '.github\workflows\release-installer.yml'))

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
