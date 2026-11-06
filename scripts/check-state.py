#!/usr/bin/env python
"""Check the live registry against state.vocabulary.yaml.

Three questions, in the order that matters:

  1. Is every entry in State a path the vocabulary documents?  (undocumented = a fact nobody can interpret)
  2. Does every documented branch that IS present carry the fields the vocabulary promises?
  3. Does a read-time resolve answer with a documented outcome?

Run:  python scripts/check-state.py            # this node
      python scripts/check-state.py --url http://192.168.1.127:8127
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
VOCAB = ROOT / "module" / "State" / "vocabulary.yaml"


def get(url, timeout=4):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def pattern_for(name):
    """'node.<ref>.services.<slug>' -> a regex that matches exactly that depth."""
    parts = []
    for seg in name.split("."):
        parts.append(r"[^.]+" if seg.startswith("<") and seg.endswith(">") else re.escape(seg))
    return re.compile("^" + r"\.".join(parts) + "$")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8127")
    ap.add_argument("--core", default="http://127.0.0.1:8136")
    args = ap.parse_args()

    if not VOCAB.exists():
        print(f"no vocabulary at {VOCAB}")
        return 2
    vocab = yaml.safe_load(VOCAB.read_text(encoding="utf-8"))

    paths = vocab.get("paths") or {}
    known = [(name, pattern_for(name), spec) for name, spec in paths.items()]

    state = get(f"{args.url}/api/state")
    entries = state.get("entries") or []

    undocumented, missing_fields, ok = [], [], 0
    for entry in entries:
        name = entry.get("path") or entry.get("name") or ""
        match = next(((n, spec) for n, rx, spec in known if rx.match(name)), None)
        if not match:
            undocumented.append(name)
            continue
        ok += 1
        doc_name, spec = match
        # the list endpoint carries no content, so read the entry itself: the vocabulary is about values
        try:
            content = get(f"{args.url}/api/state/pull?name={name}").get("content")
        except Exception:  # noqa: BLE001
            content = None
        entry["content"] = content
        promised = spec.get("content") if isinstance(spec, dict) else None
        if isinstance(promised, dict) and isinstance(content, dict):
            for field in promised:
                if field not in content:
                    missing_fields.append(f"{name}: no '{field}' (documented under {doc_name})")

    # the link branch is the one with a shape rule worth enforcing by hand
    links = [e for e in entries if re.match(r"^node\.[^.]+$", e.get("path") or e.get("name") or "")]
    bad_links = [e.get("path") for e in links if (e.get("content") or {}).get("kind") != "link"]

    # a resolve, to check the outcome vocabulary is the one in the file
    outcomes = set((vocab.get("values") or {}).get("resolve_outcome") or {})
    resolve_problems = []
    sample = next((e.get("path") or e.get("name") for e in entries
                   if re.match(r"^node\.[^.]+\.cycle$", e.get("path") or e.get("name") or "")), None)
    if sample:
        try:
            got = get(f"{args.core}/api/resolve?name={sample}")
            outcome = "ok" if got.get("ok") else (got.get("why") or "?")
            if outcome not in outcomes:
                resolve_problems.append(f"resolve said '{outcome}', which is not in resolve_outcome")
            print(f"  resolve {sample} -> ok={got.get('ok')} value={str(got.get('value'))[:60]} hops={got.get('hops')} {got.get('ms')}ms")
        except Exception as exc:  # noqa: BLE001 - a missing Core is a finding, not a crash
            resolve_problems.append(f"resolve failed: {exc}")

    print(f"  vocabulary: {len(paths)} documented paths, {len(entries)} live entries")
    print(f"  documented: {ok}/{len(entries)}")
    for name in undocumented:
        print(f"  UNDOCUMENTED  {name}")
    for line in missing_fields:
        print(f"  FIELD         {line}")
    for line in resolve_problems:
        print(f"  RESOLVE       {line}")
    if links:
        print(f"  links: {len(links)} ({', '.join(sorted(e.get('path') or e.get('name') for e in links))})")
        for bad in bad_links:
            print(f"  BAD LINK      {bad}")

    problems = len(undocumented) + len(resolve_problems) + len(bad_links)
    print(f"\nState — vocabulary {'matches' if not problems else 'does NOT match'} the live registry — "
          f"{'GREEN' if not problems else 'RED'}"
          + (f" ({len(missing_fields)} field warnings)" if missing_fields else ""))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
