#!/usr/bin/env python3
"""NAS snapshot / dedupe / push for the ReadyNAS NV+ (FTP only, no SMB1).

Commands
  snapshot  walk the NAS over FTP and write size\\tmtime\\tpath rows
  diff      compare a local tree against a snapshot -> what is new, what is a duplicate
  push      upload the non-duplicate files, verify each by SIZE, append them to the snapshot

Why FTP: the NV+ speaks SMB1, and enabling SMB1 on Windows 11 is a LAN-wide risk. FTP is on by
default on this box and needs nothing from the client OS.

Every listing is path + size + mtime, never content, so a snapshot of terabytes costs no bandwidth.
"""
import argparse
import ftplib
import os
import sys
import time
from datetime import datetime

TSV_HDR = "size\tmtime\tpath"


def connect(host, user, password, port=21, encoding="utf-8"):
    f = ftplib.FTP(timeout=60)
    f.encoding = encoding
    f.connect(host, port)
    f.login(user, password)
    f.set_pasv(True)
    return f


def _parse_list_line(line):
    """Unix-style LIST fallback: -rw-r--r-- 1 user group 1234 Jan 02 12:34 name"""
    parts = line.split(None, 8)
    if len(parts) < 9:
        return None
    perms, size, name = parts[0], parts[4], parts[8]
    is_dir = perms.startswith("d")
    try:
        size = int(size)
    except ValueError:
        return None
    return is_dir, size, name


def walk(ftp, root="/", log=print):
    """Return list of (size, mtime_str, path) for every file under root."""
    rows = []
    dirs_todo = [root]
    while dirs_todo:
        cur = dirs_todo.pop()
        try:
            entries = list(ftp.mlsd(cur))
            for name, facts in entries:
                if name in (".", ".."):
                    continue
                path = (cur.rstrip("/") + "/" + name)
                if facts.get("type") == "dir":
                    dirs_todo.append(path)
                elif facts.get("type") == "file":
                    rows.append((int(facts.get("size", 0)),
                                 facts.get("modify", "")[:8],
                                 path))
        except (ftplib.error_perm, AttributeError):
            # MLSD unsupported (old servers) -> LIST fallback
            names = []
            try:
                ftp.cwd(cur)
                ftp.retrlines("LIST", names.append)
            except ftplib.error_perm as e:
                log("  ! cannot list %s: %s" % (cur, e))
                continue
            for line in names:
                parsed = _parse_list_line(line)
                if not parsed:
                    continue
                is_dir, size, name = parsed
                path = (cur.rstrip("/") + "/" + name)
                if is_dir:
                    dirs_todo.append(path)
                else:
                    rows.append((size, "", path))
    return rows


def write_snapshot(rows, out_path):
    rows = sorted(rows, key=lambda r: r[2].lower())
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(TSV_HDR + "\n")
        for size, mtime, path in rows:
            fh.write("%d\t%s\t%s\n" % (size, mtime, path))
    return len(rows), sum(r[0] for r in rows)


def load_snapshot(path):
    """path(lower) -> (size, mtime)"""
    idx = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        fh.readline()
        for line in fh:
            parts = line.rstrip("\r\n").split("\t")
            if len(parts) != 3:
                continue
            try:
                size = int(parts[0])
            except ValueError:
                continue
            idx[parts[2].lower()] = (size, parts[1])
    return idx


def local_tree(root):
    """yield (relpath, abs path, size, mtime 'YYYYMMDDHHMMSS')"""
    for base, _dirs, files in os.walk(root):
        for name in files:
            full = os.path.join(base, name)
            try:
                st = os.stat(full)
            except OSError:
                continue
            rel = os.path.relpath(full, root).replace("\\", "/")
            yield rel, full, st.st_size, datetime.fromtimestamp(st.st_mtime).strftime("%Y%m%d%H%M%S")


def plan(root, snapshot_idx, remote_root):
    """Split the local tree into (to_upload, duplicates)."""
    upload, dupe = [], []
    for rel, full, size, mtime in local_tree(root):
        remote_path = remote_root.rstrip("/") + "/" + rel
        hit = snapshot_idx.get(remote_path.lower())
        if hit and hit[0] == size:
            dupe.append((rel, size, full))
        else:
            upload.append((rel, size, full, remote_path))
    return upload, dupe


def ensure_dir(ftp, remote_dir):
    parts = [p for p in remote_dir.strip("/").split("/") if p]
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            ftp.mkd(cur)
        except ftplib.error_perm:
            pass


