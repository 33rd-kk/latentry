# Latentry on Windows: installs the web UI, then opens its setup page, which
# installs the generation engine for your GPU and downloads a model.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Needs Node.js 22.12 or newer (https://nodejs.org, or: winget install OpenJS.NodeJS.LTS).
# Afterwards, start Latentry again with: npm start
# It listens on this computer only; set LATENTRY_HOST=0.0.0.0 in .env.local
# to use it from other devices on your network.

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

node scripts/logo.mjs

Write-Host '== Installing the web UI' -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }

Write-Host '== Building' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "== Starting on http://localhost:$port (setup opens in your browser)" -ForegroundColor Cyan
# The server runs in this console (Ctrl+C stops it); this script waits for it
# to answer, opens the setup page, then waits for the server to end. (A
# background job cannot reliably open a browser, so it is done from here.)
# npm.cmd, not npm: PowerShell may resolve "npm" to npm.ps1, which
# Start-Process would open in an editor.
$npm = Join-Path (Split-Path $node.Source) 'npm.cmd'
if (-not (Test-Path $npm)) { $npm = 'npm.cmd' }
$env:LATENTRY_NO_LOGO = '1'  # shown above already
$server = Start-Process -FilePath $npm -ArgumentList @('start', '--', '-p', $port) -NoNewWindow -PassThru
$url = "http://localhost:$port/setup"
for ($i = 0; $i -lt 90 -and -not $server.HasExited; $i++) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 | Out-Null
    Start-Process $url
    break
  } catch { Start-Sleep -Seconds 1 }
}
$server.WaitForExit()
exit $server.ExitCode
