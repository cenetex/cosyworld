# ADR 0013: player-established places last for the current world

- Status: Accepted
- Date: 2026-08-13
- Decision owners: CosyWorld maintainers
- Related: #289, #470, #471, ADR 0003, ADR 0005

## Context

The generated-place lifecycle asks a player to place a “lasting fixture,” but a
bundle-hash mismatch deliberately starts a new world epoch. The new world does
not restore actors, Bonds, completed Jobs, clocks, or generated places from the
prior epoch. Calling a fixture lasting without naming that boundary promises
more than the canonical world currently guarantees.

Three meanings were considered: durability for the current world, automatic
promotion into reviewed pack content, and restoration from a separate
cross-world authority.

## Decision

Player-established places are **world-scoped**. Establishment is a monotonic,
replay-safe ratchet for the life of the current canonical world. Ordinary
restart, snapshot recovery, journal replay, pack remount, and repeat visits do
not remove or un-establish the place.

A deliberate reseed begins a new canonical world. It removes the prior world's
generated places and fixtures from live authority. Historical journals and
operator archives may remain readable as records of the ended world, but they
are never silently rehydrated into the new world and grant it no topology,
access, building, item, or progression state.

Player-facing copy therefore uses **establish** and names the current-world
scope in explanatory text. The generic action must not promise an unqualified
“lasting fixture.” A pack may present the operation as **Build a cairn**, **Scan
the sector**, or another validated ritual under #471, while the shared detail
states:

> Establish this place in the current world. It survives return visits and
> restarts; a deliberate world renewal begins a new world.

“World epoch,” bundle hash, snapshot, and reseed remain implementation language
and do not appear in ordinary action labels.

## Rejected alternatives

### Automatic authored promotion

Rejected. A player action cannot write generated output into
`v2/content/official/**` or another mounted pack. Maintainers may separately
author a future pack version inspired by play, but that is a reviewed content
change with new pack-owned identity, not continuation of the live generated
entity.

### Cross-world restoration authority

Rejected. A second durable authority would have to decide which old topology,
items, actors, projects, and dependencies enter a new world. Restoring only the
fixture would create orphaned state; restoring the whole subgraph would turn a
reseed into an undeclared merge. Neither behavior exists, and no player-facing
promise depends on it.

## Compatibility and migration

- Existing generated-place journal and snapshot records replay unchanged inside
  their recorded world identity and epoch.
- Historical “lasting fixture” copy remains readable as historical copy; it is
  not reinterpreted as cross-world durability.
- New establishment records freeze the pack-authored ritual presentation and
  the current world identity/epoch.
- A future change to cross-world restoration requires a new ADR, an explicit
  migration authority, and new player-facing wording. It cannot reinterpret
  this decision.

## Consequences

- #471 can make establishment pack-authored while keeping one host-owned,
  world-scoped lifecycle.
- Within one world, damage, maintenance, dormancy, or forgotten beliefs never
  un-establish a place unless a later explicit lifecycle contract says what
  happens to the fixture. A reseed is outside that lifecycle because it starts
  a new world.
- Authored promotion and cross-world restoration are closed rather than hidden
  future requirements of establishment.
