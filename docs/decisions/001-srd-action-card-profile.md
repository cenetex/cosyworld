# ADR-001: SRD 5.2.1 Action-Card Profile

- Status: accepted for internal development
- Date: 2026-07-19
- Profile: `cosyworld.srd5/1`
- Source rules: System Reference Document 5.2.1
- Adapter: `cosyworld.rules/2`

## Decision

CosyWorld uses a bounded, explicitly versioned subset of SRD 5.2.1 as its
default action substrate. This is not a claim of full Dungeons & Dragons
compatibility. The profile adopts stable identities for Attack, Dash,
Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study, and
Utilize, and reports each identity as implemented or unsupported.

The existing SRD 5.1 and 5.2.1 `cosyworld.rules/1` packs remain immutable
reference/conversion inputs. The active profile is a separate pack so selecting
it cannot silently reinterpret an older bundle, journal record, or snapshot.

## Projection CCG

The action hand is a deterministic ranked projection of the complete legal
offer set. It suggests cards; it does not grant legality. More and typed
commands must keep every legal ordinary action reachable. A spell deck may
limit prepared Magic effects, but no draw may gate movement, communication,
Search, Study, Help, Utilize, or another ordinary legal action.

## Entity and item model

Avatar, Item, and Location remain the entity cosmology. Weapons, skill charms,
spells, containers, tools, consumables, and relics are Item roles. Skills are
not actions: an equipped skill charm supplies a modifier or an authored
specialist qualification to an otherwise legal check. Advancement unlocks
bracelet slots and never creates a charm.

The physical carried deck is constrained by item weight, item size, avatar
size and Strength-derived capacity, and equipped containers. Containers are
bounded and non-recursive: a stored container contributes no capacity.

## Collectible power policy

The official shard permits collectible cards to be cosmetic, access keys, or
earned/equip-budgeted mechanical items. Purchasing or importing a card cannot
grant advancement, bracelet slots, automatic success, extra turns, or
exclusive best-in-slot numerical power. Core remains complete and free without
a wallet or NFT.

An account entitlement is not a shard-local item. Materialization,
unmaterialization, transfer, and theft require durable server-authored receipts
or journaled operations. Owning a location or resident card never grants edit
or signing authority over the shared location or resident.

## Pack compatibility

Core and every world, campaign, catalog, or asset expansion must declare the
rules profile it targets. Reskins may change presentation only. Contextual
offers bind existing actions. Variants and extensions must be namespaced,
versioned, justified, compatible with the selected profile, and included in
world/snapshot identity; load order never decides a rules conflict.

## Exclusions

The profile does not adopt SRD classes, levels, spell lists, encounter budgets,
rest cadence, death rules, or the complete equipment economy. Unsupported
actions remain visible in profile reports but cannot generate offers.
CosyWorld's sanctuary invariants, nonlethal bounded combat, Visit Ledger,
Bonds, Callings, Orbs, and shared-world turn rules are explicit product deltas.

## Licensing and product language

Adapted resources preserve source version, section/reference, license,
attribution, transformation, and modification status. Marketing must not use
compatibility language beyond the compiled attribution/profile report until a
license and product-name review is recorded. Internal development against the
properly attributed CC BY source is permitted by this decision.

## Consequences

- Unknown profiles, unknown action ids, supported actions without resolvers,
  implicit rules overrides, and mechanical reskins fail closed.
- Snapshot and journal identity includes the selected profile and active
  variants/extensions.
- Friendly labels may change without changing action identity or outcome.
- Historical action codes and journal meanings remain append-only.
