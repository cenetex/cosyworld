# ADR 0010: semantic instruments shape recall, not history

- Status: Accepted design; implementation blocked on #725, which is
  authoritative wherever the two disagree
- Date: 2026-08-12 (revised 2026-08-13)
- Decision owners: CosyWorld maintainers
- Related: ADR 0003, ADR 0007, #693, #725, #728,
  `authoritative-room-message-resonance-v1`

## Context

[ADR 0007](0007-model-bindings-and-item-devices.md) settled the ontology: a model
that only embeds or reranks powers a "bounded semantic instrument" — an item, not
a resident. It names the shape of such a thing (a resonance compass, an echo
sorter) and gives every model-backed item an activation mode, where `equipped`
means "a typed equipment slot activates persistent settings or modifiers."

It did not say what such an instrument modifies. This decision answers that.

The runtime now has the retrieval half. Room-message resonance ranks earlier
visible lines against the latest one through a rerank or embeddings profile,
anchored to an exact `semantic_query_event_seq`, and refuses a query that cannot
name its position in the journal.

It also has the memory half, unused. Residents accumulate `entity_memories` with
per-atom `salience`, and hold `beliefs` carrying `confidence`, `salience`, and
`hops` — the last recording how far a belief travelled between residents. At the
time of this decision, recorded memory atoms are read essentially never: their
`use_count` is zero across almost every record. The world keeps a detailed
account of what each resident knows and consults it for nothing.

So retrieval exists and points at the transcript, while the durable memory it
could rank goes unread. The question is not how to build recall. It is what
should decide *whose* recall differs.

## Decision

A semantic instrument is an item that changes how its holder's memory is ranked.
It never changes what happened.

The canonical journal remains the single history. An instrument alters only the
projection of that history into one resident's recall: which memories surface,
in what order, and how many. Two residents who witnessed the same committed event
may recall it differently, and both are correct, because they disagree about
salience rather than about fact.

This keeps the split ADR 0003 depends on. There is one authoritative history and
no merge algorithm for divergent ones. Subjectivity lives strictly in the read
path.

### What an instrument may modify

| Surface | Permitted |
| --- | --- |
| Ordering of facts the holder can already reach | Yes |
| Result count | Yes |
| Recorded salience of an atom | Yes, as derived projection state |
| Which facts the holder can reach at all | **No** |
| Visibility class or confidence of a fact | **No** |
| Committed events, entity versions, world sequence | **No** |
| Whether an action is legal or an offer is dealt | **No** |
| Clocks, dice, possession, access, currency | **No** |

An instrument is a lens over the record. It is never evidence.

An earlier revision of this decision permitted an instrument to choose its own
candidate set. That was wrong. #725 makes visibility class an authoritative
property of a fact and requires that AI output cannot create, select, alter, or
increase the confidence or visibility of one. Choosing eligibility is choosing
visibility, so the instrument ranks strictly within what the holder already
holds and never decides what that is.

### Why the model may differ per holder

Two embedding models do not merely rank with different confidence; they define
different notions of resemblance. Equipping a different instrument therefore
changes what "reminds me of this" means for that resident, rather than applying a
recall bonus. Associative character follows from the binding instead of being
authored.

This is the intended mechanic. Instruments are chosen for their metric, not their
strength, and a coarse instrument is not a worse one.

### Reach is structural, not a checked rule

An instrument must not be trusted to respect visibility. It must be unable to
violate it.

`leos-c`, the holographic kernel in this codebase's sibling repositories, stores
pairs as a single superposed trace and recovers them by key:

```
M      = normalize( sum_i bind(k_i, v_i) )
v_hat_j = unbind(M, k_j)
```

With flat-spectrum keys, bind and unbind are near-perfect inverses, and without
the key a query returns noise rather than a value. Deriving a fact's key from its
holder and visibility class therefore makes reach a precondition of decoding
instead of a rule someone must remember to enforce. An instrument's candidate set
is exactly what its keys can unbind, which is why one resident's compass surfaces
different memories than another's: it holds different keys, not merely a
different metric.

