# Hydra V2 launcher (this node: 192.168.1.123)

Desktop shortcut **Hydra V2** → `C:\AI\hydra-local\relaunch-hydra.cmd`
Icon: `C:\AI\hydra-local\hydra.ico` (H monogram on charcoal, three shelf rules)

## What a click does

1. logs the click to `logs\relaunch.log`
2. checks `:8130` (the app's own door)
   - answering → the window adopts the live doors (nothing restarts)
   - down → the window raises all of them
3. launches `electron/main.cjs` and waits up to 45 s for `:8130`
4. logs what actually happened, not what was hoped for

A second click is harmless: `main.cjs` holds a single-instance lock, so it focuses the open window
instead of starting a rival stack.

## Expected state after a cold click

    :8125 ProcessWrapper   :8127 State     :8128 Services   :8129 ResourceManager
    :8130 Basic (in app)   :8131 Join      :8132 Scheduler  :8133 Menu
    :8126 is NOT a listener on this node — the Event_Handler runs in-process inside the shell.

Measured here: cold (nothing running) → app ready in ~9 s; warm (window open) → instant.

## Ground rules learned on this box

- **Runtime is borrowed from Hermes**: `%LOCALAPPDATA%\hermes\node\node_modules\electron\dist\electron.exe`.
  Reinstalling Hermes can move it — the launcher checks and refuses loudly rather than failing silently.
- **Never call `timeout` for the wait loop.** With no console input handle it exits instantly, which turns
  a 45-second wait into 45 instant tries and a false "FAILED" in the log. `ping -n 2 127.0.0.1` always waits.
- This node binds **loopback**; Jim's laptop binds `0.0.0.0` (LAN-open). Same app, different posture.
