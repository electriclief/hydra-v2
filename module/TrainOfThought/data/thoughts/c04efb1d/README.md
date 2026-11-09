# c04efb1d — miner1 is a rig

## State when this was filed

    192.168.1.112   no TCP port answers (ARP present, every port times out)
    192.168.1.138   answers ping, REFUSES 22/2121/445/5985/3389
    LAN port-22 sweep: .109 .122 .123 .127 .131 .134 .147 .149 — none is miner1

sshd is not up on miner1, so nothing can be measured on the box yet.

## One paste, elevated PowerShell, on miner1

    powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr http://192.168.1.123:8140/miner1-bootstrap.ps1 -UseBasicParsing | iex"

Installs OpenSSH Server (capability, or Microsoft's zip when tiny11 stripped it), starts it,
opens port 22, sets PowerShell as the ssh shell, installs 123's key into
administrators_authorized_keys with the SYSTEM/Administrators-only ACL. Idempotent, ends with
`READY hostname=… ip=…`.

## First three commands once ssh answers

    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\User\pcie-report.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\User\card-inventory.ps1
    Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,Status

`pcie-report.ps1` answers "7 of 8 slots powered" with a count: SMBIOS slot table, every VGA/3D
controller by PCI id including driverless ones, Windows adapters with ConfigManagerErrorCode.
A card in a dead slot does not appear at all; a card in a live slot with no driver shows 28.

## Then the software (bare bones, one or the other running)

- VC++ runtime first — a silent `-1073741515` on every miner otherwise
- llama.cpp **Vulkan** build (no CUDA on that box), GGUF models only
- SRBMiner-MULTI and lolMiner
- Defender exclusion on every miner folder before first launch
- desktop launcher per tool + a ProcessWrapper/Hydra row — never a loose background process

## Operator's plan

Cards go in one at a time; each card gets measured on arrival (hashrate for a miner, token rate
for llama) and written on the node.
