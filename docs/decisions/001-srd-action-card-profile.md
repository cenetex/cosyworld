# ADR-001: SRD 5.2.1 Action-Card Profile

- Status: accepted for internal development; collectible policy superseded by ADR 0006
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
offer set. The finite two-card hand and certified Think/Pass are the only live
client action surface, as settled by ADR 0002; More and typed-command
reachability are superseded. A spell deck may limit prepared Magic effects,
but the server retains the full legal candidate set for legality and replay.

## Entity and item model

Avatar, Item, and Location remain the entity cosmology. Weapons, skill charms,
spells, containers, tools, consumables, and relics are Item roles. Skills are
not actions: an equipped skill charm supplies a modifier or an authored
specialist qualification to an otherwise legal check. Advancement unlocks
bracelet slots and never creates a charm.

The physical carried deck is constrained by item weight, item size, avatar
size and Strength-derived capacity, and equipped containers. Containers are
bounded and non-recursive: a stored container contributes no capacity.

## Card and ownership policy

[ADR 0006](0006-avatar-nft-only-bridge.md) supersedes the earlier broad
collectible policy. Cards present world actors, places, items, and actions;
they are not wallet access keys or a second item plane. Physical items remain
ordinary shard state, and every shared location is public regardless of wallet
ownership.

The only supported NFT bridge is an allowlisted avatar adapter. Verified
ownership may register or recover that linked actor, but it grants no command
authority, power, item, reward, or location access. Historical item
materialization receipts remain readable for audit and cannot create new live
items.

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
