@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "REPO=https://github.com/ChuSyMinh/chia-tien.git"
where git >nul 2>nul || set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
where git >nul 2>nul || goto nogit

rem Lan dau: xoa lich su git cu truoc khi day len
if not exist .git\ct-clean if exist .git rmdir /s /q .git
if exist .git goto hasgit
git init -b main
git config user.name "ChuSyMinh"
git config user.email "ChuSyMinh@users.noreply.github.com"
git remote add origin %REPO%
:hasgit
git remote set-url origin %REPO%
echo ok> .git\ct-clean
git add -A
git commit -m "Cap nhat app chia tien chung" || echo Khong co thay doi moi de commit
echo.
echo Dang day len %REPO% ...
echo Lan dau se hien cua so dang nhap GitHub - chon "Sign in with your browser"
git push -u origin main
if errorlevel 1 goto fail
echo.
echo ===== XONG: https://github.com/ChuSyMinh/chia-tien =====
pause
exit /b 0

:fail
echo.
echo [x] Day len that bai - chup man hinh cua so nay gui Claude.
pause
exit /b 1

:nogit
echo [x] Khong tim thay Git.
pause
exit /b 1
