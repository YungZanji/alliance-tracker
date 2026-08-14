@echo off
setlocal EnableExtensions
set "ROOT=%~dp0..\.."
set "EXE=%ROOT%\desktop\dist\AllianceTracker.exe"
set "WEEKDAY_RUNNER=%~dp0RUN_HEADLESS_SCHEDULED.bat"
set "SUNDAY_RUNNER=%~dp0RUN_SUNDAY_DUEL_SYNC.bat"
set "WEEKDAY_TASK=Alliance Tracker - Weekday Duel Sync"
set "SUNDAY_TASK=Alliance Tracker - Sunday Duel Manual"

if not exist "%EXE%" (
  echo ERROR: Build the current Alliance Tracker executable first.
  echo Run BUILD_WINDOWS_APP.bat from the repository root.
  pause
  exit /b 1
)

echo ============================================================
echo   Install Alliance Tracker Duel schedule
 echo ============================================================
echo.
echo Monday-Saturday uses the saved production route automatically.
echo Sunday stays manual until a stable Sunday route is trained and tested.
echo Both tasks require the Windows account to remain logged in.
echo.
set /p "WEEKDAY_TIME=Weekday automated run time, 24-hour HH:MM (example 03:30): "
if not defined WEEKDAY_TIME exit /b 1
set /p "SUNDAY_TIME=Sunday manual launcher time, 24-hour HH:MM (example 03:30): "
if not defined SUNDAY_TIME exit /b 1

schtasks /Create /TN "%WEEKDAY_TASK%" /SC WEEKLY /D MON,TUE,WED,THU,FRI,SAT /ST %WEEKDAY_TIME% /RL HIGHEST /IT /F /TR "cmd.exe /d /c \"\"%WEEKDAY_RUNNER%\"\""
if errorlevel 1 goto :failed
schtasks /Create /TN "%SUNDAY_TASK%" /SC WEEKLY /D SUN /ST %SUNDAY_TIME% /RL HIGHEST /IT /F /TR "cmd.exe /d /c \"\"%SUNDAY_RUNNER%\"\""
if errorlevel 1 goto :failed

echo.
echo Scheduled tasks created. Test RUN_WEEKDAY_DUEL_SYNC.bat once before relying on the schedule.
pause
exit /b 0

:failed
echo.
echo Failed to create one or more scheduled tasks.
echo Try running this installer as Administrator.
pause
exit /b 1
