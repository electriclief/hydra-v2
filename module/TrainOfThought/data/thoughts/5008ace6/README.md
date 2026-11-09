# 5008ace6 — keeper drives become tiny11 installers

## The ritual

    # on jims (192.168.1.127), with the keeper drive in the USB slot
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\User\make-installer-drive.ps1 `
      -Disk <n> -Serial <drive serial> -Iso C:\AI\iso\tiny11_25H2.iso -InstallTarget

    # prove the boot chain by reading the disk, not the file list
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\User\disk-bootcheck.ps1 -Disk <n>

    # what landed
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\User\verify-installer-drive.ps1

## Layout

    P1  FAT32, 6.4 GB, ACTIVE   setup media (bootmgr, boot\bcd, efi\boot\bootx64.efi,
                                sources\boot.wim, sources\install.swm)
    P2  NTFS, remaining          WINDOWS - the install target, same physical disk

In setup: choose **Disk 0 Partition 2**. Never Partition 1 — that is the installer.

## Why one disk can hold both

boot.wim is loaded into a RAM disk, so partition 1 is idle while setup runs and setup writes
to partition 2 freely. On MBR the boot files land in the ACTIVE partition (P1) — leave it.

## Measured

- test VHD, real ISO: install.wim 4.44 GB -> install.swm 3.70 GB; 5.34 GB in 970 files
- real drive WD1200BEVS-60RST0 / WD-WXC807000973: P1 6.4 GB TINY11, P2 105.3 GB WINDOWS
- sector 0: 383/446 boot-code bytes non-zero, signature 55 AA
- P1 boot flag 0x80, type 0x0C (FAT32); P2 type 0x07 (NTFS); P1 VBR names BOOTMGR
- bootsect /nt60 /mbr: "Successfully updated disk bootcode" (/?/PhysicalDrive2)

## Guards

- `-Serial` must match the drive's **SMART** serial (the bridge reports 03211113324B for every drive)
- refuses the running system disk
- refuses a disk carrying a Ventoy volume or holding ISO files at the root

## Still owed

- ReX boot test (operator, next morning)
- remaining keepers, one command each
- GPT + real ESP if ReX turns out UEFI-only
