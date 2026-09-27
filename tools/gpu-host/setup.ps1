# Dystopia 2 GPU host, step 1: download the image server and the model files.
#
# Downloads stable-diffusion.cpp (Vulkan build, runs on AMD/NVIDIA/Intel GPUs)
# and Z-Image Turbo (Apache 2.0) into $Dir, about 11 GB in total. Every file is
# pinned to a fixed version and checked against its SHA-256. Safe to re-run:
# finished files are skipped and interrupted downloads resume.
#
# Usage: double-click setup.cmd, or
#   powershell -ExecutionPolicy Bypass -File setup.ps1 [-Dir D:\d2-gpu-host]

param(
  [string]$Dir = (Join-Path $HOME 'd2-gpu-host')
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$files = @(
  @{
    Name   = 'sd-vulkan.zip'
    Url    = 'https://github.com/leejet/stable-diffusion.cpp/releases/download/master-920-2f88688/sd-master-2f88688-bin-win-vulkan-x64.zip'
    Size   = 31998883
    Sha256 = '63e84439c20dde75487a933066318ae01353e9e80ee70e031acad48e857e1cb9'
  },
  @{
    Name   = 'models\z_image_turbo-Q8_0.gguf'
    Url    = 'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/c61c0e422dc8b541b7548cf33a4ef8302b0f8085/z_image_turbo-Q8_0.gguf'
    Size   = 6577440704
    Sha256 = 'df1c5baa86d1398c979495a6072dbcee79444fdb884a2445582ba0769c44e9a1'
  },
  @{
    Name   = 'models\Qwen3-4B-Instruct-2507-Q8_0.gguf'
    Url    = 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q8_0.gguf'
    Size   = 4280405600
    Sha256 = '391c1e410fd9f4cf2de2b510273b56a84c19ce18f4fa3bfb3774031dac4ef068'
  },
  @{
    Name   = 'models\ae.safetensors'
    Url    = 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/6fc90a3b1b653e935a0d175e260736de25b84df5/split_files/vae/ae.safetensors'
    Size   = 335304388
    Sha256 = 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38'
  }
)

function Test-Complete($path, $f) {
  if (-not (Test-Path $path)) { return $false }
  if ((Get-Item $path).Length -ne $f.Size) { return $false }
  Write-Host "  checking $($f.Name) ..."
  return (Get-FileHash $path -Algorithm SHA256).Hash -eq $f.Sha256.ToUpper()
}

function Get-PinnedFile($f) {
  $path = Join-Path $Dir $f.Name
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  if (Test-Complete $path $f) {
    Write-Host "ok        $($f.Name)"
    return
  }
  # A full-size file with the wrong hash (or an oversized one) can't be resumed.
  if ((Test-Path $path) -and ((Get-Item $path).Length -ge $f.Size)) { Remove-Item $path }
  Write-Host ("download  {0} ({1:N2} GB)" -f $f.Name, ($f.Size / 1GB))
  & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o $path $f.Url
  if ($LASTEXITCODE -ne 0) { throw "Download failed ($LASTEXITCODE): $($f.Url). Run setup again to resume." }
  if (-not (Test-Complete $path $f)) {
    Remove-Item $path
    throw "Checksum mismatch for $($f.Name); the file was deleted. Run setup again."
  }
  Write-Host "ok        $($f.Name)"
}

Write-Host "Installing into $Dir"
foreach ($f in $files) { Get-PinnedFile $f }

$sdDir = Join-Path $Dir 'sd'
if (-not (Get-ChildItem -Path $sdDir -Recurse -Filter 'sd-server.exe' -ErrorAction SilentlyContinue)) {
  Write-Host 'unpacking stable-diffusion.cpp'
  Expand-Archive -Path (Join-Path $Dir 'sd-vulkan.zip') -DestinationPath $sdDir -Force
}
$exe = Get-ChildItem -Path $sdDir -Recurse -Filter 'sd-server.exe' | Select-Object -First 1
if (-not $exe) { throw "sd-server.exe not found in the archive under $sdDir" }

Write-Host ''
Write-Host "Done. Server: $($exe.FullName)"
Write-Host 'Next: right-click allow-vm.cmd -> Run as administrator (once), then start.cmd.'
