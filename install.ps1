# Latentry on Windows: installs and starts the web UI. Its setup page
# (http://localhost:3000/setup) then installs the generation engine for your
# GPU and downloads a model.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoEngine
#     (only use servers you already run: A1111, Forge, ...)
#
# Needs Node.js 22.19 or newer (https://nodejs.org, or: winget install OpenJS.NodeJS.LTS).
# Afterwards, start Latentry again with: npm start
# It listens on this computer only; set LATENTRY_HOST=0.0.0.0 in .env.local
# to use it from other devices on your network.

param([switch]$NoEngine)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { '3000' }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js is not installed. Install it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this again.' -ForegroundColor Red
  exit 1
}
$version = [version]((node --version).TrimStart('v'))
if ($version -lt [version]'22.19.0') {
  Write-Host "Node.js $version is too old; Latentry needs 22.19 or newer." -ForegroundColor Red
  exit 1
}

node scripts/logo.mjs

Write-Host '== Installing the web UI' -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path .env.local)) {
  Copy-Item .env.example .env.local
  if ($NoEngine) { Add-Content .env.local "`n# Set by install.ps1 -NoEngine`nLATENTRY_ENGINE=off" }
}

Write-Host '== Building' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '== Starting' -ForegroundColor Cyan
Write-Host ''
if ($NoEngine) {
  Write-Host "   When it says Ready, open http://localhost:$port/settings in your browser" -ForegroundColor Green
  Write-Host '   and add your server under Backends.' -ForegroundColor Green
} else {
  Write-Host "   When it says Ready, open http://localhost:$port/setup in your browser." -ForegroundColor Green
}
Write-Host '   (Ctrl+C stops Latentry; start it again later with: npm start)'
Write-Host ''
$env:LATENTRY_NO_LOGO = '1'  # shown above already
npm start -- -p $port
