@echo off
setlocal EnableExtensions

rem Updates an existing Alliance Tracker clone to the newest origin/main without
rem overwriting tracked local edits.

cd /d "%~dp0.."

echo.
echo [SYNC] Checking Git...

set "GIT_CMD="
where git >nul 2>nul
if %errorlevel%==0 set "GIT_CMD=git"

if not defined GIT_CMD (
  for /f "delims=" %%G in ('dir /b /s /a-d "%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" 2^>nul') do set "GIT_CMD=%%G"
)

if not defined GIT_CMD (
  echo [ERROR] Git was not found.
  echo Install Git for Windows, or install GitHub Desktop and restart this script.
  exit /b 1
)

"%GIT_CMD%" rev-parse --is-inside-work-tree >nul 2>nul
if not %errorlevel%==0 (
  echo [ERROR] This folder is not a Git clone.
  echo Clone YungZanji/alliance-tracker with GitHub Desktop first.
  exit /b 1
)

for /f "delims=" %%B in ('"%GIT_CMD%" branch --show-current') do set "CURRENT_BRANCH=%%B"
if /I not "%CURRENT_BRANCH%"=="main" (
  echo [ERROR] This clone is currently on branch "%CURRENT_BRANCH%".
  echo Switch to main in GitHub Desktop, then run this again.
  exit /b 1
)

"%GIT_CMD%" diff --quiet
if not %errorlevel%==0 goto :dirty
"%GIT_CMD%" diff --cached --quiet
if not %errorlevel%==0 goto :dirty

echo [SYNC] Fetching origin/main...
"%GIT_CMD%" fetch origin main
if not %errorlevel%==0 goto :failed

echo [SYNC] Updating local main...
"%GIT_CMD%" pull --ff-only origin main
if not %errorlevel%==0 goto :failed

for /f "delims=" %%H in ('"%GIT_CMD%" rev-parse --short HEAD') do set "CURRENT_COMMIT=%%H"
echo [SYNC] Alliance Tracker is current at %CURRENT_COMMIT%.
exit /b 0

:dirty
echo.
echo [ERROR] You have tracked local changes in this clone.
echo I stopped instead of overwriting your work.
echo Commit, discard, or stash those changes in GitHub Desktop and try again.
exit /b 2

:failed
echo.
echo [ERROR] Git could not update this clone.
echo Open GitHub Desktop, make sure you are signed in, then try Fetch origin once.
exit /b 3
