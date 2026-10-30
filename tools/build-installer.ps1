<#
.SYNOPSIS
  Builds Tatty's Windows installer: dist\Tatty-Setup-<version>.exe

.DESCRIPTION
  1. Publishes the tray companion and the launcher as self-contained single-file
     win-x64 exes (so the person installing needs no .NET), into dist\prebuilt.
  2. Compiles installer\Tatty.iss with Inno Setup (ISCC.exe).

  Needs the .NET 9 SDK and Inno Setup 6 (winget install JRSoftware.InnoSetup).
  -SkipPublish reuses dist\prebuilt; -SkipInstaller stops after the publish.
#>
param(
    [switch]$SkipPublish,
    [switch]$SkipInstaller
)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'plugins\tatty\app'
$icon = Join-Path $repo 'plugins\tatty\assets\tatty.ico'
$dist = Join-Path $repo 'dist'
$prebuilt = Join-Path $dist 'prebuilt'
$version = (Get-Content (Join-Path $repo 'plugins\tatty\.claude-plugin\plugin.json') -Raw | ConvertFrom-Json).version

function Publish-Exe($sources, $name) {
    $work = Join-Path ([IO.Path]::GetTempPath()) "tatty-publish-$name"
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory $work | Out-Null
    Get-ChildItem $sources -File | Where-Object { $_.Extension -in '.cs', '.xaml', '.csproj', '.manifest' } | Copy-Item -Destination $work
    Copy-Item $icon $work
    Write-Host "publishing $name ..."
    & dotnet publish $work -c Release -r win-x64 --self-contained true --nologo -v q `
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
        -p:DebugType=none -o (Join-Path $work 'out')
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $name" }
    $exe = Join-Path $work "out\$name.exe"
    if (-not (Test-Path $exe)) { throw "$exe was not produced" }
    Copy-Item $exe $prebuilt -Force
    Remove-Item $work -Recurse -Force
}

if (-not $SkipPublish) {
    Remove-Item $prebuilt -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory $prebuilt -Force | Out-Null
    Publish-Exe (Join-Path $app 'companion') 'TtCompanion'
    Publish-Exe (Join-Path $app 'launcher') 'Tatty'
}
foreach ($f in 'TtCompanion.exe', 'Tatty.exe') {
    if (-not (Test-Path (Join-Path $prebuilt $f))) { throw "dist\prebuilt\$f is missing (run without -SkipPublish)" }
}
if ($SkipInstaller) { return }

$iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
    $iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw 'Inno Setup (ISCC.exe) is not installed: winget install JRSoftware.InnoSetup' }

Write-Host "compiling the installer ($version) ..."
& $iscc "/DAppVersion=$version" "/DRepoDir=$repo" "/DOutputDir=$dist" (Join-Path $repo 'installer\Tatty.iss')
if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }
Write-Host "built $dist\Tatty-Setup-$version.exe"
