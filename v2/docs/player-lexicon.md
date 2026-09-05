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
| A Location, Avatar, or Item in the current hand | **noun card** | A card chooses a thing, never a verb or target list. Selecting up to three nouns lets authoritative room state resolve one exact action sentence. | Replaced when room state changes; each noun queue is selected independently. | Illustrated noun card in the Story Hand; the resolved sentence appears below the hand. |
| The focused-card replacement control | **Think** | The engine certifies the actor, scene/focus, state revision, exact slot, slot generation, and replaced offer. It is not a whole-hand redeal. | Free once after entering a safe scene; otherwise consumes one turn. Only the chosen slot advances, and the certificate becomes stale when the scene changes. | Story Hand control; `data-player-concept="think"`. |
| A visual or interaction representation | **card** | A card projects an actor, item, location, spell, or action. It never owns or replaces its subject and cannot create authority from art or text. | Reprojects from canonical state; historical art/provenance may remain inspectable. | Illustrated subject/action surface; target `data-player-concept="card"`. |
| A supported NFT-backed actor association | **linked avatar** | A protected adapter verifies one allowlisted asset and binds it to one durable autonomous actor. Wallet custody grants association, not command authority, power, items, rewards, or access. | First link creates one binding; later links and transfers recover the same actor and history. | Linked-avatar roster/chronicle; target `data-player-concept="linked-avatar"`. |
| A physical thing in the shared world | **item** | Custody and location come from the canonical world. A wallet cannot spawn, reclaim, or duplicate it. | May be found, carried, equipped, traded, dropped, installed, consumed, lost, or stolen under world rules. | Item card/inspector plus exact world actions; `data-player-concept="item"`. |
| Installable or mounted experience content | **world pack** | The canonical world composition owns the mount decision. Wallet possession cannot mount content or grant access. | Installed, mounted, unmounted, and version-locked by operators. | World Library entry; `data-player-concept="world-pack"`. |
| The player-facing chronicle of a place | **Journal** | Canonical events remain world authority; the server deterministically groups meaningful outcomes for presentation. | Current context and open threads change with state; story history remains ordered and replay-derived. | Journal toggle and semantic history; `data-player-concept="journal"`. |

Access is explained through the fiction and exact world requirement: a key,
relationship, completed Job, represented permission, or mounted composition.
There is no wallet-owned location **pass** in the accepted target.

### Contextual group language

[ADR 0009](../../docs/decisions/0009-companies-ventures-formations-and-shared-travel.md)
defines Company, Venture, Formation, and detachment as authoritative design
identities, not additional permanent player nouns or navigation surfaces.
Ordinary copy uses **your party**, a Company's chosen name, **travel together**,
or the relevant vehicle card when the context is clear.

Target copy uses **party** only when authoritative Venture participation is
available. Co-present actors, friends, passengers, and crew are not called a
party merely because the client can see them. The current actor-scoped journey
treatment still says **Travelling party**; ADR 0009 records that wording as
provisional semantic debt, not authority that clients or new features may
depend on.

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

## Exploration action verbs

[ADR 0012](../../docs/decisions/0012-notice-search-and-scout-targets.md)
gives each exploration verb one target and one promise. These are actions, not
new nouns in the player vocabulary.

| Verb | Player target | Promise |
| --- | --- | --- |
| **Notice** | one nearby actor | reveal one new observable fact about that actor |
| **Search** | the current place or one named physical feature | reveal one new physical-evidence fact; never a route or actor profile |
| **Scout** | one geographic Lead or route | reveal the next authorized geographic step; never move |
| **Study** | one already perceived subject | reveal one new interpretive fact |

If no promised result exists, the server does not offer the action. Browser,
terminal, and agent/API clients use the same server-authored offer and exact
target. Obvious scene facts appear automatically; **Observe** and **Survey** are
not separate actions. Notice is repeatable when a new fact becomes eligible and
is never charged or refreshed by Rest.

The public API keeps card presentation (`cards`, `card_id`) but has no
`required_card_id`, Box/pack inventory, owned-card projection, NFT burn/open,
or collection-materialization route. Related database names remain unchanged
only where needed to replay and audit historical records.

## Accessibility and analytics

Target interactive surfaces expose the same concept nouns through
`data-player-concept`. New analytics use these namespaces:

| Event | Meaning |
| --- | --- |
| `action.select`, `action.confirm`, `action.think` | choose, confirm, or replace one focused Story Hand card |
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

## Item kind compatibility

Current authored item kinds are `potion`, `evolution`, and `trinket`.
A trinket is a physical item, with its own holder, location, and charges.
The runtime reads the historical `keepsake` spelling as a trinket. Saved
kernel value 3 stays stable. Current state uses `trinket`, and a resident's
attachment uses `attached`.

The generated Box route was retired after checking its callers. Current
cards use the generated card and avatar asset routes. The browser copy
check covers DOM text and accessible labels, including rescue details.
