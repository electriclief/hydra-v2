"""Seed TrainOfThought with the three trains that actually exist on this rig.

Idempotent: a node whose title already matches (GET /api/thoughts?q=) is reused, never duplicated,
so running this twice is safe. Session refs are real SessionDiary refs, and they are only attached
when the session actually happened — no decorative evidence.

    python scripts/seed_trains.py [--base http://127.0.0.1:8135]
"""

import argparse
import json
import urllib.error
import urllib.request

TRAINS = [
    {
        "title": "Add nodes and intent to the LAN database",
        "intent": (
            "One roster where every machine carries what it IS FOR, not just its address: role, "
            "ready_for[], and the door it answers on. Done means fleetctl scan reports intent per "
            "node, Join resolves each one by name, and a node can be picked for a job without "
            "reading the desktop."
        ),
        "next": [
            "re-probe .112 and .139 into roster.json with real hardware lines",
            "give every row a role and ready_for[] instead of free-text notes",
            "register the fleet page as a Join member on :8137",
        ],
        "tags": ["lan", "fleet"],
        "sessions": {"8e3720cf": "ssh door + host inventory for the LAN nodes"},
    },
    {
        "title": "Build modules for Hydra V2",
        "intent": (
            "Every door holds its own data, its own gate and its own page, so the shelf grows by "
            "writing data rather than by editing code. Done means a new module is a folder with a "
            "join.json and a passing selftest, and the window picks it up from tabs.json alone."
        ),
        "next": [
            "finish the Train Of Thought door (api + page + tabs wiring)",
            "wire the Thoughts tab into tabs.json and DOOR_TABLE",
            "give Scheduler a real runner in place of the dummy",
        ],
        "tags": ["hydra", "modules"],
        "sessions": {"e971fb0e": "built SessionDiary and its 51-assert gate"},
    },
    {
        "title": "Salvage main",
        "intent": (
            "Data to be reclaimed and a reboot headache: .100 powers off after a few minutes and "
            "its sshd service object is flagged for deletion. Done means the kits worth keeping are "
            "off the box, sshd survives a reboot by itself, and nothing on that machine is the only "
            "copy of anything."
        ),
        "next": [
            "pull the three dead model kits off .100 before the next cold boot",
            "prove sshd comes back after a reboot (sshd-ensure, no operator)",
            "sha256 the survivors and delete the local duplicates",
        ],
        "tags": ["main", "salvage"],
        "state": "blocked",
        "sessions": {"8e3720cf": "salvaged the node and set up the SSH door on main"},
    },
]


def call(base, method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def find(base, title):
    rows = call(base, "GET", "/api/thoughts?state=all")["rows"]
    for row in rows:
        if row["title"].strip().lower() == title.strip().lower():
            return row
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8135")
    args = parser.parse_args()

    for train in TRAINS:
        existing = find(args.base, train["title"])
        if existing:
            print(f"= {existing['ref']}  {existing['title']}  (already there)")
            continue
        created = call(
            args.base,
            "POST",
            "/api/thoughts",
            {
                "title": train["title"],
                "intent": train["intent"],
                "next": train["next"],
                "tags": train["tags"],
                "by": "hermes",
            },
        )["node"]
        print(f"+ {created['ref']}  {created['title']}")

        if train.get("state") and train["state"] != "active":
            call(args.base, "POST", f"/api/thoughts/{created['ref']}/state", {"state": train["state"], "by": "hermes"})
        for ref, note in train.get("sessions", {}).items():
            call(
                args.base,
                "POST",
                f"/api/thoughts/{created['ref']}/trail",
                {"kind": "session", "text": note, "sessionRef": ref, "by": "hermes"},
            )

    state = call(args.base, "GET", "/api/next")
    print("\nnext:", json.dumps(state.get("next", {}), indent=2)[:400] if state.get("next") else state)


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as error:
        raise SystemExit(f"door not answering: {error}")
