@echo off
title VibeSeek 重置工具

echo.
echo  ================  VibeSeek 重置工具  ================
echo.
echo  这个工具会清除 VibeSeek 的本地使用记录，让它像第一次打开一样：
echo    - 设置与首次引导（下次启动会重新弹出引导）
echo    - 所有对话、用量统计、节省记录
echo    - 已保存的 API Key（需要重新填）
echo    - 全局个性化记忆 .vibeseek\MEMORY.md、缓存与日志
echo.
echo  不会改动：项目代码、各项目内的 .vibeseek 记忆、导入的全局技能。
echo  此操作不可恢复。
echo.

set "ok="
set /p "ok=确定要重置吗？输入 Y 再回车继续，直接回车取消: "
if /i not "%ok%"=="Y" (
  echo  已取消，未做任何改动。
  echo.
  pause
  exit /b 0
)

echo.
echo  正在关闭 VibeSeek ...
taskkill /IM VibeSeek.exe /F >nul 2>&1
ping -n 3 127.0.0.1 >nul

echo  正在清理 ...
if exist "%APPDATA%\VibeSeek"  rd /s /q "%APPDATA%\VibeSeek"
if exist "%APPDATA%\@vibeseek" rd /s /q "%APPDATA%\@vibeseek"
if exist "%USERPROFILE%\.vibeseek\MEMORY.md" del /f /q "%USERPROFILE%\.vibeseek\MEMORY.md"

echo.
if exist "%APPDATA%\VibeSeek" (
  echo  [失败] 没能删除：%APPDATA%\VibeSeek
  echo  VibeSeek 可能还在运行（含右下角托盘图标）。请彻底退出后重试。
) else (
  echo  [完成] 已清空。下次启动 VibeSeek 就是全新状态。
)
echo.
pause
exit /b 0
