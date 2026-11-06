# An installer executes a service.json install block

Depends on the schema node: without a mechanical `verify` per step there is nothing to decide on.

## The open boundary
Two shapes, and the answer is the whole design:
- agent-driven: the agent runs the steps, the door records claims, evidence and closes. Nothing new can touch
  another machine. True today, and how every install so far actually happened.
- door-driven: the door shells out locally and over SSH. A queued install then runs with nobody watching, and
  the door becomes the first thing on this LAN that can touch other machines.

## The invariant either way
A step passes only with evidence attached (sha256, exit0, version, health, file listing). A job closes only
with every step passed and a sentence saying why. Blocked is a real state - "needs the operator" is not a failure.
