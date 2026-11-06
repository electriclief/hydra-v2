"""Smoke the whole TrainOfThought API surface and print one line per route.

Runs against whatever --base you give it. Point it at a SCRATCH instance (its own --data dir) so a
smoke run never leaves test nodes in the real store; the script also asserts the failure paths
(cycle refusal, double claim, unknown route) because those are the ones a caller hits by accident.

    python scripts/smoke_api.py [--base http://127.0.0.1:8136]
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

passed = 0
failed = 0
rows = []


def call(base, method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        request.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode()
            return response.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, raw


def check(label, expected_status, actual_status, body=None, expect_code=None):
    global passed, failed
    okay = actual_status == expected_status
    if okay and expect_code is not None:
        okay = isinstance(body, dict) and body.get("error", {}).get("code") == expect_code
    rows.append((("ok " if okay else "FAIL"), label, expected_status, actual_status))
    if okay:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL {label}: expected {expected_status}, got {actual_status} {json.dumps(body)[:200]}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8136")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    status, body = call(base, "GET", "/health")
    check("GET /health", 200, status)
    print(f"health: {body.get('nodes')} nodes, sessions door up={body.get('sessions', {}).get('up')}")

    status, body = call(base, "POST", "/api/thoughts", {"title": "Smoke A", "intent": "first node", "next": ["do a"], "by": "smoke"})
    check("POST /api/thoughts (A)", 201, status)
    a = body["node"]["ref"]

    status, body = call(base, "POST", "/api/thoughts", {"title": "Smoke B", "intent": "second node", "next": ["do b"], "by": "smoke"})
    check("POST /api/thoughts (B)", 201, status)
    b = body["node"]["ref"]

    status, _ = call(base, "GET", "/api/thoughts")
    check("GET /api/thoughts", 200, status)
    status, _ = call(base, "GET", "/api/thoughts?state=all&q=smoke")
    check("GET /api/thoughts?state=all&q=", 200, status)

    status, body = call(base, "GET", f"/api/thoughts/{a}")
    check("GET /api/thoughts/<ref>", 200, status)
    check("GET /api/thoughts/<ref> carries session cards", 200, status if "sessions" in body else 0)

    status, _ = call(base, "PATCH", f"/api/thoughts/{a}", {"intent": "first node, edited", "by": "smoke"})
    check("PATCH /api/thoughts/<ref>", 200, status)

    status, _ = call(base, "POST", f"/api/thoughts/{b}/link", {"dep": a, "by": "smoke"})
    check("POST /api/thoughts/<ref>/link", 200, status)

    status, body = call(base, "POST", f"/api/thoughts/{a}/link", {"dep": b, "by": "smoke"})
    check("POST link that would close a loop", 400, status, body, "cycle")

    status, _ = call(base, "POST", f"/api/thoughts/{b}/unlink", {"dep": a, "by": "smoke"})
    check("POST /api/thoughts/<ref>/unlink", 200, status)

    status, _ = call(base, "POST", f"/api/thoughts/{a}/trail", {"kind": "note", "text": "smoke line", "by": "smoke"})
    check("POST /api/thoughts/<ref>/trail", 200, status)

    status, _ = call(base, "POST", f"/api/thoughts/{a}/state", {"state": "blocked", "by": "smoke"})
    check("POST /api/thoughts/<ref>/state", 200, status)
    call(base, "POST", f"/api/thoughts/{a}/state", {"state": "active", "by": "smoke"})

    status, _ = call(base, "POST", f"/api/thoughts/{a}/claim", {"by": "agent-one", "minutes": 5})
    check("POST /api/thoughts/<ref>/claim", 200, status)

    status, body = call(base, "POST", f"/api/thoughts/{a}/claim", {"by": "agent-two", "minutes": 5})
    check("POST claim while held", 409, status, body, "claimed")

    status, _ = call(base, "POST", f"/api/thoughts/{a}/release", {"by": "agent-one"})
    check("POST /api/thoughts/<ref>/release", 200, status)

    status, _ = call(base, "POST", "/api/cycle/tick", {"cycle": 1, "sessions": [{"ref": "410ac710", "fillPct": 94}], "by": "smoke"})
    check("POST /api/cycle/tick", 200, status)

    status, body = call(base, "POST", f"/api/thoughts/{b}/close", {"summary": "smoke closed this train", "by": "smoke"})
    check("POST /api/thoughts/<ref>/close", 200, status)
    check("close archives the node", 200, status if body["node"]["state"] == "done" else 0)

    status, _ = call(base, "GET", "/api/archive")
    check("GET /api/archive", 200, status)

    status, _ = call(base, "POST", f"/api/thoughts/{b}/reopen", {"by": "smoke"})
    check("POST /api/thoughts/<ref>/reopen", 200, status)

    status, _ = call(base, "GET", "/api/next")
    check("GET /api/next", 200, status)

    status, body = call(base, "GET", f"/api/thoughts/{a}/files")
    check("GET /api/thoughts/<ref>/files", 200, status)
    check("the folder path is reported", 200, status if body.get("folder") else 0)

    import os
    import tempfile

    probe = os.path.join(tempfile.gettempdir(), "tot-smoke-attach.bin")
    with open(probe, "wb") as handle:
        handle.write(b"x" * 1024)
    status, body = call(base, "POST", f"/api/thoughts/{a}/attach", {"path": probe, "by": "smoke"})
    check("POST /api/thoughts/<ref>/attach", 200, status)
    check(
        "attach reports a real mode",
        200,
        status if body.get("attached", {}).get("mode") in ("symlink", "junction", "hardlink", "pointer") else 0,
    )
    check("the attached file appears in the folder", 200, status if body.get("files") else 0)

    status, body = call(base, "POST", f"/api/thoughts/{a}/attach", {"path": "C:/nope/missing.bin", "by": "smoke"})
    check("attaching a missing path is refused", 400, status, body, "no_such_file")

    status, _ = call(base, "GET", "/api/handoff/410ac710")
    check("GET /api/handoff/<ref>", 200, status)

    status, _ = call(base, "GET", "/")
    check("GET / (html)", 200, status)

    status, body = call(base, "GET", "/api/thoughts/deadbeef")
    check("unknown ref is a 404 with a code", 404, status, body, "no_such_node")

    status, body = call(base, "GET", "/api/nope")
    check("unknown route is a 404 with a code", 404, status, body, "no_route")

    print()
    for flag, label, want, got in rows:
        print(f"  {flag}  {label:<52} {got}")
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
