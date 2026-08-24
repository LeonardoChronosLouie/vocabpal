@echo off
chcp 65001 >nul
title VocabPal 背单词助手
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装: https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在启动 VocabPal 背单词助手...
echo 启动后请在浏览器打开: http://127.0.0.1:3789
echo 按 Ctrl+C 可退出。
node server.js
pause
