# Player lexicon

CosyWorld uses different nouns for a choice, a collectible memory, access, a
collection reveal, and installed world content. Internal schemas retain their
stable `card_*`, `*_card_ids`, and `pack_*` fields; this glossary governs
player-facing copy, accessibility labels, and analytics names.

## Canonical concepts

| Concept | Player-facing noun | Ownership and authority | Lifecycle | Primary affordance |
| --- | --- | --- | --- | --- |
| A verb offered in the three-choice hand | **action** | The engine deals legal actions from authoritative room state. A player chooses one; it is not owned or collected. | Replaced after a choice or redeal. | Command-shaped action button in the hand; `data-player-concept="action"`. |
| An actor, item, or location representation in the collection | **keepsake** | A wallet or local collection may hold the representation. It can influence which actions appear, but never replaces the world entity. | Persists in the collection; up to three may be kept close. | Illustrated collection tile and details dialog; `data-player-concept="keepsake"`. |
| Permission to enter a gated place | **pass** or **access** | A mounted world pack declares the grant; a verified entitlement provider proves it. The kernel receives only allowed/denied movement. | Dormant if its consuming world pack is unmounted; does not alter world state. | Locked-place badge reading “pass required”; `data-player-concept="pass"`. |
| A revealable group of keepsakes | **bundle** | A verified Box receipt or trusted ownership feed associates the unopened bundle with an account. | Opened once; yields keepsakes and leaves a durable receipt. | Avatar Bundle tile and “open bundle” action; `data-player-concept="bundle"`. |
| Installable or mounted experience content | **world pack** | The shard composition owns the mount decision; wallet possession cannot mount code or content. | Installed, mounted, unmounted, and version-locked by operators. | World Library entry; `data-player-concept="world-pack"`. |

A **Box** keeps its proper name. It is the on-chain object consumed by the
receipted flow that creates an Avatar Bundle; it is neither the bundle nor a
world pack.

## Copy rules

- Use **action** in hand instructions, turn cues, and action accessibility
  labels. “Action card” is acceptable only in developer documentation that is
  explicitly discussing the deck/hand implementation.
- Use **keepsake** for collection tiles, entity art/details, and the “kept
  close” loadout. Owning a keepsake never means owning the shared entity.
- Use **pass** when the missing entitlement corresponds to a location. Use
  **access** when no player-facing pass representation exists.
- Use **bundle** for the one-time group revealed by the Box flow. Do not call it
  a pack in player copy.
- Use **world pack** in the World Library and content architecture. Do not use
  bare “pack” when a bundle could be meant.

The internal API remains compatible: `cards`, `card_id`, `required_card_id`,
`unopened_pack_ids`, `/nft/packs/open`, and related database names do not change.
Adapters may also continue to recognize legacy error text such as “card
required,” but new player-visible errors use this glossary.

## Accessibility and analytics

Interactive surfaces expose the same concept nouns through
`data-player-concept`. Analytics hooks use namespaced event names rather than a
generic `card.click` or `pack.open`:

| Event | Meaning |
| --- | --- |
| `action.select`, `action.confirm`, `action.redeal` | choose, confirm, or replace a hand action |
| `keepsake.collection.open`, `keepsake.open`, `keepsake.toggle` | inspect the collection, inspect a keepsake, or change the kept-close loadout |
| `bundle.open` | reveal one Avatar Bundle |
| `world_pack.library.open` | open the mounted World Library |

Pass requirements are currently read-only badges, so they expose a concept but
do not emit a click event. If a pass-purchase or claim flow is added, its event
namespace is `pass.*`.

## Five-task comprehension check

The UI copy contract answers these five tasks without relying on art or layout:

| Task | The player should choose or identify | Required cue |
| --- | --- | --- |
| Make the avatar do something now | an **action** | “Choose an action below” and action-labelled hand buttons |
| Inspect or keep a collected memory close | a **keepsake** | “your keepsakes,” “keepsake details,” and “keep close” |
| Explain why a school room is locked | a **pass** | “Ruby High: First Bell location pass required” |
| Reveal the contents produced by a Box | an Avatar **Bundle** | “open bundle” and “Opened avatar bundle” |
| Find or inspect mounted experience content | a **world pack** | the World Library count and world-pack entries |

Regression tests check all five cues together and reject the former ambiguous
phrases. A future moderated usability study can add human evidence without
changing these baseline nouns.

## Architecture relationship

This is the player-facing layer of
[ADR 0001](../../docs/decisions/0001-cards-are-entitlements.md). The ADR defines
world entity, external card, facet, and entitlement identity. This glossary
names how those records appear to players. World-pack compilation and API
fields are documented separately in [Worldpacks](worldpacks.md).
