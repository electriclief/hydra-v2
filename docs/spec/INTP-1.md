# INTP/1 — Inter-Network Transaction Protocol
### Baseline: the ChatGPT draft (eight-part estate, ten principles). This is the Hydra revision.
### Status: proposal. No implementation exists. Names are placeholders — "do not name the baby".

---

## 0. What changed, and why

The baseline is right about the important thing: **transport, trust and authority are three different questions**, and
authority is the one existing architectures leave to administrators. It is right that a broker is an exchange point
rather than a trusted administrator, that it never executes, and that there must be many of them.

It is wrong, or silent, in six places that matter for how this fleet actually runs:

| # | Baseline says | Reality it misses | INTP/1 says |
|---|---|---|---|
| 1 | Reuse TLS/TCP for transport | Two home LANs behind the same ISP double-NAT cannot accept inbound connections at all | Transport is **outbound-only, store-and-forward**. A relay that both sides connect *out* to is the reference profile |
| 2 | Accounting tracks "fees, credits or Karma" | Karma is not currency: it is priority, never transferable, never cash | Karma is a **local priority signal**, not a ledger asset; there is no payment primitive in the protocol |
| 3 | Both networks authenticate their members | A Hydra LAN is explicitly **one user, zero security** inside | Authority is enforced **only at the edge** (door + broker). Interior trust is assumed and never relied on |
| 4 | "Requested operation" | An operation is unbounded and invites command semantics | Requests address a **Capability Manifest** entry (verb + schema + hash). Unknown capability = refusal |
| 5 | Lifecycle ends at RECEIPT | AI jobs run for hours or days; the network will ask "when?" fifty times | Lifecycle carries **QUEUED / PROGRESS / DEFERRED / CANCEL** with intermediate, signed receipts |
| 6 | Authorization is a permission set | Permissions that live forever are the failure mode | Authority is a **lease**: expiring, revocable by silence, renewable only while the work is observable |

Two additions the baseline lacks entirely: **payload secrecy from the broker** (it validates an envelope, not a
conversation), and **resumption** (a five-day render must survive a two-hour outage).

---

## 1. Model

Four planes, not three:

```
TRANSPORT   can we exchange bytes at all?          (relay, quic, store-and-forward)
TRUST       who signed this envelope?              (public keys, signatures, replay window)
AUTHORITY   may this principal ask for this thing? (leases, capability manifests, quotas)
CAPABILITY  what exactly is being asked?           (verb + schema + manifest hash)
```

The baseline folds CAPABILITY into AUTHORITY. That is the mistake that turns "may you run inference?" into "may you
run this string?" — the first is a policy question, the second is a shell.

**Actors**

```
principal     a person, node, agent or role. Identified by key. Not by name, not by IP.
node          one machine running Hydra. Publishes capabilities and state; owns its doors.
door          the only process on a node that speaks to the outside. All authority checks live here.
broker        an exchange point. Validates, mediates, records, delivers. Never executes, never routes.
directory     optional, replaceable, outside the transaction path. Answers "who offers X?" — nothing more.
```

**Objects**

```
CapabilityManifest  { node, capability, verbs[], schema, limits{meters}, hash, version, expires }
Request             { txid, from, to{pubkey|capability_id}, verb, payload_ref, meters_offered, lease_s, sig }
Offer / Counter     { txid, accept|reject|alternate{meters, window, node}, sig }
Lease               { txid, capability, meters_granted, not_after, heartbeat_s, sig }
Progress            { txid, done, total, eta_s, partial_ref?, sig }        ← signed, monotonic, resumable
Receipt             { txid, outcome, meters_used, artefacts{digest[], size}, at, sig }
Cancel              { txid, reason, sig }
```

`payload_ref` is a content address + symmetric key, sealed to the receiver. **The broker never sees the payload** —
only `{from, to, verb, meters, txid, digests}`. That is the practical form of "minimum necessary visibility": you
cannot log a conversation you cannot decrypt.

---

## 2. Lifecycle

```
REQUEST ──► VALIDATE ──► DECIDE ──► QUEUED ──► RUNNING ──► RECEIPT
                │           │           │          │
                │           ├─ COUNTER  │          ├─ PROGRESS (signed, repeatable)
                │           └─ REJECT   │          └─ DEFERRED (queue full / node asleep)
                └─ DROP (bad sig, stale, replay, unknown capability, over quota)
                                    └─ CANCEL (either side; lease dies with it)
```

Rules the baseline got nearly right and I am making hard:

- **VALIDATE** checks signature, replay window, expiry, capability exists **and manifest hash matches**, meters
  within the principal's remaining quota, and that the verb is in the manifest. No verb, no transaction.
- **DECIDE** is the receiver's decision, not the broker's. The broker may only refuse to carry.
- **QUEUED** must be explicit and carry a position and a `not_after`. Silent queueing is how "free AI service" turns
  into "unaccounted backlog".
- **PROGRESS** is mandatory while RUNNING. `minutes till they ask again` is a protocol field, not a social skill.
  Progress is a signed receipt: monotonic `done`, and `partial_ref` when artefacts exist mid-flight.
- **RECEIPT** states `meters_used`, artefact digests, and outcome. A receipt is a claim; the **sender verifies the
  digests independently** before believing it. Independent verification is the baseline's principle 7, applied to
  the accounting as well as the result.

---

## 3. Lease, not permission

```
LEASE = { capability, meters, not_after, heartbeat_s }
```

- Expires on the clock. Never renews implicitly.
- **Revocable by silence**: two missed heartbeats and the lease is dead; the work is cancelled by the receiver, not
  chased by the broker. This is how a node that is switched off stops consuming quota without anyone sending a message.
