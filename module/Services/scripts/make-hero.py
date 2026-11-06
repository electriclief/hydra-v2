#!/usr/bin/env python
"""
make-hero.py — turn a big render into the exact hero frame a service page carries.

WHY: the operator's recipe (2026-10-18) — shoot bigger and longer than you need, then
downscale/crop. Detail survives a downscale; it does not survive a small, short render.

USAGE
  python make-hero.py <in.png> <out.jpg> --w 896 --h 640 [--q 85] [--focus center|top|bottom]

WHAT IT DOES
  - centre-crops to the target aspect (never stretches)
  - resizes with LANCZOS
  - writes an optimised JPEG and prints the raw size + the embedded (base64) size
  - refuses if the encoded result would cross the shelf's REFUSE line (500 KB)

AUTHORING TOOL ONLY — Pillow is a build-time dependency, not a runtime one. Service files
carry the finished base64; nothing on the shelf imports Pillow.
"""
import argparse
import base64
import io
import sys

from PIL import Image


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--w", type=int, required=True)
    ap.add_argument("--h", type=int, required=True)
    ap.add_argument("--q", type=int, default=85)
    ap.add_argument("--focus", default="center", choices=["center", "top", "bottom"])
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGB")
    sw, sh = im.size
    target = a.w / a.h
    src_ratio = sw / sh

    if src_ratio > target:                      # too wide → crop the sides
        new_w = int(round(sh * target))
        left = (sw - new_w) // 2
        box = (left, 0, left + new_w, sh)
    else:                                       # too tall → crop top/bottom
        new_h = int(round(sw / target))
        if a.focus == "top":
            top = 0
        elif a.focus == "bottom":
            top = sh - new_h
        else:
            top = (sh - new_h) // 2
        box = (0, top, sw, top + new_h)

    im = im.crop(box).resize((a.w, a.h), Image.LANCZOS)
    im.save(a.dst, "JPEG", quality=a.q, optimize=True, progressive=True)

    raw = open(a.dst, "rb").read()
    b64_len = len(base64.b64encode(raw)) + len("data:image/jpeg;base64,")
    print(f"src        {a.src}  {sw}x{sh}")
    print(f"crop       {box}  →  {a.w}x{a.h}")
    print(f"wrote      {a.dst}")
    print(f"raw        {len(raw)//1024} KB   (q{a.q})")
    print(f"embedded   {b64_len//1024} KB base64   target 200 · WARN 250 · REFUSE 500")
    if b64_len > 500 * 1024:
        print("REFUSED — over the 500 KB ceiling; lower -q or smaller --w.")
        return 1
    if b64_len > 250 * 1024:
        print("WARN — over the 250 KB warning line.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
