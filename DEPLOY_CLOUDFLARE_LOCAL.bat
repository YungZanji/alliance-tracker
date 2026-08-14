@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Alliance Tracker - Local Cloudflare Deploy

echo ============================================================
echo   Alliance Tracker - Local Cloudflare Deploy
echo ============================================================
echo.
echo This deploys the current checkout to the production Cloudflare project.
echo A deployment log will be written to:
echo   %~dp0cloudflare-deploy.log
echo.

set "DEPLOY_SCRIPT=%~dp0scripts\deploy-cloudflare-local.ps1"
if not exist "%DEPLOY_SCRIPT%" (
  echo ERROR: Deployment script was not found:
  echo   %DEPLOY_SCRIPT%
  echo.
  pause
  exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell was not found.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%DEPLOY_SCRIPT%"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo Deployment finished successfully.
) else (
  echo Deployment returned error code %RC%.
  echo Open cloudflare-deploy.log for the full details.
)
echo.
pause
exit /b %RC%
