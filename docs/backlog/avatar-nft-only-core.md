# Avatar-NFT-only core grooming

Status: proposed product simplification. No destructive implementation work
begins before [#681](https://github.com/cenetex/cosyworld/issues/681) is
accepted. Removal/isolation is tracked by
[#682](https://github.com/cenetex/cosyworld/issues/682), and the retained avatar
bridge is tracked by [#688](https://github.com/cenetex/cosyworld/issues/688).

## Recommendation

Keep the parts that make CosyWorld a world, plus one narrow external bridge:
supported NFT avatars join the shared world when their verified owning wallet
is linked.

The core consists of accounts, avatars, shared places, physical items, cards as
presentation, action offers, Journal history, jobs, delivery, crafting,
resident autonomy, generated public media, and deterministic replay. A wallet
is never required for ordinary play.

The NFT bridge supports actors only. It does not support keepsake collections,
kept-close loadouts, Boxes, bundles, item or location NFTs, wallet-gated places,
or item materialization. A beautiful card can represent a shared person, place,
spell, or item without becoming a privately owned token.

## Product boundary

| Surface | Recommendation | Reason |
| --- | --- | --- |
| Cards | Keep as non-ownable UI projections | They make actions and world state legible. |
| Physical items | Keep and deepen | They drive scarcity, delivery, equipment, crafting, and stories. |
| Journal provenance | Keep as authority | It records who did what and why. |
| Supported avatar NFTs | Keep through an isolated adapter | One verified asset can coherently introduce one persistent actor. |
| Wallet link | Keep only for avatar discovery/custody | It is optional and never gates ordinary play. |
| NFT metadata | Cosmetic allowlist only | It cannot safely author mechanics or prompts. |
| Orbs | Decide separately | Shared-art funding can survive without collectible ownership. |
| Keepsake collection | Remove | It duplicates card/item language without adding core play. |
| Kept-close loadout | Remove | It is cosmetic client matching with vocabulary and UI cost. |
| Box/bundle flow | Remove | It adds irreversible wallet operations unrelated to the shared-world loop. |
| Item/location NFTs | Remove | They create pay-for-access/power pressure and duplicate world authority. |
| Item materialization | Disable and migrate | It creates a second item plane and global uniqueness burden. |

## Avatar NFT contract

- A protected server adapter, never browser claims, verifies network,
  collection authority, asset id, metadata, and current owner.
- One allowlisted asset maps to one stable actor id and one first-
  materialization receipt.
- The actor arrives at a worldpack-authored threshold or entry location.
- Repeated wallet links recover the same actor; they never create a clone.
- The actor is autonomous by default. NFT custody supplies provenance/roster
  authority, not arbitrary commands.
- Custody transfer preserves canonical actor history and updates the verified
  owner association.
- Approved metadata may affect sanitized name and appearance only.
- Rarity and metadata never improve stats, action economy, damage, access,
  rewards, items, resident priority, or AI authority.
- Disconnect/unlink can move an actor offstage only through an explicit safe-
  boundary policy. It does not delete the actor or evade consequences.
- The default composition and golden journey pass with the adapter absent.

## Groomed issue map

| Issue | Priority | Purpose |
| --- | --- | --- |
| [#681](https://github.com/cenetex/cosyworld/issues/681) | P1 / now | Accept the avatar-NFT-only product boundary. |
| [#682](https://github.com/cenetex/cosyworld/issues/682) | P1 / next, blocked | Remove keepsake/item/location NFT surfaces and isolate the avatar adapter. |
| [#688](https://github.com/cenetex/cosyworld/issues/688) | P1 / next, blocked | Productize supported NFT avatars joining on wallet link. |
| [#683](https://github.com/cenetex/cosyworld/issues/683) | P0 / now | Prevent actor/item art funding before the full review path is available. |
| [#684](https://github.com/cenetex/cosyworld/issues/684) | P1 / next | Match causal delivery jobs to the actual delivered resource. |
| [#685](https://github.com/cenetex/cosyworld/issues/685) | P1 / now | Retire item materialization without duplicating live items. |
| [#686](https://github.com/cenetex/cosyworld/issues/686) | P2 / later | Decide bounded item progression/attunement/enchantment. |
| [#364](https://github.com/cenetex/cosyworld/issues/364) | Existing backlog | Route actor/item/location art through the correct worldpack media profile. |
| [#523](https://github.com/cenetex/cosyworld/issues/523) | Completed pilot | Proves one Proxim8 joins exactly once as an autonomous actor. |

## Recommended sequence

### 0. Stop extending the broad collectible model

- Do not add new Box products, item/location NFTs, wallet-gated official
  places, collection mechanics, item card bindings, or native ownership-chain
  work.
- Fix only correctness, data-safety, and compatibility defects in the item
  bridge while the decision is open.
- Continue focused avatar-NFT work only through the actor materialization seam.

### 1. Accept the boundary

- Decide #681 and move ADR 0006 from Proposed to Accepted or Rejected.
- Record automatic exactly-once roster for every supported owned asset; room
  capacity sends excess actors offstage rather than adding a second join step.
- Decide whether Orbs remain for shared art; that should not block removal of
  the broad collectible model.
- Publish the player vocabulary: *action*, *card*, *item*, *linked avatar*,
  *Journal*, and *world pack*. No *keepsake* or *bundle* in new copy.

### 2. Productize the avatar adapter

- Generalize the Project 89 pilot into an allowlisted collection/profile
  registry without moving wallet facts into the kernel.
- Prove actor identity, arrival, autonomy, custody transfer, offstage policy,
  replay, and metadata restrictions.
- Keep adapter failure independent from ordinary account/avatar recovery.

### 3. Disable and migrate the removed surfaces

- Hide kept-close, collection, Box, bundle, item/location NFT, wallet-gate, and
  item-materialization controls.
- Reject new item materialization before migrating existing receipts.
- Preserve one world item per active receipt through an idempotent migration.
- Make legacy wallet and receipt data read-only, then remove runtime
  dependencies only after replay and restore drills pass.

### 4. Remove compatibility code

- Remove core routes, fields, configuration, provider polling, chain RPC,
  browser code, fixtures, and smoke paths not needed by the avatar adapter.
- Retain only the focused wallet challenge, ownership adapter, actor binding,
  custody, and audit surfaces required by supported avatar collections.

## Item direction after keepsakes

Removing keepsakes should make physical items more important, not less.

- An item has one location/holder and one authoritative zone.
- Equipment supplies typed, bounded effects; it does not rewrite arbitrary base
  stats.
- Crafting transforms authored templates through capable places and durable
  receipts.
- Delivery proves custody, movement, destination, and the requested resource.
- Art is cosmetic and follows item/worldpack identity.
- Any future enchantment is a closed recipe or attunement transformation, never
  an NFT trait or generated free-form modifier; see #686.

## Documentation status

Until #681 is accepted, existing wallet/NFT documentation remains useful as a
description of the live compatibility surface. It is not an invitation to add
new product scope. `ECONOMY.md`, `ENG.md`, `PRD.md`, the player lexicon, and the
traveler guide point here so current behavior and proposed direction are not
confused.

## Exit criteria

- [ ] The default/core composition starts with no wallet, ownership feed, NFT,
      Box, collection, or chain configuration.
- [ ] A new ordinary player completes the first-session and golden-journey
      paths without encountering keepsake, bundle, NFT, or materialization
      concepts.
- [ ] Linking a wallet makes every supported NFT avatar join according to the
      accepted roster policy, exactly once per asset.
- [ ] Cards remain useful presentation; world items retain full physical and
      mechanical behavior.
- [ ] Existing live materialized items are neither lost nor duplicated.
- [ ] Historical receipts remain auditable under the accepted retention policy.
- [ ] No official place, action, stat, item, image, or progression path depends
      on external asset ownership.
