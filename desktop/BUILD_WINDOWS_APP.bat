@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Alliance Tracker 1.7.6 - Local Builder

echo ============================================================
echo   Alliance Tracker 1.7.6 - Local Builder
echo ============================================================
echo.

set "PYTHON_CMD="
py -3.14 -c "import struct; raise SystemExit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=py -3.14"
if not defined PYTHON_CMD py -3.13 -c "import struct; raise SystemExit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=py -3.13"
if not defined PYTHON_CMD py -3.12 -c "import struct; raise SystemExit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=py -3.12"
if not defined PYTHON_CMD py -3.11 -c "import struct; raise SystemExit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=py -3.11"
if not defined PYTHON_CMD python -c "import struct,sys; raise SystemExit(0 if (3,11) <= sys.version_info[:2] < (3,15) and struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
  echo ERROR: A compatible 64-bit Python runtime was not found.
  echo Install 64-bit Python 3.11-3.14 and run this file again.
  pause
  exit /b 1
)

echo Using %PYTHON_CMD%
%PYTHON_CMD% --version

echo.
echo [1/8] Creating/updating build environment...
if not exist ".venv\Scripts\python.exe" %PYTHON_CMD% -m venv .venv || goto :failed
".venv\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel || goto :failed

echo.
echo [2/8] Installing dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :failed
".venv\Scripts\python.exe" -m pip install --upgrade pyinstaller pillow || goto :failed

echo.
echo [3/8] Compiling application modules...
".venv\Scripts\python.exe" -m py_compile main.py verify_build.py app_current.py app_v174_runtime_fix.py app_v174_runtime.py app_v172_runtime.py roster_export.py app_v171_runtime.py app_v170_runtime.py app_v162_runtime.py app_v161_runtime.py app_v160_runtime.py app_v150_runtime.py app_v143_runtime.py app_v142_import_runtime.py app_v142_runtime.py app_v141_runtime.py app_v140_runtime_fix.py app_v140_runtime.py app_v131_runtime.py app_v130_runtime.py app_v126_runtime.py app_v125_runtime.py app_v124_runtime_fix.py app_v124_runtime.py app_v123_runtime.py app_v122_runtime.py app_v120_runtime.py app_v120.py app_v110_runtime.py app_v110.py app_v100.py app_v090.py app_v080.py app_v070.py app_v061.py app_v060.py app.py startup.py capture.py cloud.py storage.py normalizers.py branding.py utils.py || goto :failed

echo.
echo [4/8] Running build checks...
".venv\Scripts\python.exe" verify_build.py || goto :failed

echo.
echo [5/8] Preparing desktop assets...
".venv\Scripts\python.exe" fetch_brand_font.py || goto :failed
".venv\Scripts\python.exe" make_icon.py || goto :failed

echo.
echo [6/8] Building one-file Windows executable...
".venv\Scripts\pyinstaller.exe" --noconfirm --clean AllianceTracker.spec || goto :failed
if not exist "dist\AllianceTracker.exe" goto :failed

echo.
echo [7/8] Creating versioned copy...
copy /Y "dist\AllianceTracker.exe" "dist\AllianceTracker_1.7.6.exe" >nul || goto :failed

echo.
echo [8/8] Build complete.
echo ============================================================
echo BUILD COMPLETE
echo ============================================================
echo.
echo Executable:
echo %CD%\dist\AllianceTracker.exe
echo.
start "" "%CD%\dist"
pause
exit /b 0

:failed
echo.
echo ============================================================
echo BUILD FAILED
echo ============================================================
echo Review the error printed immediately above this message.
pause
exit /b 1
