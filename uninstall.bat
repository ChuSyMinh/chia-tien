@echo off
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Chia Tien Chung.lnk" >nul 2>&1
netsh advfirewall firewall delete rule name="Chia Tien Chung" >nul 2>&1
call "%~dp0stop.bat"
echo Da go tu khoi dong + firewall. Du lieu van giu trong thu muc data\.
pause