That store is lossy by construction — fidelity falls as `1/sqrt(N)` in the number
of stored pairs — so it is an index and never a record. The journal remains the
one history. A degraded trace costs recall quality, never a fact, and rebuilds
from the journal exactly as a snapshot does. This is what makes the phrase "a
lens over the record" load-bearing rather than decorative.

### Determinism

A model must never be called during replay. Retrieval follows the rule already
established by room-message resonance: the model proposes a ranking, the ranking
is committed through the ordinary world-event path anchored to an exact event
sequence, and replay reads the committed ranking.

Consequently:

- An instrument declares a versioned device mechanics profile that binds an exact
  model identity, in the manner of the card-policy model hash and the pinned
  verifier profiles.
- Retiring or replacing a bound model never invalidates a journal, because no
  journal depends on the model — only on the ranking it once proposed.
- A retrieval that cannot name its query event sequence is refused rather than
  answered.

### Custody and provenance

An instrument is an ordinary item and inherits the whole item contract: one live
disposition, custody, transfer, activation, uses, and provenance. That yields the
following without new machinery.

- An instrument may be lent, traded, or lost. Handing over a compass hands over a
  way of remembering.
- An exhaustible instrument makes recall a resource rather than an ambient
  faculty.
- Provenance is meaningful. An instrument that belonged to another resident
  carries that resident's associations, so inheriting a lens is inheriting a
  sense of what mattered.

### What an instrument ranks over

This decision does not define the fact it ranks. #725 does, and the schema it
specifies — stable fact id, holder, authored or committed source, source actor on
transfer, visibility class, bounded confidence, claim key, and replay-reproducible
provenance — is the contract an instrument reads and never writes.

That contract has a working precedent. `shared/cargo_receipt.h` in the Signal
repository solves the same problem for cargo: a destination that only sees goods
arrive has no proof of what produced them, so the goods carry a signed receipt
chain instead. Each link binds subject, author, recipient, originating event, and
the hash of the prior link; verification checks every signature, checks every
prior-hash, and requires the chain to bottom out at a committed origin event. Its
stated goal is the property a fact needs most — the origin is "verifiable in
isolation … no need to read foreign logs at validate time."

Retyped from cargo to knowledge, that is rumour transfer: the author is the
resident who told you, the chain length is the `hops` already recorded on
beliefs, the cap is a bound on how far a rumour may travel, and a failed
verification refuses the transfer rather than degrading it. It makes "Rati told
me, and Rati was wrong" checkable without trusting Rati or reading her state,
which is what #728 asks for.

An instrument therefore ranks facts that already carry their own provenance. It
never supplies provenance, never repairs a broken chain, and never raises
confidence because a result ranked highly.

## Consequences

Recall becomes a scarce, transferable, characterful capability rather than a
uniform background service, and it does so by pointing existing retrieval at
existing memory through the existing item system.

Revisiting is worth something. A location already visited yields different recall
under a different instrument, which produces replayable content without authoring
new content.

Unreliable narration becomes available to a world whose defining property is one
authoritative history. The history stays canonical; access to it does not.

The cost is one more place where a model sits behind an authoritative commit, and
that path must stay honest: a proposal, validated and committed, never a direct
mutation.

## Non-goals

- Per-resident private histories, forked worlds, or any second source of truth.
- Defining the fact schema. #725 owns it; this decision consumes it.
- Storing authoritative state in a holographic trace. The trace is a lossy index
  rebuilt from the journal, never a record.
- Shipping before #725. An instrument ranking pre-contract memory would commit
  rankings over records #725 has bound itself not to reinterpret, which is a
  migration debt the contract exists to avoid.
- Instruments that gate legality, alter offers, or influence the card policy
  ranker. Ranking memory and ranking actions stay separate.
- Calling a model during replay, or any retrieval whose result is recomputed
  rather than read from the journal.
- Retiring room-message resonance. Ranking the live transcript and ranking
  durable memory are complementary; this decision adds the second rather than
  replacing the first.
