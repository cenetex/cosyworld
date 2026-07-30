# Thresholds, trails, and the strict referee

**Epic**: [#586](https://github.com/cenetex/cosyworld/issues/586)

**Status**: Product contract accepted in
[ADR 0005](../decisions/0005-thresholds-trails-and-strict-referee.md).
Discovery authority v1 is specified by
[`discovery-authority-v1.schema.json`](../../v2/schemas/discovery-authority-v1.schema.json);
the shared Lead/Gate/Hazard/Pressure contract is specified by
[`threshold-descriptors-v1.schema.json`](../../v2/schemas/threshold-descriptors-v1.schema.json).
Player procedures and runtime enforcement remain dependency-ordered below.

## Shared model

Doors, containers, seals, traps, hidden passages, frontier tracks, and
chase-like scenes compose five small components:

| Component | Question |
| --- | --- |
| Discovery Slot | What bounded hidden truth may exist here, and what fixed result or table stocks it once? |
| Lead | What exact truth may this actor, expedition, or the world pursue? |
| Gate | What method permits this target to open, yield, or be crossed? |
| Hazard | What is telegraphed, what triggers it, and what follows? |
| Pressure | What makes relevant committed delay or repeated work consequential? |

Topology, legibility, access, and safety remain separate. AI receives only
certified visible facts and committed outcomes; it cannot choose truth,
methods, table rows, consequences, access, topology, or rewards.

## Player procedures

- **Scene notice** is free obvious sensory truth.
- **Notice** spends one turn on one unresolved broad sensory result.
- **Search** exhaustively examines one named local physical target.
- **Study** interprets an already perceived target.
- **Scout** pursues one exact geographic Lead from an Anchor or active foray
  and reveals the authorized next segment or target without moving.
- **Travel** performs movement through a revealed, accessible route.
- **Mark** creates a temporary expedition return cue.
- **Open** resolves one certified Gate method.
- **Take** transfers one revealed, accessible item after custody and capacity
  checks.

Reveal never implies Open, Take, or Travel.

## Product invariants

- No danger, no success roll.
- Telegraph every Hazard before dangerous commitment.
- No committed unchanged “nothing found” result.
- Stock hidden truth once; never reroll it through retry, reconnect, or model
  failure.
- Required discoveries have a finite Sign budget or deterministic fallback.
- Required progression preserves retreat, camp, aid, rescue, alternate-route,
  or recovery reachability.
- A cairn stabilizes a traversed return leg and may authorize later branching;
  it does not reveal forward topology, settle a place, provide shelter, grant a
  rest grade, or create sanctuary.
- Navigation stability, route familiarity, place settlement, shelter, and rest
  grade are independent state.

## Delivery order

| Order | Issue | Outcome |
| --- | --- | --- |
| 1 | [#587](https://github.com/cenetex/cosyworld/issues/587) | Product, vocabulary, compatibility, and migration law. |
| 2 | [#600](https://github.com/cenetex/cosyworld/issues/600) | Discovery Slot and deterministic stocking receipt. |
| 3 | [#588](https://github.com/cenetex/cosyworld/issues/588) | Lead, Gate, Hazard, Pressure, and Anchor descriptors. Shipped in 0.0.282. |
| 4 | [#589](https://github.com/cenetex/cosyworld/issues/589) | Kernel-owned conditional transitions. |
| 5 | [#590](https://github.com/cenetex/cosyworld/issues/590) | Custody, recovery, and route reachability proof. |
| 6 | [#591](https://github.com/cenetex/cosyworld/issues/591) | Concrete methods and consequence-first offers. Shipped in 0.0.286. |
| 7 | [#592](https://github.com/cenetex/cosyworld/issues/592) | Telegraphed method-aware Hazards. |
| 8 | [#601](https://github.com/cenetex/cosyworld/issues/601) | One discovery pipeline across Notice, Search, Study, and Scout. |
| 9 | [#593](https://github.com/cenetex/cosyworld/issues/593) | Bounded Pressure scenes and event rolls. |
| 10 | [#602](https://github.com/cenetex/cosyworld/issues/602) | Bounded item and location materialization. |
| 11 | [#594](https://github.com/cenetex/cosyworld/issues/594) | Perishable frontier Leads and forays. |
| 12 | [#595](https://github.com/cenetex/cosyworld/issues/595) | Fail-closed referee presentation packet. |
| 13 | [#596](https://github.com/cenetex/cosyworld/issues/596) | Worldpack validation and developer inspection. |
| 14 | [#597](https://github.com/cenetex/cosyworld/issues/597) | End-to-end door, chest/item, and marked-trail proof. |

Rest/fatigue numbers remain outside this epic. [#603](https://github.com/cenetex/cosyworld/issues/603)
must decide them before [#604](https://github.com/cenetex/cosyworld/issues/604)
implements them. Threshold and Scout work consumes that decision and may not
invent a parallel fatigue system.

## Compatibility gate

Current Scout is `scout_v1`: the journal stores legacy Search plus an
`explore_path` projection mutation that reveals one edge without movement.
Existing hidden-exit chance, route discovery/unlock, local Lead, loot, clock,
rest, cairn, and Scout records retain their exact historical meaning.

New work uses append-only procedure and descriptor versions. A migration may
project old state into the new inspector, but must not reroll hidden truth,
re-award a claim, add a consequence, change topology, or newly authorize
access. The complete field-by-field inventory is normative in ADR 0005.

## Definition of ready for downstream issues

A downstream issue may start only when all its listed predecessors are closed
and its implementation:

1. names the exact component and descriptor version it owns;
2. preserves the four-way topology/legibility/access/safety split;
3. records deterministic claim and replay evidence;
4. provides authored fallback presentation without AI;
5. proves no-null-commit, no-reroll, finite-required-discovery, and recovery
   reachability where applicable; and
6. keeps direct and inference-controlled action legality identical.
