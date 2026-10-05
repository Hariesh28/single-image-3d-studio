$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "== Single Image 3D Studio installer ==" -ForegroundColor Cyan

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw "Python launcher 'py' was not found. Install Python 3.11 from python.org and try again."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 22+ and try again."
}

if (-not (Test-Path .venv)) {
  py -3.11 -m venv .venv
}
.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
.\.venv\Scripts\python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu130
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

Push-Location frontend
npm install
Pop-Location

New-Item -ItemType Directory -Force models,vendor,data\scenes,data\cache | Out-Null

Write-Host "" 
Write-Host "Installation complete." -ForegroundColor Green
Write-Host "Run .\run-backend.ps1 and .\run-frontend.ps1 in two terminals." -ForegroundColor Yellow