def push(ftp, items, log=print, progress_every=25):
    ok, failed = [], []
    for i, (rel, size, full, remote_path) in enumerate(items, 1):
        rdir = remote_path.rsplit("/", 1)[0]
        try:
            ensure_dir(ftp, rdir)
            with open(full, "rb") as fh:
                ftp.storbinary("STOR " + remote_path, fh, blocksize=65536)
            rsize = ftp.size(remote_path)
            if rsize != size:
                failed.append((rel, "size %s != %s" % (rsize, size)))
            else:
                ok.append((rel, size, remote_path))
        except Exception as e:
            failed.append((rel, str(e)[:120]))
        if i % progress_every == 0:
            done = sum(x[1] for x in ok)
            log("  %d/%d files, %.1f MB verified" % (i, len(items), done / 1e6))
    return ok, failed


def cmd_snapshot(a):
    log = print
    ftp = connect(a.host, a.user, a.password, a.port, a.encoding)
    log("connected: %s" % ftp.getwelcome())
    log("walking %s ..." % a.root)
    t0 = time.time()
    rows = walk(ftp, a.root, log)
    ftp.quit()
    out = a.out or ("nas-snapshot-%s.tsv" % datetime.now().strftime("%Y%m%d-%H%M"))
    n, total = write_snapshot(rows, out)
    log("snapshot: %d files, %.2f GB, %.0fs -> %s" % (n, total / 1e9, time.time() - t0, os.path.abspath(out)))
    return 0


def cmd_diff(a):
    idx = load_snapshot(a.snapshot)
    up, dupe = plan(a.tree, idx, a.remote_root)
    dupe_bytes = sum(x[1] for x in dupe)
    up_bytes = sum(x[1] for x in up)
    print("snapshot entries : %d" % len(idx))
    print("local files      : %d" % (len(up) + len(dupe)))
    print("duplicates       : %d  (%.2f GB already there - will be skipped)" % (len(dupe), dupe_bytes / 1e9))
    print("to upload        : %d  (%.2f GB)" % (len(up), up_bytes / 1e9))
    for rel, size, _f, _r in sorted(up, key=lambda x: -x[1])[:15]:
        print("   %9.1f MB  %s" % (size / 1e6, rel))
    if len(up) > 15:
        print("   ... %d more" % (len(up) - 15))
    return 0


def cmd_push(a):
    idx = load_snapshot(a.snapshot) if a.snapshot else {}
    up, dupe = plan(a.tree, idx, a.remote_root)
    print("duplicates skipped: %d (%.2f GB) | to upload: %d (%.2f GB)"
          % (len(dupe), sum(x[1] for x in dupe) / 1e9, len(up), sum(x[1] for x in up) / 1e9))
    if a.dry_run:
        return 0
    ftp = connect(a.host, a.user, a.password, a.port, a.encoding)
    ok, failed = push(ftp, up, print)
    ftp.quit()
    if ok and a.snapshot:
        with open(a.snapshot, "a", encoding="utf-8", newline="\n") as fh:
            for rel, size, rp in ok:
                fh.write("%d\t%s\t%s\n" % (size, datetime.now().strftime("%Y%m%d%H%M%S"), rp))
    print("uploaded+verified: %d (%.2f GB) | failed: %d"
          % (len(ok), sum(x[1] for x in ok) / 1e9, len(failed)))
    for rel, why in failed[:20]:
        print("   FAIL %s :: %s" % (rel, why))
    return 0 if not failed else 1


def main(argv=None):
    p = argparse.ArgumentParser(description="NAS snapshot / dedupe / push over FTP")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("snapshot", help="walk the NAS and write a size/mtime/path snapshot")
    s.add_argument("--host", required=True)
    s.add_argument("--user", default="anonymous")
    s.add_argument("--password", default="")
    s.add_argument("--port", type=int, default=21)
    s.add_argument("--encoding", default="utf-8")
    s.add_argument("--root", default="/")
    s.add_argument("--out")
    s.set_defaults(func=cmd_snapshot)

    d = sub.add_parser("diff", help="what would be uploaded vs what is already there")
    d.add_argument("--snapshot", required=True)
    d.add_argument("--tree", required=True)
    d.add_argument("--remote-root", default="/salvage")
    d.set_defaults(func=cmd_diff)

    u = sub.add_parser("push", help="upload non-duplicates, verify by size, append to snapshot")
    u.add_argument("--host", required=True)
    u.add_argument("--user", default="anonymous")
    u.add_argument("--password", default="")
    u.add_argument("--port", type=int, default=21)
    u.add_argument("--encoding", default="utf-8")
    u.add_argument("--snapshot")
    u.add_argument("--tree", required=True)
    u.add_argument("--remote-root", default="/salvage")
    u.add_argument("--dry-run", action="store_true")
    u.set_defaults(func=cmd_push)

    a = p.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
