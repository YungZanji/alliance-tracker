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
  echo Use the existing Tracker window for the Sunday manual run.
  echo.
  pause
  exit /b 3
)

rem Sunday stays manual until a stable Sunday route is trained and tested.
start "Alliance Tracker Sunday Manual" "%EXE%"
exit /b 0
