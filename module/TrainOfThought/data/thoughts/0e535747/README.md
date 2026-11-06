# Snapshot the ReadyNAS NV+ before archiving to it

TOT node `0e535747` — child of `04bf6852` (Salvage main).

## Why this node exists

The NV+ (Netgear RND4000-100NAS, 4x2TB, Sparc, RAIDiator 4.x, ~5.4 TB usable) is where the salvaged
content is meant to end up. It speaks SMB1 and has no firewall, so two rules govern every session:

1. nothing is written to it until its contents are indexed, or we duplicate what is already there and
   risk overwriting the only copy of something;
2. it is never on the LAN — one host, one cable, a private /30. Powered on for a session, powered off
   after.

## Artifacts in this folder

| file | what it is |
|---|---|
| `LOCAL-E-salvage-index-*.tsv` | source side: every file on E:\Salvage, size + mtime + path |
| `nas_snapshot.py` | the tool: `snapshot` / `diff` / `push`, FTP only, no SMB |
| `EVIDENCE-nas_snapshot-selftest-*.txt` | end-to-end proof against a real FTP server (RESULT: PASS) |
| `SNAPSHOT-nas-*.tsv` | **missing** — produced the first time the NAS is powered on |

## The ritual

```
# 1. snapshot the NAS (no content moves, listings only)
python nas_snapshot.py snapshot --host 10.99.0.2 --user <user> --password <pw> \
    --root / --out SNAPSHOT-nas-<date>.tsv

# 2. what would move
python nas_snapshot.py diff --snapshot SNAPSHOT-nas-<date>.tsv \
    --tree E:\Salvage --remote-root /salvage

# 3. push the non-duplicates, verify each by size, append to the snapshot
python nas_snapshot.py push --host 10.99.0.2 --user <user> --password <pw> \
    --snapshot SNAPSHOT-nas-<date>.tsv --tree E:\Salvage --remote-root /salvage

# 4. power off, and copy SNAPSHOT-nas-*.tsv back here + E:\Salvage + C:\AI\fleet\nas\
```

Dedupe key is `path + size`. A file is re-uploaded only if the remote size differs or it is absent,
so an interrupted session resumes by re-running the same command.

## Verified so far (2026-11-01)

- selftest: 66 real files / 35,998,556 bytes → 1 pre-seeded duplicate skipped, 65 uploaded,
  remote 66 files / 35,998,556 bytes = local, 0 missing, 0 size mismatch, second push 0 uploads.
- `192.168.1.0/24` swept for 21/80/139/445/2049/548/5000/443: no FTP anywhere. The NAS is off or
  unplugged, so no NAS snapshot exists yet.

## Blocker

Power the NAS on. Cable it to one host (andrewjames' free `enp9s0` costs nothing tonight, or a $15
USB-Ethernet adapter on 123 for the faster path), give the pair 10.99.0.1/10.99.0.2, and this node
finishes in one session.
