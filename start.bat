@echo off
chcp 65001 >nul
title Chia Tien Chung - server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Chua co Node.js. Dang cai Node.js LTS bang winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
  echo [x] Khong tim thay Node.js. Hay cai tu https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=3000
:loop
node "%~dp0server.js"
echo [!] Server dung lai, khoi dong lai sau 5 giay... (Ctrl+C de thoat)
timeout /t 5 >nul
goto loop
