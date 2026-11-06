#!/usr/bin/env python3
"""
Build the published help site from the pages the app actually serves.

The app's help is the source of truth: every door carries its own help.html, and the help door on :8199
lists them. This script copies those pages into docs/modules/ and writes docs/index.html as the hub, so the
published site cannot drift from what the operator reads inside Hydra. Run it before committing docs/.

    python scripts/build-docs-site.py
"""
from __future__ import annotations

import html
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULES = ROOT / "module"
DOCS = ROOT / "docs"
OUT_MODULES = DOCS / "modules"

# doors first (what the window opens), then the shell pieces, then the pages that are not help pages
DOORS = [
    "Menu", "Services", "Scheduler", "State", "Event_Handler", "ProcessWrapper",
    "Join", "TrainOfThought", "SessionDiary", "Core", "Mirror", "ResourceManager",
]
SHELL = ["Basic_App", "Electron_Wrapper"]
EXTRA_PAGES = [
    ("module-map.html", "Module map — every module, every door, what loads when"),
    ("voice-cast.html", "Voice cast — Sophion, Destiny, Kate, pinned by instruction and seed"),
    ("voice-samples.html", "Voice samples — the audition set, by pitch"),
]


def one_line(folder: Path) -> str:
    """The module's own sentence about itself, taken from join.json when it has one."""
    join = folder / "join.json"
    if join.exists():
        try:
            data = json.loads(join.read_text(encoding="utf-8"))
            what = (data.get("what") or "").strip()
            if what:
                return re.sub(r"\s+", " ", what)
        except json.JSONDecodeError:
            pass
    return ""


def title_of(page: Path) -> str:
    match = re.search(r"<title>(.*?)</title>", page.read_text(encoding="utf-8", errors="replace"), re.S | re.I)
    return html.unescape(match.group(1).strip()) if match else page.stem


STYLE = """
  :root { color-scheme: dark; --bg:#111318; --panel:#191c23; --border:#303541; --text:#e5e7eb; --muted:#a1a8b7; --accent:#8ab4f8; }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 24px 80px; background:var(--bg); color:var(--text);
         font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:82ch; margin:0 auto; }
  h1 { font-size:26px; font-weight:600; letter-spacing:-.01em; margin:0 0 6px; }
  p.lede { color:var(--muted); margin:0 0 8px; }
  p.warn { color:#f0b37e; font-size:13px; margin:18px 0 30px; padding:10px 12px; border-left:2px solid #f0b37e; background:#1b1a17; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.14em; color:var(--muted);
       margin:34px 0 10px; border-bottom:1px solid var(--border); padding-bottom:6px; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  ul { list-style:none; margin:0; padding:0; }
  li { padding:10px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  li:last-child { border-bottom:none; }
  .name { font-weight:600; }
  .what { color:var(--muted); font-size:13px; display:block; margin-top:2px; }
  .port { color:var(--muted); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; margin-left:8px; }
"""


def port_of(folder: Path) -> str:
    join = folder / "join.json"
    if not join.exists():
        return ""
    try:
        port = json.loads(join.read_text(encoding="utf-8")).get("port")
        return f":{port}" if port else ""
    except json.JSONDecodeError:
        return ""


def row(href: str, name: str, what: str, port: str = "") -> str:
    tail = f'<span class="port">{html.escape(port)}</span>' if port else ""
    sub = f'<span class="what">{html.escape(what)}</span>' if what else ""
    return f'<li><a class="name" href="{html.escape(href)}">{html.escape(name)}</a>{tail}{sub}</li>'


def main() -> None:
    OUT_MODULES.mkdir(parents=True, exist_ok=True)
    copied = 0

    for group in (DOORS, SHELL):
        for name in group:
            page = MODULES / name / "help.html"
            if page.exists():
                shutil.copyfile(page, OUT_MODULES / f"{name}.html")
                copied += 1

    sections = []
    for title, group in (("The doors — what the window opens", DOORS), ("The shell", SHELL)):
        items = []
        for name in group:
            page = MODULES / name / "help.html"
            if not page.exists():
                continue
            items.append(row(f"modules/{name}.html", name, one_line(MODULES / name), port_of(MODULES / name)))
        if items:
            sections.append(f"<h2>{html.escape(title)}</h2><ul>" + "".join(items) + "</ul>")

    extras = [row(href, title_of(DOCS / href), "") for href, _ in EXTRA_PAGES if (DOCS / href).exists()]
    if extras:
        sections.append("<h2>Pages that are not door help</h2><ul>" + "".join(extras) + "</ul>")

    hub = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hydra V2 — help</title>
<style>{STYLE}</style>
</head>
<body>
<main>
  <h1>Hydra V2 — help</h1>
  <p class="lede">Every door explains itself: what it owns, what it refuses, and how to read it from an agent.
     These are the same pages the app serves on <code>:8199</code>, copied here by
     <code>scripts/build-docs-site.py</code> so they cannot drift.</p>
  <p class="warn">Hydra V2 is <strong>not working</strong>. This is a construction site: no installer, one node,
     hardcoded paths, no broker, and no authentication by design. The pages describe the design honestly,
     including the parts that do not exist yet.</p>
  {''.join(sections)}
</main>
</body>
</html>
"""
    (DOCS / "index.html").write_text(hub, encoding="utf-8")
    print(f"docs/index.html written ({len(hub)} bytes), {copied} module help pages copied")


if __name__ == "__main__":
    main()
