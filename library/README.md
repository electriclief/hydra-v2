# library/

Service definitions this node can offer, in a form another node can start from.

```
library/
  llama-chat/
    service.json        <- the definition, exported from this node's sandboxed service file
    help.html           <- the same page standard as every module (optional but expected)
```

## service.json is generated, never hand-edited

`node scripts/export-library.mjs` loads `module/Services/services/<name>.js` through the catalog's own sandbox
(data only, no execution), validates it, and writes the JSON. The file carries `library.sha256` — the hash of the
definition only — so a node that pulls a definition can prove it got the same one, and
`node scripts/export-library.mjs --check` goes RED if a library file drifts from the source.

Why the files are ~20 KB: the service's own inputs page rides inside the definition as a string. That is
deliberate — a definition that arrives without its page is a service nobody can run.

## What a new node does with it

1. read `service.json`
2. compare it with what is actually on disk here — models by `file` + `bytes` + `sha256`, software by provider
   `build`, space by `models[].vramGb`
3. say the honest result: `ready`, or `cannot — missing Bonsai-1.7B.gguf (2.1 GiB)` — never "should work"
4. copy it into its own `services/` only if the operator chooses

## The green dot

Status is never written into a library file. It is read:

- **green** — a node on the LAN publishes that service (`node.<ref>.services.<slug>`) and its `ready` is true;
  that includes a node reached through the broker, because the broker's advertisement is the same shape
- **amber** — a definition exists in the library and some node publishes it, but `ready: false`
- **grey** — the definition exists and nobody is offering it right now

That is why the library and the LAN view are separate things: the library is what this house *could* make, the
LAN view is what it *is* making. A green dot that came from a file would be a claim; a green dot that comes from
a heartbeat is a fact.
