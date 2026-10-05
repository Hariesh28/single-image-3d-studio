$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path .venv\Scripts\python.exe)) {
  throw "Python environment not found. Run .\install.ps1 first."
}
Write-Host "Downloading both Depth Anything V2 Metric Large checkpoints and pinned source..." -ForegroundColor Cyan
& .\.venv\Scripts\python.exe scripts\bootstrap_models.py
