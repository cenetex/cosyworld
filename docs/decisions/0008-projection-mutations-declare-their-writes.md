# ADR 0008: projection mutations carry their payload and declare their writes

- Status: Accepted
- Date: 2026-08-09
- Decision owners: CosyWorld maintainers
- Related: ADR 0003, #61, #255, #256

## Context

`ProjectionMutation` is the write API for the projection state that lives beside
the deterministic kernel. `RuntimeWorld` holds one kernel field, `world:
Box<CwWorld>`, and sixty-nine `BTreeMap`s of state the C world does not model —
clocks, tags, jobs, bonds, beliefs, routes, journeys, ledgers. Those maps must
survive journal replay and snapshot round trips, and per ADR 0003 they may lag
the kernel but must never contradict it.

`RuntimeWorld::apply_projection_mutations` is the interpreter for that API. It
had grown to 1,210 lines across sixty-six variants, and #256 was raised to split
it into per-variant handlers.

Measuring it first changed the diagnosis. Fifty-four of sixty-five arms already
delegate to named methods, so the extraction #256 described is largely done. The
length is not logic. It is the cost of destructuring a variant's inline named
fields and re-passing them positionally: a representative arm spends seventeen
lines to make one call. Splitting bodies out again cannot recover lines that the
call convention is spending.

Two further measurements shaped the decision. Coupling is rare — only three arms
touch more than one projection field, though `SetActorSafety` reaches from
safety flags into pending transfer offers and gift auto-accept policies, which
is invisible at the call site. And the interpreter takes seven positional
arguments, two of which are facts about the journal record rather than about the
runtime.

## Decision

Each `ProjectionMutation` variant carries a named payload struct that owns its
`apply`, and each payload declares the projection state it may write.

The enum stays closed, exhaustively matched, and applied in list order. No trait
object, no dynamic dispatch, no registration. `DeclaredWrites` is a compile-time
marker with an associated constant; it does not participate in dispatch. Replay
determinism under ADR 0003 depends on a total, statically known order, and a
subscriber registry would move part of that order out of the journal.

The interpreter's positional arguments collapse into one `ProjectionContext`.
The two record-derived flags become `RecordProvenance`, because
`allow_legacy_generated_identity_backfill` is `record.version <
JOURNAL_RECORD_VERSION` — a property of the record being applied, not a mode the
runtime is in. Live commits and replayed records take the same path.

Write sets are upper bounds, expressed in `RuntimeSnapshot` field names because
the snapshot is what a restart remembers, and they are **enforced rather than
trusted**. Handlers delegate through several layers, so a transitive write set
cannot be read off the source by hand. The test applies a mutation to a seeded
world, diffs the serialized snapshot, and fails if anything outside the
declaration changed — or if nothing changed at all, since a no-op fixture would
let a wrong declaration pass.

That enforcement earned its place immediately. `SetItemEquipped` was declared
against the item state it obviously touches; the check reported that it also
writes `actor_rules_facets`, `event_log`, and `next_event_seq`. Appending an
event is itself durable projection state, which every event-returning handler
does and no one would list by inspection.

Thirteen variants later that is no longer a surprise, it is the rule: **every
handler that returns events writes `event_log`, `next_event_seq`, and
`actor_rules_facets`.** It held for variants that touch no item and change no
object — `UnlockCharmSlot` and `UnlockCharmSlotForCharm` only append, and still
write all three. Declare them by default and let the check confirm; do not
rediscover them one batch at a time.

Two failure modes of the check itself are worth knowing, because both were hit
in practice. A fixture that changes nothing satisfies containment trivially, so
the harness rejects a no-op fixture rather than recording a write set no test
exercised. And declared keys are validated against the snapshot the fixture
*produced*, not a freshly seeded one: `RuntimeSnapshot` skips empty collections
when serializing, so a field that starts empty is absent from a seeded world's
JSON and a correct declaration naming it would be rejected as unknown.

A variant whose handler cannot produce a non-vacuous fixture therefore cannot be
verified at all. `SetJobStatus` and `LegacyAcceptQuest` are both left unreshaped
for that reason — the latter is an unconditional no-op by construction. An
unverified declaration is worth less than none.

## Consequences

`ProjectionMutation` is persisted inside `JournalRecord` under `#[serde(tag =
"kind")]`, so its JSON is a durable wire format. Internally tagged newtype
variants flatten their payload's fields beside the tag, so the encoding is
unchanged — but that is a property of serde's representation, not an obligation
it promises to keep. `reshaped_variants_keep_their_journal_encoding` pins the
exact JSON for every reshaped variant in both directions. A change that breaks
it breaks replay of every journal written before that change.

Reshaping is compiler-verified end to end: a variant's construction sites either
update or fail to build. That makes it a lower-risk operation than moving
handler bodies, which the compiler cannot check for behaviour. Work is therefore
sized by construction sites, of which there are 416 across sixty-six variants,
median four. Thirty-two variants have three or fewer.

This subsumes rather than precedes the remaining #61 queue. A payload struct and
its `apply` *are* the domain logic, so moving `SetTag` into `rpg/` and
`BankVisitLedger` into `economy/` is the same operation as splitting the match,
not a later stage. #61 lists "split the match", "RPG state", and "Economy" as
separate entries; they are one operation applied sixty-six times.

Grouping the sixty-nine `RuntimeWorld` fields into per-domain sub-structs stays
out of scope. It changes snapshot shape, and boot correctness is where the worst
outage of this system came from. It is also the change the accumulated write-set
declarations will inform: fields that are always written together belong
together, which becomes a query rather than an argument.

Adding a variant is currently the cheapest way to change projection state, which
is why this interpreter grew about thirty percent while #256 sat deferred. After
this change a new variant means a payload struct and a declared write set in a
domain module — priced like what it is, and landing where it belongs.

## Non-goals

- Reordering, merging, or deduplicating match arms. Order is behaviour.
- Changing what any mutation does.
- Dirty-region snapshotting. #481 already moved snapshot writes off the command
  path, so the full serialize is no longer in the latency path, and partial
  snapshots would add boot-merge complexity where this system is least
  forgiving.
- Partition declarations. Write sets are the input a fenced-ownership design
  would need under ADR 0003's horizontal gate, but production is deliberately
  single-writer and building for that now would be speculative.
