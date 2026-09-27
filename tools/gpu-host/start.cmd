@echo off
rem Runs start.ps1 without changing the PowerShell execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
