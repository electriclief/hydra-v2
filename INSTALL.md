# Installing a Hydra V2 node

Hydra V2 is not a product, and this is not a supported installer. It is the honest procedure for turning one
Windows machine into a node of a shelf that is still being built — and for keeping it current afterwards by
pulling from **github.com/electriclief/hydra-v2**.

Two commands do the work:

```
scripts\install-hydra.ps1 -Ref 149 -Name "149 - shop pc"     # from zero to a node that passes its gates
scripts\update-hydra.ps1  -DryRun                            # how far behind, then pull + restart
```

Everything below is what those two scripts do, so you can do it by hand when they fail.

## What a node needs

| | |
|---|---|
| OS | Windows 11 (the guard, the shelf paths and the task scheduler are Windows-shaped) |
| Node | 22 or newer — the doors are ESM and some use `node:test` |
| Git | Git for Windows, on PATH |
| PowerShell | 5.1 (bundled) is enough; 7 is nicer |
| GPU | optional. Mining, llama-server and the services all want one, but the doors run without |
| Access | the repo is **private**: the node needs credentials to clone (below) |

## 1. Get the code

The repo is private, so a bare `git clone` fails with `Repository not found`. Authenticate once, on the node:

```
gh auth login            # choose HTTPS; the device code is the quickest path
```

or use a read-only token in the URL for a headless node:

```
git clone https://<token>@github.com/electriclief/hydra-v2.git C:\AI\hydra-local
```

The path is **not** negotiable yet: doors, launchers and the guard all assume `C:\AI\hydra-local`. If you must
put it elsewhere, pass `-Dest` to the installer and expect to edit `start-hydra.cmd` and `scripts\standby-guard.ps1`.

## 2. Make it this node

One file says which node this is. It lives in the instance layer, never in a service definition:

```
module\Menu\data\node.json
{
  "ref": "149",                    // lowercase; the name other nodes will see
  "name": "149 - shop pc",
  "gpu": "Radeon RX 6800, 16 GB",
  "modelsDirs": {                  // where THIS box keeps weights, per service
    "llama-chat": "D:/llms"
  }
}
```

`ref` is what appears in `node.<ref>.*` on State, in the LAN view, and in every event. Pick it once.

## 3. Dependencies, build, gates

Each door has its own `package.json`; there is no monorepo install, deliberately — a door you never open
never installs anything.

```powershell
Get-ChildItem C:\AI\hydra-local\module -Directory | ForEach-Object {
  if (Test-Path (Join-Path $_.FullName 'package.json')) {
    Push-Location $_.FullName; npm install --no-audit --no-fund; npm run build; Pop-Location
  }
}
```

Then the gates — each module proves itself, and "green" is a number, not a mood:

```powershell
cd C:\AI\hydra-local\module\Scheduler;     npm run selftest    # 51 assertions
cd C:\AI\hydra-local\module\TrainOfThought; npm run selftest   # 63 assertions
```

## 4. Start it

```
cd C:\AI\hydra-local\module\Basic_App
"C:\Users\<you>\AppData\Local\hermes\node\node_modules\electron\dist\electron.exe" electron/main.cjs
```

or `start-hydra.cmd` for the headless variant (doors only, no window). The shell raises ProcessWrapper first,
then the other doors through it, then the guard as a declared watchdog. Nothing runs as a free console window.

Verify, in this order:

```
curl http://127.0.0.1:8125/health        ProcessWrapper  - every child process, with a stop button
curl http://127.0.0.1:8126/health        Event_Handler   - every happening, palette in data/palette.json
curl http://127.0.0.1:8127/health        State           - this node's branches
curl http://127.0.0.1:8132/api/statusline  the footer line, from real facts
curl http://127.0.0.1:8133/             Menu            - services, LAN view, bookings
curl http://127.0.0.1:8199/             help            - every door explains itself
```

Expect `no report` rows for other nodes: they only appear once those nodes publish, and they do not yet.

## 5. Keep it current

The node pulls. Nothing is pushed into it — a push is an invisible mutation on someone else's machine, and a
single bad push breaks every node at once.

```powershell
scripts\update-hydra.ps1 -DryRun     # local vs origin, and how many files differ, by module
scripts\update-hydra.ps1             # fast-forward, reinstall if a lockfile moved, rebuild, run the gates
scripts\update-hydra.ps1 -Restart    # ...and restart the shell so the new js is what is actually running
```

What it refuses, and why:

- **a dirty tree** — a pull over uncommitted work is a deletion nobody asked for; commit or discard first.
- **a non-`main` branch** — this node only fast-forwards `main`.
- **a fast-forward it cannot do** — it never merges or rebases; it stays put and says so.
- **running doors** — it warns instead of pretending: files on disk are not the code a live door is serving.

It writes what happened to `.shelf\git-update.json` (`from`, `to`, `files`, per-module counts), which is a report,
not proof. Proof is `git log` on the node.

**Rollback** is one command, because the previous revision is still in git:

```
git -C C:\AI\hydra-local checkout <previous-sha> -- .    # files back
scripts\update-hydra.ps1 -Restart                        # or restart the shell yourself
```

## What is still missing (so you don't go looking for it)

- **No installer for services.** A `service.json` declares an `install{}` block; nothing executes it yet.
- **No broker.** Talking to another household's LAN is a boundary in the design, not code.
- **No authentication, by design.** One user, zero security. Never expose these ports to the internet.
- **No data sync.** Sessions, jobs, thoughts stay on the node that made them; the shelf revision carries code
  and declarations only.
- **No Pages-from-`/docs` on the private repo** (Pages needs a public repo or a paid plan), which is why the help
  site lives separately at `electriclief.github.io/hydra-help` for now.
