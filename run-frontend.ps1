$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Push-Location frontend
npm run dev
Pop-Location
