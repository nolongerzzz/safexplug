@echo off
rem SOLO-SYNC Node+Mine: start from the app folder on Windows.
rem Asks for administrator rights once, so the miner can use huge pages and the MSR boost (faster hashing).
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0.."
if not exist node_modules\electron\dist\electron.exe (
  echo First run: installing the app. This needs Node.js from nodejs.org.
  call npm install
)
start "" node_modules\electron\dist\electron.exe . 
