# Dystopia 2 GPU host, step 2 (once, as administrator): let only the dev VM in.
#
# sd-server has no password, so the Windows firewall is the lock: this adds one
# inbound rule for sd-server.exe on the server port, limited to the VM's
# address(es). It also removes broader rules Windows may have created if you
# ever clicked "Allow" in a firewall prompt for sd-server. Safe to re-run,
# e.g. when the VM gets a new address.
#
# Usage: right-click allow-vm.cmd -> Run as administrator, or
#   powershell -ExecutionPolicy Bypass -File allow-vm.ps1 -From 192.168.1.20[,192.168.1.21] [-Port 1234]

#Requires -RunAsAdministrator
param(
  [string[]]$From,
  [int]$Port = 1234,
  [string]$Dir = (Join-Path $HOME 'd2-gpu-host')
)
$ErrorActionPreference = 'Stop'
$group = 'Dystopia 2'

$exe = Get-ChildItem -Path (Join-Path $Dir 'sd') -Recurse -Filter 'sd-server.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw "sd-server.exe not found under $Dir\sd. Run setup.cmd first (or pass -Dir)." }

if (-not $From) {
  $answer = Read-Host 'IP address(es) of the dev VM, comma-separated (on the VM: ip -4 addr)'
  $From = $answer -split '[,\s]+' | Where-Object { $_ }
} else {
  $From = $From -split '[,\s]+' | Where-Object { $_ }
}
foreach ($ip in $From) {
  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($ip, [ref]$parsed)) { throw "Not an IP address: $ip" }
}
if (-not $From) { throw 'No address given.' }

# Drop our old rule and any prompt-created rules that let everyone reach sd-server.
Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallApplicationFilter -Program $exe.FullName -ErrorAction SilentlyContinue |
  Get-NetFirewallRule |
  Where-Object { $_.Group -ne $group } |
  Remove-NetFirewallRule

New-NetFirewallRule -DisplayName 'Dystopia 2 image server (dev VM only)' -Group $group `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
  -RemoteAddress $From -Program $exe.FullName -Profile Any | Out-Null

Write-Host "Firewall: TCP $Port to sd-server.exe allowed from $($From -join ', ') only."
Write-Host 'If Windows ever shows a firewall prompt for sd-server, re-run this script afterwards.'
