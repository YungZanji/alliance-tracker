@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"

call tools\sync-main.bat
if not %errorlevel%==0 goto :failed
call RUN_FROM_SOURCE.bat
if not %errorlevel%==0 goto :failed
exit /b 0

:failed
echo.
echo Something stopped the update/run process. Read the message above.
pause
exit /b 1
