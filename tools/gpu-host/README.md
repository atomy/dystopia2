# GPU host kit (Windows)

The dev VM has no GPU, so AI images and textures for the art pass are generated on a Windows PC with a graphics card. This kit turns that PC into an image server the VM can use over the LAN:

- **[stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)** `sd-server` (MIT), Vulkan build. Vulkan works on AMD, NVIDIA and Intel cards, with no Python, CUDA or ROCm needed.
- **[Z-Image Turbo](https://huggingface.co/leejet/Z-Image-Turbo-GGUF)** (Apache 2.0), with its text encoder [Qwen3-4B-Instruct-2507](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF) (Apache 2.0) and the FLUX VAE (Apache 2.0).

Every download is pinned to a fixed version and checked against its SHA-256 checksum. 3D models aren't made here: they come from TRELLIS.2 on Hugging Face (DESIGN.md §15.2).

## Requirements

- Windows 10 or 11, and a GPU with a current driver. For AMD cards the Adrenalin driver includes Vulkan.
- About 12 GB of free disk space.
- About 12 GB of free RAM while the server runs. The model weights stay in RAM and are moved to the GPU when needed, which is how it fits a 12 GB card.

## Setup (once)

1. **Get the kit.** Download <https://github.com/atomy/dystopia2/archive/refs/heads/main.zip>. Before extracting, right-click the zip, choose **Properties**, tick **Unblock** and click OK; otherwise Windows may warn about the scripts. Extract it and open `tools\gpu-host`.
2. **Download the server and models.** Double-click **`setup.cmd`**.
   - It downloads about 11 GB into `%USERPROFILE%\d2-gpu-host`.
   - Re-run it after an interruption: finished files are skipped and partial downloads resume.
   - To use another drive, run `setup.cmd -Dir D:\d2-gpu-host` from a terminal, and pass the same `-Dir` to the other two scripts.
3. **Let only the VM in.** Right-click **`allow-vm.cmd`** and choose **Run as administrator**, then enter the VM's IP address. On the VM, `ip -4 addr` shows it; enter both addresses, comma-separated, if it has two.
   - The server has no password, so this firewall rule is what keeps everyone else on the network out.
   - If Windows ever shows a firewall prompt for `sd-server`, re-run this script afterwards: it removes the broader rule the prompt creates.

## Each session

1. Double-click **`start.cmd`**. It prints a line like `D2_IMAGE_SERVER=http://<this-pc>:1234`.
2. On the VM, put that line into the repo's `.env` (copy `.env.example` the first time). It only needs changing when the PC's address changes.
3. On the VM, check the connection:

   ```bash
   npx tsx tools/assets/imagegen.ts --ping
   npx tsx tools/assets/imagegen.ts "rusted steel wall panel, grime, rivets, flat lighting" out/test.png
   ```

4. Close the window, or press Ctrl+C, when you're done. Nothing runs in the background.

## Troubleshooting

- **The server won't start, or the images come out black:** run `start.cmd -NoFlashAttention`.
- **Out-of-memory errors:** close games and other GPU-heavy programs; the server needs most of the card and about 12 GB of system RAM.
- **The VM can't connect:**
  - Check that the address in `.env` matches the one `start.cmd` printed.
  - Re-run `allow-vm.cmd` as administrator with the VM's current address.
- **A different port:** pass `-Port 5000` to both `allow-vm.cmd` and `start.cmd`.

## Uninstall

Delete the `d2-gpu-host` folder. Then, in an administrator PowerShell, remove the firewall rule:

```powershell
Get-NetFirewallRule -Group 'Dystopia 2' | Remove-NetFirewallRule
```
