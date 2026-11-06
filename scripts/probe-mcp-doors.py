#!/usr/bin/env python3
"""Probe every Hydra door's MCP surface and print what each one serves.

Use after any boot-table change, or whenever someone claims "MCP is online". A door that answers
/health can still have no /mcp, and a module the shell loads in-process has no door at all.

    python probe-mcp-doors.py                 # the default door map
    python probe-mcp-doors.py 8128 8129 8135  # just these
    python probe-mcp-doors.py --host 192.168.1.123

The MCP transport is streamable HTTP and may answer as SSE, so the body is unwrapped before parsing.
"""
import json
import sys
import urllib.error
import urllib.request

DEFAULT_HOST = '127.0.0.1'
DOORS = {
    8125: 'ProcessWrapper', 8126: 'Event_Handler', 8127: 'State', 8128: 'Services',
    8129: 'ResourceManager', 8130: 'Basic_App', 8131: 'Join', 8132: 'Scheduler',
    8133: 'Menu', 8134: 'SessionDiary', 8135: 'TrainOfThought', 8136: 'Core', 8137: 'Mirror',
}


def rpc(host, port, method, params=None, rid=1, timeout=8):
    body = {'jsonrpc': '2.0', 'id': rid, 'method': method}
    if params is not None:
        body['params'] = params
    req = urllib.request.Request(
        f'http://{host}:{port}/mcp', data=json.dumps(body).encode(), method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Accept', 'application/json, text/event-stream')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode('utf-8', 'replace')
    stripped = raw.lstrip()
    if stripped.startswith(('event:', 'data:')):
        for line in raw.splitlines():
            if line.startswith('data:'):
                raw = line[5:].strip()
                break
    return json.loads(raw)


def main(argv):
    host = DEFAULT_HOST
    if '--host' in argv:
        i = argv.index('--host')
        host = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    ports = [int(a) for a in argv if a.isdigit()] or sorted(DOORS)

    total = 0
    serving = 0
    for port in ports:
        name = DOORS.get(port, '?')
        try:
            res = rpc(host, port, 'initialize', {
                'protocolVersion': '2025-06-18',
                'capabilities': {},
                'clientInfo': {'name': 'probe-mcp-doors', 'version': '1'},
            })
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as exc:
            print(f'{port} {name:16s}  -     {type(exc).__name__}: {str(exc)[:60]}')
            continue
        if 'result' not in res:
            print(f'{port} {name:16s}  -     {str(res)[:60]}')
            continue
        server = res['result'].get('serverInfo', {}).get('name', '?')
        try:
            tools = [t['name'] for t in rpc(host, port, 'tools/list', {}, rid=2)
                     .get('result', {}).get('tools', [])]
        except Exception as exc:                      # noqa: BLE001 - report, never abort the sweep
            print(f'{port} {name:16s}  online {server!r}, tools/list failed: {exc}')
            continue
        serving += 1
        total += len(tools)
        print(f'{port} {name:16s}  online {server!r}  tools={len(tools)}')
        if tools:
            print('      ' + ', '.join(tools))

    print(f'\n{serving} door(s) serving MCP, {total} tool(s) total')
    return 0 if serving else 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
