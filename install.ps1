# Latentry on Windows: installs the web UI, then opens its setup page, which
# installs the generation engine for your GPU and downloads a model.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Needs Node.js 22.12 or newer (https://nodejs.org, or: winget install OpenJS.NodeJS.LTS).
# Afterwards, start Latentry again with: npm start

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { '3000' }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js is not installed. Install it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this again.' -ForegroundColor Red
  exit 1
}
$version = [version]((node --version).TrimStart('v'))
if ($version -lt [version]'22.12.0') {
  Write-Host "Node.js $version is too old; Latentry needs 22.12 or newer." -ForegroundColor Red
  exit 1
}

Write-Host '== Installing the web UI' -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }

Write-Host '== Building' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "== Starting on http://localhost:$port (setup opens in your browser)" -ForegroundColor Cyan
Start-Job -ScriptBlock {
  param($url)
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 | Out-Null; Start-Process $url; return } catch { Start-Sleep -Seconds 1 }
  }
} -ArgumentList "http://localhost:$port/setup" | Out-Null
npm start -- -p $port
