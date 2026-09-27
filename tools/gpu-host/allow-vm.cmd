@echo off
rem Runs allow-vm.ps1 without changing the PowerShell execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow-vm.ps1" %*
pause
