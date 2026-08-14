@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
set "EXE=%ROOT%\desktop\dist\AllianceTracker.exe"
if not exist "%EXE%" exit /b 1

tasklist /FO CSV /NH 2>nul | findstr /I "AllianceTracker" >nul
if not errorlevel 1 exit /b 3

"%EXE%" --headless --run-today --exit-after --close-game --timeout-minutes 12
exit /b %ERRORLEVEL%
