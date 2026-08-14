@echo off
setlocal EnableExtensions
cd /d "%~dp0\desktop"

set "PYTHON_CMD="
py -3.14 -c "import struct; raise SystemExit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=py -3.14"
if not defined PYTHON_CMD py -3.13 -c "import struct; raise SystemExit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=py -3.13"
if not defined PYTHON_CMD py -3.12 -c "import struct; raise SystemExit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=py -3.12"
if not defined PYTHON_CMD py -3.11 -c "import struct; raise SystemExit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>nul && set "PYTHON_CMD=py -3.11"
if not defined PYTHON_CMD (
  echo ERROR: Install 64-bit Python 3.11-3.14 first.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" %PYTHON_CMD% -m venv .venv || exit /b 1
".venv\Scripts\python.exe" -m pip install -r requirements.txt >nul || exit /b 1
".venv\Scripts\python.exe" main.py
