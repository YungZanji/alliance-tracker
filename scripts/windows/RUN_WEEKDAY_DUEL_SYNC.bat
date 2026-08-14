@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"

set "EXE=%ROOT%\desktop\dist\AllianceTracker.exe"
if not exist "%EXE%" (
  echo ERROR: Build the current Alliance Tracker executable first.
  echo Run BUILD_WINDOWS_APP.bat from the repository root.
  echo.
  pause
  exit /b 1
)

tasklist /FO CSV /NH 2>nul | findstr /I "AllianceTracker" >nul
if not errorlevel 1 (
  echo SAFETY STOP: Another Alliance Tracker executable is already running.
  echo Close it and run this file again.
  echo.
  pause
  exit /b 3
)

"%EXE%" --headless --run-today --exit-after --close-game --timeout-minutes 12
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" exit /b 0

echo.
echo ============================================================
echo   WEEKDAY DUEL SYNC NEEDS ATTENTION
echo ============================================================
echo Exit code: %RC%
echo Last Z was left open because cleanup is success-only.
echo Details:
echo   %%LOCALAPPDATA%%\AllianceTracker\background-runs\latest.json
echo.
pause
exit /b %RC%
