# ADR 0011: reflective work runs in batch, off the tick

- Status: Accepted
- Date: 2026-08-12
- Decision owners: CosyWorld maintainers
- Related: ADR 0003, ADR 0010, `v2/docs/world-simulation.md`

## Context

CosyWorld's wider world changes through committed play and never through elapsed
wall time. Reads, speech, resident-only actions, process uptime, and time spent
offline do not advance the simulation. Residents are funded by a small attention
budget that accrues when a player commits a tick nearby and is spent when they
act.

That has an unusual consequence for inference cost. Because nothing decays while
the world waits, latency off the immediate conversation path is nearly free. No
clock runs down, no state goes stale, and no player is kept waiting by work that
happens between visits. Most games cannot say this.

The runtime does not yet exploit it. Inference is treated uniformly, one call at
a time, at interactive latency and interactive prices, including for work that
nobody is waiting on. Embedding and reranking in particular batch well by nature:
ranking many candidates or embedding many records is one request, not many.

There is also already a scheduled reflective pass. Avatar identity refinement is
scheduled rather than immediate, which establishes that some work about a
resident may legitimately happen outside their turn.

## Decision

Inference is divided by whether a player is waiting for it.

**Interactive work** stays on the request path at interactive latency: room
dialogue, and anything whose absence would leave a turn visibly unanswered.

**Reflective work** runs in batch, off the tick, and may take arbitrarily long:
memory consolidation, identity refinement, journal and thought composition, and
objective selection. Batch execution is the default for this class, and a
provider batch interface is preferred where one exists.

Reflective work is what a resident does while the world is stopped. It is
therefore the only resident activity that does not require a tick, and the
correct name for it is dreaming: it is not an event, produces no public history
by itself, and cannot be observed as having happened at a particular moment.

### The boundary that makes this safe

Reflective work may compute freely and may write derived projection state such as
recomputed salience, embeddings, consolidated memory atoms, and refined
description. It may not, by itself, advance the world.

| Reflective output | Path |
| --- | --- |
| Recomputed salience, embeddings, consolidated atoms | Derived projection state; no tick, no event |
| A proposed objective, promise, or intent | Ordinary validated commit through the world-event path |
| Anything affecting legality, possession, clocks, or currency | Forbidden as a batch output |

A batch job never mints history. Where reflection concludes something the world
should know, it produces a proposal that is validated and committed exactly like
any other AI proposal, and takes its sequence at commit time rather than at
compute time. Nothing in a journal may depend on when a batch ran.

This preserves replay. A batch result is either derived state, rebuildable from
the journal and therefore disposable in the manner of a snapshot, or it is a
committed event that replays like any other.

### Relationship to attention

Attention credits and batch capacity govern different things and must not be
conflated.

- Attention credits are earned from player presence and spent on acting. They
  bound what a resident may **do**.
- Batch capacity is offline and player-independent. It bounds what a resident may
  **think about**.

A resident with no credits may still consolidate memory. A resident with credits
and nothing reflected upon still acts. Reflection never grants the right to act,
and acting never requires a fresh reflection.

## Consequences

Per-resident reflective cost falls sharply. Consolidating one hundred residents
becomes one batched job rather than one hundred interactive calls, and batch
provider pricing applies on top. This matters directly: the system has already
been halted by an exhausted inference balance, and the reflective class is where
most avoidable spend sits.

Reflection gains room to be slower and better. Work that need not return in
seconds may consider more context, which is precisely the work — consolidation,
identity, objectives — where quality compounds and latency does not matter.

The cost is a second execution path with its own failure modes, and a rule that
must hold under pressure: a batch result that arrives late is still only a
proposal, and a batch result that never arrives must leave the world unchanged
rather than partially advanced.

## Non-goals

- Batching room dialogue or anything a player is waiting on.
- Batching the card-policy ranker. It is a small deterministic integer model on
  the turn path and is already effectively free.
- Wall-clock scheduling of world change. Batch decides when *thinking* happens,
  never when the world advances; consequential change still requires relevant
  committed play.
- Allowing a batch job to write authoritative state directly, under any latency
  or cost argument.
