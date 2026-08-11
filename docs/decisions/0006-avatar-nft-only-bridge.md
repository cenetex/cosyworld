# ADR 0006: a wallet-optional core with an avatar-NFT-only bridge

- Status: Accepted
- Proposed: 2026-08-02
- Accepted: 2026-08-09
- Decision issue: [#681](https://github.com/cenetex/cosyworld/issues/681)
- Removal migration: [#682](https://github.com/cenetex/cosyworld/issues/682)
- Avatar bridge: [#688](https://github.com/cenetex/cosyworld/issues/688)
- Decision owners: CosyWorld maintainers

## Context

CosyWorld currently has three concepts sharing one player-facing surface:

1. physical world actors and items owned by the canonical kernel;
2. cards that present actors, items, locations, actions, and spells;
3. wallet or local collection records called keepsakes, including Boxes,
   bundles, external entitlements, gated locations, and item materialization
   receipts.

The third concept adds wallet sessions, ownership feeds, chain verification,
burn and reveal flows, collection loadouts, gated access, and a second item
plane to the core runtime. It also makes *keepsake* mean both a collection
representation and, in current content and copy, a physical world item.

Avatar NFTs have a narrower and coherent world effect: a verified asset may
introduce one persistent character. The Project 89 pilot in
[#523](https://github.com/cenetex/cosyworld/issues/523) already proves this
shape for one Proxim8 without granting its owner direct actor authority.

## Decision

Make the default CosyWorld product wallet-optional and retain only an
avatar-NFT bridge.

- **Cards remain.** A card is a visual and interaction projection of
  authoritative world state. It is not a general owned asset.
- **World items remain.** Physical items continue to be scarce, transferable,
  equipable, craftable, usable, and replay-derived kernel objects.
- **The Journal is provenance.** Account identity plus canonical journal and
  world events remain sufficient for ordinary play and craft/item lineage.
- **Keepsake leaves the vocabulary.** New copy says *card* for presentation,
  *item* for a physical object, and *linked avatar* for an NFT-backed actor.
- **Supported avatar NFTs may join.** Linking a verified owning wallet resolves
  allowlisted avatar assets through a protected server-side adapter. Each asset
  binds idempotently to exactly one durable world actor and authored arrival
  location.
- **The actor is not the NFT record.** The kernel actor has canonical identity,
  history, bonds, advancement, presence, and inventory. The external asset is
  provenance and roster/custody evidence.
- **Ownership is not command authority.** The default NFT avatar is autonomous,
  following #523. A player-control model requires a separate decision.
- **Metadata is cosmetic.** Approved identity and appearance fields may be
  refreshed under policy. Rarity and metadata cannot author stats, actions,
  access, items, rewards, prompts, or pack ids.
- **Custody transfer preserves the actor.** The verified association follows a
  legitimate transfer while canonical played history remains intact.
- **Other NFT surfaces leave the core.** Box burn, bundle reveal, general
  keepsake collections, item/location NFTs, wallet-gated places, and collection
  item materialization are removed through a replay-safe migration.
- **The adapter stays optional.** The default composition and complete ordinary
  player loop boot with no wallet, chain, ownership-feed, or NFT configuration.
- **Media stays public.** Generated art attaches to a world subject or event.
  Funding never creates private ownership. The future of Orbs is a separate
  question within #681.

## Gameplay ownership boundary

| Asset | What a wallet proves | How it plays | What it never grants |
| --- | --- | --- | --- |
| Supported avatar NFT | One allowlisted asset may register or recover one durable linked actor. | The actor arrives through its worldpack threshold, acts through the ordinary action/resident pipeline, and keeps one canonical history. | Direct command authority, better mechanics, exclusive actions, rewards, or place access. |
| Item NFT | Nothing in the core product. | Items are physical world facts acquired, carried, equipped, traded, dropped, consumed, or lost through canonical play. | Item spawning, reclaiming, duplication, or wallet-derived power. |
| Location NFT | Nothing in the shared canonical world. | Places are discovered, established, changed, and remembered through world events and worldpack policy. | Access gates, rent, topology control, renaming authority, or exclusion. |

The player-facing promise is **link an avatar**, not *own a character*. The
wallet holder controls whether the adapter may associate the asset with their
account; the linked actor retains its own agency. Ordinary accounts and actors
remain fully playable without a wallet.

## Retained and retired concepts

| Retain | Retire from the core |
| --- | --- |
| Actor accounts and sessions | Wallet requirement for ordinary play |
| Allowlisted NFT avatar → actor bindings | General NFT/keepsake collection |
| Wallet link for supported avatar discovery | NFT item/location/pass mechanics |
| Journal/world-event provenance | Native transferable card ownership chain |
| Card-shaped action and entity presentation | Kept-close collection loadout |
| Physical world items and zones | Wallet/world item materialization bridge |
| Craft receipts and item lineage | Box burn and bundle reveal |
| Shared public media | Wallet-gated official-world continuity |
| Worldpack-authored actor templates | NFT metadata-derived mechanics |

## Avatar binding lifecycle

1. A player links a wallet through the existing signed challenge flow.
2. The server refreshes a protected ownership adapter; the browser cannot
   supply authoritative asset or collection membership.
3. Each allowlisted asset is matched to an authored actor profile and arrival
   location. Unsupported or ambiguous assets fail closed.
4. Every supported owned asset registers or recovers exactly one durable actor
   automatically. A newly registered actor enters through its authored
   threshold when presence permits; excess actors remain offstage. No second
   collectible-style join or materialize action exists.
5. The first accepted link writes one immutable asset-to-actor binding and one
   typed first-link receipt before the actor enters the world.
6. Reconnect, retry, refresh, and restart recover the same actor.
7. Disconnect, unlink, capacity pressure, transfer, or revocation changes
   roster/presence only at a safe boundary. It cannot interrupt an active
   consequence, delete canonical history, reset relationships, duplicate the
   actor, or teleport it for convenience.
8. A verified transfer changes the wallet association, not the actor. The new
   holder recovers the same actor, Journal, Bonds, advancement, and inventory.
   An unavailable, stale, or contradictory ownership feed freezes association
   changes and fails closed.

### Metadata and arrival items

- Network, collection authority, asset id, actor id, originating worldpack,
  actor template, first arrival, canonical name, and first-link facts are
  pinned at the accepted link.
- Only reviewed cosmetic appearance fields may refresh. External metadata
  cannot author prompts, personality, memory, stats, skills, actions, items,
  access, rewards, pack ids, or controller mode.
- A worldpack may give the actor one bounded authored arrival kit under the
  same budget as an ordinary authored arrival. The kit cannot derive from NFT
  rarity or mutable metadata. Once committed, every item is an ordinary world
  item that can be traded, lost, consumed, or stolen and cannot be respawned by
  the wallet.

## Compatibility and migration

Removal must not delete audit history or duplicate/lossily convert a live item
or actor.

1. Freeze new Box, keepsake, item/location NFT, wallet-gate, native transferable
   card-ownership, and item-materialization product work. Only safety,
   compatibility, archival migration, and the focused avatar adapter continue.
2. Preserve and generalize the focused Project 89 avatar materialization seam;
   do not move wallet data into the C kernel.
3. Inventory wallet links, ownership snapshots, burn/open receipts, item
   materialization receipts, external bindings, gated routes, UI, and tests.
4. Disable new item materializations before converting existing ones.
5. Convert each active materialized item into one ordinary world item, or return
   it to archival state, according to one typed migration receipt.
6. Preserve historical records as read-only audit data until a retention policy
   explicitly permits deletion.
7. Prove the default golden journey without the avatar adapter, then separately
   prove every supported linked avatar registers or recovers exactly once after
   wallet link.

The #682/#685 implementation completes steps 1 and 3–6, removes the public
routes/projections/UI and official access gates, preserves typed audit records,
and proves the wallet-free journey. Step 2 and the linked-avatar half of step 7
remain the focused #688 productization scope.

The item bridge migration is tracked by
[#685](https://github.com/cenetex/cosyworld/issues/685). Productizing the avatar
bridge is tracked by [#688](https://github.com/cenetex/cosyworld/issues/688).

## Relationship to earlier decisions

This ADR supersedes the item/location card, wallet-keepsake,
portable-item, Box/bundle, gated-access, and general native-ownership direction
in [ADR 0001](0001-cards-are-entitlements.md). It retains ADR 0001's useful
boundary: external provenance and presentation never replace canonical world
entities.

[ADR 0002](0002-action-hand-is-authoritative-state.md) remains authoritative.
Removing kept-close matching art makes its server-authored action-hand boundary
smaller. NFT avatar ownership does not alter action legality or ranking.

## Consequences

- Ordinary play becomes easier to explain and operate without discarding the
  avatar collections that can meaningfully populate the shared world.
- Avatar identity gets one global asset-to-actor invariant instead of a general
  portable card economy.
- World-item scarcity has one authority and no wallet/world bridge.
- Existing chain and wallet code requires deliberate archival migration, not
  immediate destructive deletion.
- A future item, location, pass, Box, or general collectible product requires a
  new decision and cannot silently reuse the avatar adapter.
