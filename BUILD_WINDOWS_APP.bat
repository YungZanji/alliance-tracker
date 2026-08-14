@echo off
setlocal EnableExtensions
cd /d "%~dp0"
pushd desktop
call BUILD_WINDOWS_APP.bat
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
