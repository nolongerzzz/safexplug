@echo off
rem SOLO-SYNC Wallet for Windows. Run from the app folder (or the bundle's Start-SOLO-SYNC-Wallet.cmd).
cd /d "%~dp0.."
set EV=33.4.11
if not exist node_modules\electron\dist\electron.exe (
  echo First run: downloading the app runtime ^(Electron %EV%, about 115 MB^)...
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing 'https://github.com/electron/electron/releases/download/v%EV%/electron-v%EV%-win32-x64.zip' -OutFile '%TEMP%\electron-win.zip'; Expand-Archive -Force '%TEMP%\electron-win.zip' 'node_modules\electron\dist'"
  if not exist node_modules\electron\dist\electron.exe ( echo Download failed. & pause & exit /b 1 )
)
start "" node_modules\electron\dist\electron.exe .
