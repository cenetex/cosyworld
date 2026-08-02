# ADR 0006: a wallet-optional core with an avatar-NFT-only bridge

- Status: Proposed
- Date: 2026-08-02
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

## Proposed decision

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
4. Every supported owned asset is rostered automatically. If room capacity is
   full, excess actors enter the offstage presence state; no second collectible-
   style join or materialize action is required.
5. The first automatic join writes one immutable asset-to-actor binding and one
   typed materialization receipt before the actor enters the world.
6. Reconnect, retry, refresh, and restart recover the same actor.
7. Disconnect, unlink, capacity pressure, transfer, or revocation changes
   roster/presence at a safe boundary; it does not delete canonical history or
   evade an active consequence.

## Compatibility and migration

Removal must not delete audit history or duplicate/lossily convert a live item
or actor.

1. Freeze new Box, keepsake, item/location NFT, wallet-gate, and item-
   materialization work while #681 is open.
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
  prove every supported owned avatar joins exactly once after wallet link.

The item bridge migration is tracked by
[#685](https://github.com/cenetex/cosyworld/issues/685). Productizing the avatar
bridge is tracked by [#688](https://github.com/cenetex/cosyworld/issues/688).

## Relationship to earlier decisions

If accepted, this ADR supersedes the item/location card, wallet-keepsake,
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
