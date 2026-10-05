$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

$backendScript = Join-Path $PSScriptRoot 'run-backend.ps1'
$frontendScript = Join-Path $PSScriptRoot 'run-frontend.ps1'

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "     Single Image 3D Studio" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Check required files
if (-not (Test-Path ".venv\Scripts\python.exe"))
{
    Write-Host "ERROR: Python virtual environment not found." -ForegroundColor Red
    Write-Host "Run .\install.ps1 first." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path "frontend\node_modules"))
{
    Write-Host "ERROR: Frontend dependencies not found." -ForegroundColor Red
    Write-Host "Run .\install.ps1 first." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $backendScript))
{
    Write-Host "ERROR: run-backend.ps1 not found." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $frontendScript))
{
    Write-Host "ERROR: run-frontend.ps1 not found." -ForegroundColor Red
    exit 1
}

Write-Host "[1/3] Starting backend..." -ForegroundColor Yellow

Start-Process powershell.exe `
    -WorkingDirectory $PSScriptRoot `
    -ArgumentList @(
    '-NoExit'
    '-ExecutionPolicy', 'Bypass'
    '-File', "`"$backendScript`""
)

# Wait until backend is actually listening
Write-Host "      Waiting for backend..." -ForegroundColor DarkGray

$backendReady = $false

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1

    try
    {
        $response = Invoke-WebRequest `
            -Uri "http://127.0.0.1:8000/api/health" `
            -UseBasicParsing `
            -TimeoutSec 1 `
            -ErrorAction Stop

        if ($response.StatusCode -eq 200)
        {
            $backendReady = $true
            break
        }
    }
    catch
    {
        # Backend is still starting
    }
}

if ($backendReady)
{
    Write-Host "      Backend ready." -ForegroundColor Green
}
else
{
    Write-Host "      WARNING: Backend did not become ready within 30 seconds." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[2/3] Starting frontend..." -ForegroundColor Yellow

Start-Process powershell.exe `
    -WorkingDirectory (Join-Path $PSScriptRoot 'frontend') `
    -ArgumentList @(
    '-NoExit'
    '-ExecutionPolicy', 'Bypass'
    '-File', "`"$frontendScript`""
)

# Wait until Vite is available
Write-Host "      Waiting for frontend..." -ForegroundColor DarkGray

$frontendReady = $false

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1

    try
    {
        $response = Invoke-WebRequest `
            -Uri "http://127.0.0.1:5173" `
            -UseBasicParsing `
            -TimeoutSec 1 `
            -ErrorAction Stop

        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
        {
            $frontendReady = $true
            break
        }
    }
    catch
    {
        # Frontend is still starting
    }
}

if ($frontendReady)
{
    Write-Host "      Frontend ready." -ForegroundColor Green
}
else
{
    Write-Host "      WARNING: Frontend did not become ready within 30 seconds." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[3/3] Opening application..." -ForegroundColor Yellow

Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "        Single Image 3D Studio" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Frontend : http://localhost:5173" -ForegroundColor Green
Write-Host "Backend  : http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "API Docs : http://127.0.0.1:8000/docs" -ForegroundColor Green
Write-Host ""
Write-Host "Both services are running in separate windows." -ForegroundColor Cyan
Write-Host ""