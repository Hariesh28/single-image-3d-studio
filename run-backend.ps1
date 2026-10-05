$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:S3D_CORS_ORIGIN = 'http://localhost:5173'
& .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
