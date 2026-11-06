# Hydra V2 verb layer

## The gap
Every MCP tool today reads or registers. The verbs — run something, speak something, file something — are what an
agent actually needs, and none exist.

## The three
| tool | door | why |
|---|---|---|
| `fleet_run(service,node)` | Scheduler | installs if absent, starts, probes health, publishes, returns a runId |
| `tts_speak(text,voice,emotion)` | Services or its own | hides piper vs qwen3 vs chatterbox behind one call |
| `tot_file(intent,next)` | TrainOfThought | write an intention from any node, no session needed |

## Order
fleet_run first. The other two are thin once a runner exists, and tts_speak needs a decision about where the engine runs.
