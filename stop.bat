@echo off
:: Dung server Chia Tien Chung (vong lap start.bat va node server.js cua thu muc nay)
powershell -NoProfile -Command "$d='%~dp0'; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like ('*'+$d+'start.bat*')) -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like ('*'+$d+'server.js*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Da dung server.
