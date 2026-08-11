# Player lexicon

ADR 0006 accepts a wallet-optional core with one narrow external concept:
**linked avatar**. Cards present authoritative world state; items and locations
remain shared-world facts. New player copy does not call actor/item/location
cards owned keepsakes, does not reveal bundles, and does not describe wallet
possession as place access.

Historical schemas retain stable receipt and legacy ownership fields for
replay and moderation audit. Those implementation names do not define player
vocabulary or appear in ordinary state.

## Canonical concepts

| Concept | Player-facing noun | Ownership and authority | Lifecycle | Primary affordance |
| --- | --- | --- | --- | --- |
| A verb offered by the action controller | **action** | The engine derives legal actions from authoritative room state. A player chooses one; it is not owned or collected. | Replaced when room state changes; exactly two are dealt at a time. | Command-shaped button in the two-action hand; `data-player-concept="action"`. |
| The voluntary end-of-hand control | **Think** (ordinary) / **Pass** (focused turn) | The engine certifies the actor, scene/focus, state revision, and hand generation before accepting it. It is not an entitlement or a free redeal. | Consumes one turn, journals the next deterministic hand, and becomes stale when the scene changes. | Third hand control; `data-player-concept="pass"`. |
| A visual or interaction representation | **card** | A card projects an actor, item, location, spell, or action. It never owns or replaces its subject and cannot create authority from art or text. | Reprojects from canonical state; historical art/provenance may remain inspectable. | Illustrated subject/action surface; target `data-player-concept="card"`. |
| A supported NFT-backed actor association | **linked avatar** | A protected adapter verifies one allowlisted asset and binds it to one durable autonomous actor. Wallet custody grants association, not command authority, power, items, rewards, or access. | First link creates one binding; later links and transfers recover the same actor and history. | Linked-avatar roster/chronicle; target `data-player-concept="linked-avatar"`. |
| A physical thing in the shared world | **item** | Custody and location come from the canonical world. A wallet cannot spawn, reclaim, or duplicate it. | May be found, carried, equipped, traded, dropped, installed, consumed, lost, or stolen under world rules. | Item card/inspector plus exact world actions; `data-player-concept="item"`. |
| Installable or mounted experience content | **world pack** | The canonical world composition owns the mount decision. Wallet possession cannot mount content or grant access. | Installed, mounted, unmounted, and version-locked by operators. | World Library entry; `data-player-concept="world-pack"`. |
| The player-facing chronicle of a place | **Journal** | Canonical events remain world authority; the server deterministically groups meaningful outcomes for presentation. | Current context and open threads change with state; story history remains ordered and replay-derived. | Journal toggle and semantic history; `data-player-concept="journal"`. |

Access is explained through the fiction and exact world requirement: a key,
relationship, completed Job, represented permission, or mounted composition.
There is no wallet-owned location **pass** in the accepted target.

## Retired compatibility vocabulary

**Keepsake**, **bundle**, **Box**, and wallet **pass** are retired player nouns.
They may occur in immutable historical records, migration fixtures, or an
operator audit result, but not in current product copy, analytics producers,
accessibility concepts, routes, state projections, or worldpack requirements.

## Copy rules

- Use **action** in hand instructions, turn cues, and action accessibility
  labels. “Action card” is acceptable only in developer documentation that is
  explicitly discussing the deck/hand implementation.
- Use **card** for a visual or interaction representation. Never say that a
  player owns the represented resident, item, or location.
- Use **linked avatar** for a supported NFT-backed actor association. Prefer
  “link this avatar” and “this avatar joined the world”; never “materialize,”
  “mint,” “play as,” or “control” unless a later decision explicitly creates
  that authority.
- Use **item** for a physical world object. Custody is described with ordinary
  verbs such as carry, equip, give, trade, drop, install, consume, lose, or
  recover.
- Explain access with the exact world requirement. Do not use wallet, NFT,
  card ownership, or a generic pass as a substitute for world truth.
- Use **world pack** in the World Library and content architecture.
- Use **Journal** for the player chronicle. Its regions are current place, open
  threads, and story so far; it is not an event log or quest dashboard.
- Journal category labels come from the closed set **story**, **discovery**,
  **travel**, **search**, **relationship**, **growth**, **work**, **item**, and
  **consequence**.
- Never expose dotted event keys, source sequence numbers, payload delimiters,
  arrow movement, or “Something changed” as Journal copy.

The public API keeps card presentation (`cards`, `card_id`) but has no
`required_card_id`, Box/pack inventory, owned-card projection, NFT burn/open,
or collection-materialization route. Related database names remain unchanged
only where needed to replay and audit historical records.

## Accessibility and analytics

Target interactive surfaces expose the same concept nouns through
`data-player-concept`. New analytics use these namespaces:

| Event | Meaning |
| --- | --- |
| `action.select`, `action.confirm`, `action.pass` | choose, confirm, or Think/Pass through the two suggestions |
| `card.open` | inspect the presentation of one world subject |
| `linked_avatar.open`, `linked_avatar.link` | inspect or initiate the protected linked-avatar flow |
| `world_pack.library.open` | open the mounted World Library |
| `journal.open`, `journal.close` | open or close the player Journal |
| `journal.entry.expand` | reveal additive context for one Journal entry |

Legacy collection analytics remain readable but have no current producers.
Journal entries expose no raw event identity through accessibility labels.

## Six-task comprehension check

| Task | The player should choose or identify | Required cue |
| --- | --- | --- |
| Make the avatar do something now | an **action** | “Choose an action below” and action-labelled hand buttons |
| Inspect the person, thing, or place being shown | a **card** | the subject's name, kind, and inspectable world facts |
| Understand why a wallet-linked character appears | a **linked avatar** | “linked avatar,” its authored arrival, and its continuing chronicle |
| Explain why a route or room is unavailable | the exact world requirement | the key, relationship, Job, permission, or composition condition |
| Find mounted experience content | a **world pack** | World Library count and world-pack entries |
| Review what changed in the current place | the **Journal** | current place, open threads, and story-so-far outcomes |

The browser comprehension test covers these six target tasks and rejects the
retired collection vocabulary.

## Architecture relationship

This is the player-facing layer of
[ADR 0006](../../docs/decisions/0006-avatar-nft-only-bridge.md), which
supersedes ADR 0001's broader external-card, entitlement, and portable-item
product direction. World entities, physical custody, Journal events, and
worldpack composition remain canonical authority.
