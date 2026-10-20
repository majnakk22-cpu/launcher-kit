@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ============================================
echo   Сборка лаунчера в .exe (установщик + portable)
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установи версию LTS с https://nodejs.org и запусти этот файл снова.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 20 (
  echo Нужен Node.js 20 или новее, а установлен:
  node -v
  pause
  exit /b 1
)

echo [1/3] Установка зависимостей (первый раз - несколько минут)...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/3] Проверка тестами...
call npm test
if errorlevel 1 goto :fail

echo.
echo [3/3] Сборка установщика...
call npm run dist:win
if errorlevel 1 goto :fail

echo.
echo Готово! В папке dist:
dir /b dist\*.exe
echo.
echo  *-Setup-*.exe    - установщик, его и отправляй друзьям
echo  *-Portable-*.exe - запускается без установки
start "" "%~dp0dist"
pause
exit /b 0

:fail
echo.
echo Сборка не удалась - смотри сообщения выше.
pause
exit /b 1
