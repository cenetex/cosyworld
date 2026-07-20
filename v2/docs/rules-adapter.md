# CosyWorld rules adapters

## Current state

The official world selects `cosyworld.srd5/1`, compiled through
`cosyworld.rules/2`, as its active bounded action profile. The C kernel and
narrowly validated journaled reducers remain the execution authorities; rules
JSON, card prose, AI, and clients cannot mutate world state directly.

The independent SRD 5.1 and SRD 5.2.1 reference packs continue to use
`cosyworld.rules/1`. They are separately attributed reference/import data and
never overlay each other or the active profile.

## Pack contract

A `kind: "rules"` pack declares a stable `rules_adapter`, namespace, resource
files, and attribution. Adapter 1 accepts immutable `conditions` and
`monster_seeds`. Adapter 2 adds:

- stable actions and product/operation bindings;
- abilities, skills, item roles, equipment profiles, and bounded magic effects;
- a conformance row for every action; and
- explicit variants and namespaced extensions.

Every executable mapping declares `kernel`, `projection`, or `unsupported`.
Resources remain scoped by pack and namespace. Missing source references,
attribution, resolvers, replay fixtures, or conflicting identities fail the
worldpack gate and runtime startup.

## Authority boundary

In the reference packs, `reference_only` is authoring context and cannot apply
statistics or prose as truth. Only `Unconscious` maps to the existing
`CW_CONDITION_UNCONSCIOUS` flag; the other conditions and monster seeds remain
reference-only.

The active profile's executable resources name already implemented kernel or
projection contracts. They do not create a bypass around those contracts. The
kernel supplies normal/Advantage/Disadvantage checks, Bloodied state,
nonlethal knockout, card zones, item transfer, bounded Magic, theft, and
`cosyworld.combat/4`. Rust supplies validated project, discovery, cooperation,
loadout, materialization, and progression reducers.

## Active SRD action profile

`cosyworld.srd5/1` defines all twelve SRD 5.2.1 action identities. Attack,
Dodge, Help, Influence, Magic, Ready, Search, Study, and Utilize have tested
resolvers. Dash, Disengage, and Hide are explicitly unsupported and produce no
offers. Each supported action's conformance row records legal targets,
safe/risky behavior, event outputs, CosyWorld deltas, and a real replay fixture.

Core and expansion packs may contribute a presentation reskin, contextual
offer, explicit tested variant, or namespaced extension. The compiler rejects
implicit overrides and load-order winners. Profile, variant, and extension
identities are stored in worldpacks, snapshots, offers, and journal rows.

## Product boundary

CosyWorld does not adopt SRD classes, subclasses, spell-slot progression,
encounter-building math, XP, tactical grids, or automatic monster blocks.
Player-facing text remains CosyWorld language. This is a documented compatible
subset, not a full Dungeons & Dragons implementation.

Weapons, skill charms, and spells are Item-card roles. A charm's skill and
bonus apply only while that instance is possessed and equipped; advancement
opens bracelet space but never creates the charm. Prepared spell cards supply
bounded Magic effects. Weight, size, avatar capacity, and equipped containers
determine carried-deck legality. Empty bags may be stored in another bag but
never contribute recursive capacity.

See [combat-system.md](combat-system.md),
[action-pack-authoring.md](action-pack-authoring.md), the
[action architecture](../../docs/systems/04-action-system.md), and the
[implementation ledger](../../docs/backlog/srd-action-card-foundation.md).
