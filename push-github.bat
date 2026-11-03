@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "REPO=https://github.com/ChuSyMinh/Chiatien.git"
where git >nul 2>nul || set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
where git >nul 2>nul || (echo [x] Khong tim thay Git. & pause & exit /b 1)

rem Lan dau: xoa lich su git cu (commit cu co chua mat khau admin) truoc khi day len
if not exist .git\ct-clean if exist .git rmdir /s /q .git
if not exist .git (
  git init -b main
  git config user.name "ChuSyMinh"
  git config user.email "ChuSyMinh@users.noreply.github.com"
  git remote add origin %REPO%
)
git remote set-url origin %REPO%
echo ok> .git\ct-clean
git add -A
git commit -m "Cap nhat app chia tien chung" || echo (Khong co thay doi moi de commit)
echo.
echo Dang day len %REPO% ...
echo (Lan dau se hien cua so dang nhap GitHub - chon "Sign in with your browser")
git push -u origin main
if errorlevel 1 (
  echo.
  echo [x] Day len that bai. Kiem tra: da tao repo "Chiatien" (trong, khong co README) tren GitHub chua?
) else (
  echo.
  echo ===== XONG: https://github.com/ChuSyMinh/Chiatien =====
)
pause
