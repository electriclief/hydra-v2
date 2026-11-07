#!/usr/bin/env python3
"""library.py - list, search and extend the Hydra service library. No dependencies."""
from __future__ import annotations
import argparse, json, pathlib, sys

LIB = pathlib.Path(__file__).resolve().parent.parent / "library" / "api-index.json"

def load() -> dict:
    return json.loads(LIB.read_text(encoding="utf-8"))

def save(d: dict) -> None:
    LIB.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")

def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    s = sub.add_parser("show"); s.add_argument("id")
    f = sub.add_parser("find"); f.add_argument("q")
    a = sub.add_parser("add"); a.add_argument("file")
    args = ap.parse_args()
    d = load()
    services = d["services"]

    if args.cmd == "list":
        for e in services:
            print(f"  {e['id']:<18} {e['owner']:<16} {e['title']}")
        print(f"\n{len(services)} services")
        return 0

    if args.cmd == "show":
        e = next((x for x in services if x["id"] == args.id), None)
        if not e:
            print(f"no such service: {args.id}", file=sys.stderr); return 1
        for k, v in e.items():
            if isinstance(v, list):
                v = " · ".join(map(str, v))
            print(f"{k:>10}: {v}")
        return 0

    if args.cmd == "find":
        q = args.q.lower()
        hits = [e for e in services if q in json.dumps(e).lower()]
        for e in hits:
            print(f"  {e['id']:<18} {e['title']}")
        print(f"\n{len(hits)} match" + ("" if len(hits) == 1 else "es"))
        return 0

    if args.cmd == "add":
        entry = json.loads(pathlib.Path(args.file).read_text(encoding="utf-8"))
        for field in ("id", "title", "owner", "door", "call", "returns", "cost", "use_when", "used_by"):
            if field not in entry:
                print(f"refused: entry has no '{field}' - an uncallable or unmeasured service is not a library entry", file=sys.stderr)
                return 2
        if any(x["id"] == entry["id"] for x in services):
            print(f"refused: {entry['id']} already exists (edit it in place instead)", file=sys.stderr)
            return 2
        services.append(entry)
        save(d)
        print(f"added {entry['id']} - now {len(services)} services")
        return 0
    return 0

if __name__ == "__main__":
    sys.exit(main())
