@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. See README.md.
  pause
  exit /b 1
)
if not exist "node_modules\xlsx" (
  echo Dependencies are missing. Run: npm install
  pause
  exit /b 1
)
if not exist "private-key-path.txt" (
  echo Private key path is not configured. See README.md.
  pause
  exit /b 1
)
set /p "KEY_FILE="<"private-key-path.txt"
if not exist "%KEY_FILE%" (
  echo Private Firebase key file was not found. See README.md.
  pause
  exit /b 1
)
if "%~1"=="" (
  set /p "XLSX=Excel file path: "
) else (
  set "XLSX=%~1"
)
if not defined XLSX exit /b 2
set "XLSX=%XLSX:"=%"
if not exist "%XLSX%" (
  echo Excel file not found: "%XLSX%"
  pause
  exit /b 2
)
node updater.cjs --preview "%XLSX%" --key "%KEY_FILE%"
if errorlevel 1 (
  echo Preview failed. Nothing was changed.
  pause
  exit /b 1
)
choice /C YN /M "Apply this preview now"
if errorlevel 2 exit /b 0
node updater.cjs --apply "%XLSX%" --key "%KEY_FILE%"
pause