- Bound to a `txid` and a node, not to a principal session. One principal may hold many leases; they do not merge.
- A lease grants **meters on one capability**. It does not grant the node, the LAN or the model.

Consequence worth stating plainly: a stolen lease is a bounded loss — a declared quantity of one verb, until a time
you can read on a clock. It is not access.

---

## 4. Transport profile

The baseline assumes the internet's topology. Ours does not:

```
both LANs behind one ISP ──► no inbound ports ──► no listening broker ──► no direct connection
```

So the reference profile is **outbound-only relay**: both networks open one outbound connection to a rendezvous that
neither controls, and transactions travel as signed envelopes inside that channel. The relay is a *mailbox*, not a
participant: it cannot open the envelope, cannot initiate into either network, and cannot forge a receipt.

Properties that follow:

- **Store-and-forward.** A transaction survives one side being offline; the mailbox holds envelopes until ack.
- **Envelope, not channel, is the unit of trust.** Signature validity does not depend on the carrier — swapping
  Discord for a QUIC relay or an email gateway changes nothing above the transport plane.
- **Batching and rate are visible.** A relay that throttles you is a fact you can measure, and the protocol must
  report it rather than masquerade as slowness at the far end.

---

## 5. Accounting: karma is priority, not money

- Meters are declared and then **measured**: seconds, tokens, bytes, VRAM-minutes, artefacts.
- `meters_offered` (before) and `meters_used` (after) are both signed; a 10× overrun is a protocol violation, not a
  rounding error.
- **Karma is a local ranking of who gets served first when a node is busy.** It is not transferable, not convertible,
  not withdrawable, and it has no counterparty. There is no fee, no price, no escrow of value.
- Contribution is recorded as facts (`who gave what to whom, when, how much`) and each network scores locally. Two
  networks may score the same history differently, and that is correct — accounting is auditable, not universal.
- Freeloading is handled by **quotas and queue position**, not by charging.

---

## 6. Posture for a zero-security interior

Hydra's interior rule is "one user, zero security" — honest about a home LAN. INTP/1 therefore puts the entire
authority surface at the boundary:

1. **Every door is the perimeter.** A node's door refuses anything not in a manifest, regardless of who sent it.
2. **The interior is never trusted to check anything.** Internal services assume a trusted caller; the door is what
   makes that assumption survivable.
3. **Egress caps at the door** (bytes, connections, rate) so a permitted capability cannot become an exfiltration
   channel or an amplification reflector.
4. **No shell, structurally.** Doors speak declared verbs over HTTP. There is no code path from an envelope to
   `exec`, so "no arbitrary execution" is an absence, not a check.
5. **A compromised broker yields envelopes, not entry.** It can drop, delay, delay-and-replay (caught by txid
   window), and lie about results (caught by digests). It cannot reach into a LAN.

This is the baseline's principle 9 taken literally: failure isolation is a *topology* property, not a promise.

---

## 7. Governance

- **No mandatory broker.** Multi-broker by construction; any two brokers may transact if they can exchange envelopes.
- **Directory is replaceable.** Discovery is a separate, quotable service (a list of manifests, signed). Lose it and
  transactions by known capability still work.
- **Versioning**: `INTP/1` with manifest hashes so a node cannot be silently upgraded into a different verb set.
  Compatibility rule: unknown fields are ignored; unknown verbs are refused. Refusal is always safer than a guess.
- **Revocation**: keys, manifests and leases revoke by signed statement with a `not_after`; revocation propagates as
  a fact that each node applies locally.
- **Specification is public and vendor-neutral.** Hydra is one reference implementation. The protocol must be
  implementable by someone who has never heard of this fleet, or it is not a protocol, it is a config file.

---

## 8. What INTP/1 refuses to be

- Not a payment network. No fees, no credits, no tokens, no settlement.
- Not a routing layer. No addresses that imply reachability; no NAT traversal cleverness at the protocol level.
- Not a remote administration protocol. There is no verb whose meaning is "do this on that machine".
- Not a model API. The payload may be a prompt or a jpeg or a song; the protocol never inspects it.
- Not a promise of safety. A breach of one component must be insufficient to control another network — that is the
  whole ambition, and it is smaller and more honest than "secure".

---

## 9. v0 profile — the smallest thing that is still INTP

Deliberately narrow, so it can be built and falsified:

```
transport   one outbound relay channel (a Discord gateway is sufficient: it crosses double-NAT for free)
broker      one process, no federation, envelopes only, sqlite receipt log
verbs       SAY(text) → wav ; SUMMARISE(text) → text ; PING → {version, capabilities}
manifests   one per node, hashed, published in State
lease       single-use, ≤300 s, two-miss expiry
progress    required for any verb over 60 s
receipts    digest of every artefact
```

If v0 cannot carry `SAY` across two NATed LANs with a verifiable receipt and no inbound port, the rest of the
document is decoration.

---

## 10. Open questions (the ones I will not decide for you)

1. **Who computes karma?** One score per network (each scores locally), or a receipt-derived score that any third
   party can recompute? I lean recomputable: facts, not opinions.
2. **Are manifests the security boundary, or is a signed capability token per transaction?** Manifests are simpler
   and cache better; tokens bind one use. My default: manifests for discovery, short lease for use.
3. **Should a broker be allowed to *queue* on a sender's behalf?** Convenience versus visibility; my leaning is no —
   queueing is the receiver's act, and the receipt says so.
4. **What is the unit of cancellation when a node is switched off mid-render?** Artifacts resume from `partial_ref`
   or the whole transaction fails; a half-song is worse than no song, but a half *render* may be worth keeping.
