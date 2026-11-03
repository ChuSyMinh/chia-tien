@echo off
chcp 65001 >nul
:: Cai dat: mo firewall cong 3000 (mang LAN), tu khoi dong cung Windows, chay server
net session >nul 2>&1
if errorlevel 1 (
  echo Dang xin quyen Administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
if not exist data mkdir data
echo [1/4] Kiem tra Node.js...
where node >nul 2>nul || winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul || (echo [x] Chua cai duoc Node.js - tai tai https://nodejs.org & pause & exit /b 1)
echo [2/4] Mo firewall cong 3000 cho mang Private/Domain...
netsh advfirewall firewall delete rule name="Chia Tien Chung" >nul 2>&1
netsh advfirewall firewall add rule name="Chia Tien Chung" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
echo [3/4] Tao loi tat tu khoi dong cung Windows...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Chia Tien Chung.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0run-hidden.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo [4/4] Khoi dong server...
call "%~dp0stop.bat" >nul 2>&1
wscript.exe "%~dp0run-hidden.vbs"
timeout /t 3 >nul
start "" http://localhost:3000
echo.
echo ===== XONG =====
echo Mo tren may nay:  http://localhost:3000
echo Nguoi khac trong cung wifi mo bang dia chi IP cua may nay:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http:/%%a:3000
echo Nhat ky server: data\server.log
echo.
pause
