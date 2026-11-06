"""Add the two real child trains so the map has an edge to draw.

Both are genuine pending steps already listed in their parent's next[] — not decoration:
  - Build modules for Hydra V2  ->  Wire the Thoughts tab into the window
  - Salvage main               ->  Prove sshd survives a cold start on main

Idempotent: re-running it does not duplicate a title that already exists.
"""

import json
import urllib.request

BASE = "http://127.0.0.1:8135"


def call(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(BASE + path, data=data, method="POST" if data else "GET")
    if data:
        request.add_header("content-type", "application/json")
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def make(title, intent, steps, dep, tags):
    existing = call("/api/thoughts?state=all")
    for row in existing["rows"]:
        if row["title"] == title:
            print(f"= {row['ref']}  {title}  (already there)")
            return row
    node = call(
        "/api/thoughts",
        {"title": title, "intent": intent, "next": steps, "deps": [dep], "tags": tags, "by": "hermes"},
    )["node"]
    print(f"+ {node['ref']}  {title}  (waits on {dep})")
    return node


make(
    "Wire the Thoughts tab into the window",
    "The door answers; the window still has to raise it and show it as a tab owned by ProcessWrapper, "
    "so no console is ever loose on the desktop.",
    [
        "stop the hand-started doors before launch so ProcessWrapper owns them",
        "relaunch the window and confirm the Thoughts tab loads",
    ],
    "294cd029",
    ["hydra"],
)

make(
    "Prove sshd survives a cold start on main",
    "The service object is flagged for deletion; until a cold start brings sshd back with no operator "
    "present, the box is not salvaged.",
    [
        "recreate the sshd service object with sc create",
        "cold start .100 and log in with nobody at the keyboard",
    ],
    "04bf6852",
    ["main"],
)

rows = call("/api/thoughts?state=all")["rows"]
print("\nnodes:", len(rows))
for row in sorted(rows, key=lambda item: (item["layer"], item["ref"])):
    print(f"  L{row['layer']}  {row['ref']}  {row['state']:<8} deps={len(row['deps'])}  {row['title'][:54]}")
