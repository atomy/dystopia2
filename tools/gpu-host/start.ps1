# Dystopia 2 GPU host, step 3: run the image server while assets are being made.
#
# Starts sd-server with Z-Image Turbo on all network interfaces (the firewall
# rule from allow-vm.ps1 limits who can connect). Weights stay in RAM and move
# to the GPU when needed (--offload-to-cpu), so it fits a 12 GB card; it needs
# about 12 GB of free system RAM. Stop it with Ctrl+C or by closing the window.
#
# Usage: double-click start.cmd, or
#   powershell -ExecutionPolicy Bypass -File start.ps1 [-Port 1234] [-NoFlashAttention]

param(
  [string]$Dir = (Join-Path $HOME 'd2-gpu-host'),
  [int]$Port = 1234,
  # Use this if the server fails to start or produces black images.
  [switch]$NoFlashAttention
)
$ErrorActionPreference = 'Stop'

$exe = Get-ChildItem -Path (Join-Path $Dir 'sd') -Recurse -Filter 'sd-server.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { throw "sd-server.exe not found under $Dir\sd. Run setup.cmd first (or pass -Dir)." }
$models = Join-Path $Dir 'models'

$sdArgs = @(
  '--diffusion-model', (Join-Path $models 'z_image_turbo-Q8_0.gguf'),
  '--llm', (Join-Path $models 'Qwen3-4B-Instruct-2507-Q8_0.gguf'),
  '--vae', (Join-Path $models 'ae.safetensors'),
  '--cfg-scale', '1.0',
  '--steps', '8',
  '--offload-to-cpu',
  '--listen-ip', '0.0.0.0',
  '--listen-port', "$Port"
)
if (-not $NoFlashAttention) { $sdArgs += '--diffusion-fa' }

if (-not (Get-NetFirewallRule -Group 'Dystopia 2' -ErrorAction SilentlyContinue)) {
  Write-Warning 'No firewall rule yet: the VM cannot connect. Run allow-vm.cmd as administrator first.'
}

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress
Write-Host "Dystopia 2 image server on port $Port. On the VM, put one of these into .env:"
foreach ($ip in $ips) { Write-Host "  D2_IMAGE_SERVER=http://${ip}:$Port" }
Write-Host 'Stop with Ctrl+C.'
Write-Host ''

& $exe.FullName @sdArgs
