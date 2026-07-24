# SRD-Backed Action and Collectible System

## Status

This document defines the implemented SRD action-card foundation for CosyWorld
V2. The official world selects `cosyworld.srd5/1` through
`cosyworld.rules/2`; the separately attributed SRD 5.1 and 5.2.1 source packs
remain immutable references under `cosyworld.rules/1`.

The profile uses Creative Commons-licensed **System Reference Document 5.2.1
(SRD 5.2.1)** identities as a tested subset for ordinary actions while keeping
CosyWorld's setting, progression, economy, shared-world model, and cozy safety
rules. Attack, Dodge, Help, Influence, Magic, Ready, Search, Study, and Utilize
are supported. Dash, Disengage, and Hide are explicit exclusions. The
[implementation ledger](../backlog/srd-action-card-foundation.md) records the
acceptance evidence and the separate legal-review gate for marketing claims.

## Decision

> **SRD supplies the verbs; collectible cards supply the nouns.**

An action card is not a second rules engine. It is a contextual offer to apply
an established rule action to a collectible or world subject:

```text
rules action + source/target collectible + scene context = action offer card
```

Examples:

- `Search` + Moonlit Trail location + hidden pawprints = **Follow the prints**
- `Study` + Old Oak avatar + damaged rings = **Read the broken year**
- `Utilize` + Wolfprint Charm item + echo barrier = **Hold up the charm**
- `Attack` + equipped practice sword + Moonlit Echo = **Cut through the echo**
- `Help` + another avatar + shared route project = **Take the other end**

This keeps the collectible layer interesting without making every card author
invent and balance a new verb.

## Why SRD 5.2.1

SRD 5.2.1 is the default foundation because it is mature, recognizable,
licensed under CC BY 4.0, and broad enough to cover exploration, social play,
items, magic, and conflict. CosyWorld should use its rule identities and
resolution expectations rather than copy every subsystem into the product.

This is not a promise of complete Dungeons & Dragons compatibility. Classes,
subclasses, encounter-building math, spell-slot progression, tactical grids,
and the full monster catalogue remain outside the default profile unless a
future version adopts them explicitly. “Based on SRD 5.2.1” must always mean a
versioned, documented subset with CosyWorld deltas, never an ambiguous claim
that all fifth-edition rules apply.

## The Action Ontology

SRD 5.2.1 defines these general actions:

| Stable rules action | What it does in CosyWorld |
| --- | --- |
| `srd5.2.1:attack` | Make an attack using the authoritative combat profile. |
| `srd5.2.1:dash` | Gain additional movement when movement allowance matters. |
| `srd5.2.1:disengage` | Move away without the normal consequences of engagement. |
| `srd5.2.1:dodge` | Focus on avoiding attacks until the action's duration ends. |
| `srd5.2.1:help` | Assist another creature's task or an eligible attack. |
| `srd5.2.1:hide` | Attempt to become hidden where the scene permits it. |
| `srd5.2.1:influence` | Attempt to change an NPC's attitude or willingness to help. |
| `srd5.2.1:magic` | Cast a spell, use a magic feature, or use a magic item as specified. |
| `srd5.2.1:ready` | Prepare an action with an explicit perceivable trigger. |
| `srd5.2.1:search` | Use perception and intuition to find something concealed. |
| `srd5.2.1:study` | Use knowledge and reasoning to recall or discover information. |
| `srd5.2.1:utilize` | Use a nonmagical object for more than a trivial interaction. |

Not every player operation is one of these twelve actions. The protocol must
keep separate domains so that a friendly label never silently changes rules:

| Domain | Examples | Treatment |
| --- | --- | --- |
| Rules actions | Search, Study, Utilize, Help, Attack | Resolve through the selected rules profile. |
| Movement | Travel, ordinary movement, crossing an exit | Use movement and access rules; Dash and Disengage may modify it. |
| Communication | Say, emote, ordinary player speech | Turn-exempt and free unless the player is trying to influence an NPC. |
| Object transfer | Take, Give, Trade | Inventory and ownership operations, not Utilize by default. |
| Procedures | Rest, initiative, equipping a loadout | Versioned procedures with their own contracts. |
| Cosy advancement | Chat, Remember, Evolve, bank a Visit Ledger | CosyWorld progression outside the SRD action economy. Chat spends advancement to begin a friendship. |
| Interface/meta | Look, inspect a card, report, open a menu | Never consumes a rules action. |

### Product-language mapping

Core and expansion packs may use warm, setting-specific labels, but every
mechanical offer declares its stable identity:

| Current/product wording | Stable meaning |
| --- | --- |
| Listen, Notice, Tune In | Search, normally using Wisdom. |
| Inspect, Investigate, Recall | Study, normally using Intelligence; use Search when perception is decisive. |
| Scout, Scope Out | Search or Study followed by movement, not a new universal action. |
| Travel, Head To | Movement through a legal exit. |
| Chat | Spend one banked advancement point to begin a friendship with an eligible nearby resident; absent when that growth option is unavailable. |
| Say | Ordinary moderated room communication; Influence only when changing attitude or cooperation is at stake. |
| Use | Utilize for a nonmagical object; Magic for a spell, magic feature, or magic item. |
| Work | A contextual Study or Utilize offer that advances an eligible project. |
| Help | The Help action, with the assisted actor or project named. |
| Defend | Dodge in the current combat profile. |
| Flee | Disengage plus movement when engagement rules apply; the bounded current combat protocol calls this Escape. |
| Prepare | Ready only when it names a trigger and response; otherwise a CosyWorld extension. |
| Rest | The selected rest procedure, not a general action. |

The compiler should reject a label that omits its mechanical binding. A reskin
may change `label`, `detail`, art, and narration; it may not change costs,
targets, checks, effects, or timing.

## Cards Are Offers and Playable Things

The default CCG-like experience is a **projection CCG**:

1. The server determines every legal rule action and world operation.
2. It combines those actions with the scene, equipped collectibles, visible
   subjects, jobs, clocks, and access grants.
3. It ranks a small hand of contextual action offers.
4. The browser renders those offers as cards with art from their source or
   target collectible.
5. A player can still reach every legal action through More/commands even when
   it is not in the suggested hand.

Random draws must not decide which ordinary actions are legal. A future mode
where a player can act only through drawn cards would add deck construction,
draw timing, dead hands, card advantage, and a new balance economy. That is a
separate namespaced rules variant, not an incidental UI change.

Spell cards are the deliberate exception to the no-draw default. A **spell
deck** can determine which owned Magic effects are prepared or currently in a
player's spell hand, because the deck is the source of those effects. A poor
spell draw may remove a particular spell choice; it must not remove ordinary
movement, communication, or SRD actions such as Search, Study, Help, and
Utilize. The initial spell deck may simply be a deterministic prepared loadout;
random draw, discard, exhaust, and refresh rules require an explicit profile.

### Implemented action-offer envelope

Server `action_offers` carry a stable rules binding, source collectible,
target, contribution trace, resolver, and state revision:

```json
{
  "offer_id": "offer:5000:search:...",
  "kind": "search",
  "rules_action": "srd5.2.1:search",
  "operation": null,
  "rules_profile": "cosyworld.srd5/1",
  "resolver": "discovery_search_v1",
  "label": "Follow the prints",
  "source_collectible": {
    "kind": "location",
    "instance_id": 3,
    "card_id": "location-moonlit-trail",
    "pack_id": "cosyworld.core"
  },
  "target": {"kind": "feature", "id": 3, "label": "Moonlit pawprints"},
  "state_revision": 42,
  "disabled": false,
  "composition_trace": {
    "rules_profile": "cosyworld.srd5/1",
    "rules_pack_id": "cosyworld.rules-profile-srd5",
    "rules_pack_version": "1.0.0",
    "source_card_instances": [
      {"kind":"location","instance_id":3,"card_id":"location-moonlit-trail","pack_id":"cosyworld.core"}
    ],
    "target": {"kind": "feature", "id": 3, "label": "Moonlit pawprints"},
    "applied_variants": [],
    "active_extensions": [],
    "applied_reskins": ["cosyworld.core:moonlit-follow-prints"],
    "contextual_offers": ["cosyworld.core:moonlit-search"],
    "resolver": "discovery_search_v1",
    "state_revision": 42
  }
}
```

The client may format or sort this envelope but may not infer the rules action,
resolver, cost, target, ownership, or availability from the label or artwork.

## Collectible Nouns and the Item-Card Lingua Franca

CosyWorld's world cosmology has three entity nouns: **avatar, item, and
location**. A skill, weapon, or spell is therefore not a fourth entity kind. It
is a role and rules binding carried by an item card.

The common interaction is “play an item card”:

- playing or equipping a **weapon card** supplies the equipment profile for an
  Attack offer;
- wearing a **skill-charm card** on a bracelet supplies its skill bonus to an
  eligible ability check;
- playing a **spell card** from the prepared spell deck supplies a bounded
  Magic effect; and
- playing a tool, relic, or consumable supplies its Utilize or Magic effect.

This reuses the same inventory, artwork, provenance, trade, theft, loadout, and
action-card UI instead of adding separate skill trees, spell books, and weapon
panels.

Collectibility and world authority are related but distinct:

| Collectible | What the card can represent | Authority boundary |
| --- | --- | --- |
| Location | Discovery, travel access, art, a route or scene-specific offer | Owning a card does not let a player rewrite a shared location. |
| Avatar | A playable avatar, resident facet, relationship hook, or art/provenance | Owning a resident card does not grant control of the shared NPC. |
| Item | An entitlement to materialize, equip, gift, or use an item profile | Account ownership is not the same as a shard-local world item. Materialization must be journaled and idempotent. |
| Weapon item | An equipped or played profile that qualifies or shapes Attack offers | The kernel derives the attack; the client or art never supplies damage. |
| Skill-charm item | A physical skill and bonus worn in a bracelet slot, such as a lucky raven feather that grants `+1` to an eligible skill check | The skill and bonus belong to the charm instance and apply only while the actor possesses and equips it. |
| Spell item | A card prepared or drawn from a spell deck that supplies one bounded Magic effect | It requires implemented targeting, timing, use, recovery, and resolver rules; prose alone has no authority. |

### Skill charms

The SRD action remains generally attemptable with an ability check. A charm
represents learned technique: it adds its authored bonus when the check calls
for that skill, and some specialist tasks may explicitly require an equipped charm.
There is no independent avatar skill inventory in the target model.

Advancement can unlock **bracelet slots**; it does not create a charm or increase
one automatically. Deck & Loadout offers `Make room for <Charm>` only when every
current slot is occupied, that specific eligible unworn charm is carried,
advancement is available, and the slot cap has not been reached. A second active
skill therefore requires both an earned second slot and finding, earning,
crafting, receiving, trading for, or stealing the charm.
Rare skills can therefore remain rare world objects. If a charm is gifted,
traded, dropped, or stolen through an authoritative action, its skill, bonus,
and provenance travel with it and the former holder loses access. Character
creation may grant a common starter charm instead of writing an innate skill
step directly onto the avatar.

Rarity and power budget are separate fields. Rarity can describe provenance,
difficulty of discovery, art, or unusual applicability; it must not implicitly
mean a larger unbounded modifier. Theft also needs a real risky resolver,
visibility/possession rules, and recovery consequences—moving a card in browser
state is never sufficient.

### Playable-item contract

Every mechanical item card needs the same small contract: item role, stable
rules action or check modifier, equip/hand slot, target predicate, resolver
descriptor, skill bonus or effect budget, uses/exhaustion/recovery, transfer/theft
policy, and instance provenance. The server turns that contract into action
offers; the client never executes card text.

## Collection, Deck, Hand, and Card Zones

The runtime uses an authoritative multi-card collection and deck model with
clear zones:

| Zone | Meaning |
| --- | --- |
| Collection | Every card instance the account owns, including cards not carried by the active avatar. |
| Carried deck | The item cards the avatar physically brings into play. Legality is derived from item weight/size, avatar carrying capacity, and equipped containers—not a fixed card count. |
| Equipped | Persistent active cards in typed slots: bracelet charms, weapon, armor/tool, and similar roles. |
| Spell deck/hand | Prepared spell cards and, under a declared draw profile, the currently playable subset. |
| Action hand | Contextual server-authored offers produced from base rules, scene nouns, deck, and equipped cards. It is not itself the ownership ledger. |
| Exhausted/discard | Temporarily unavailable item/spell cards with explicit recovery rules. |
| World | A card instance materialized as a shard-local item at a location or in an avatar's possession. |
| Escrow/transfer | A temporary authoritative zone used for an atomic gift, trade, or theft resolution. |

Every move between zones names the card instance, actor/account, source zone,
destination zone, reason, and idempotency key. The server validates capacity,
ownership, possession, access, and timing before journaling it. A client must
never represent deck construction as a comma-separated item field or infer
ownership from a rendered card.

## Scene Composition Contract

A scene is not a new ownership zone and it is not a client-side shuffle. It is
the deterministic, inspectable projection produced when a player's active
cards meet the cards and rules currently present at a location.

The composition inputs are:

1. the selected base rules profile and kernel invariants;
2. the current location card, room sheet, features, exits, clocks, conditions,
   and location-scoped rules contributions;
3. visible resident/avatar cards and materialized world-item cards;
4. the active avatar's carried deck, equipped loadout, prepared spell cards,
   conditions, Calling, Bonds, and eligible Journal state; and
5. access grants and pack contributions that are valid for this shard and
   player.

These inputs produce two different outputs:

| Output | Contract |
| --- | --- |
| Legal action set | Every currently legal rules action and operation, with source, target, resolver, cost, risk, and disabled reason. This is the authoritative superset. |
| Action hand | At most three ranked suggestions projected from the legal action set, plus free browsing/shuffle. Absence from the hand never makes a legal core action illegal. |

Composition never moves a card between ownership zones. Entering a room can
make an equipped charm relevant, make a carried key usable, expose a resident
as a target, or add a location-authored Search offer; it cannot give the player
the room card, duplicate the key, or equip anything on their behalf.

### Merge and precedence

Composition is field-aware, not “last pack wins”:

1. Kernel invariants and sanctuary/safety rules cannot be overridden.
2. The named rules profile supplies base action semantics.
3. Location-scoped variants may change only the fields declared by their
   versioned delta contract.
4. Source cards contribute qualifiers, modifiers, targets, and presentation
   through typed fields; prose and artwork have no mechanical authority.
5. A more specific contextual offer may reskin or bind a base action but does
   not erase the base action unless a validated rule explicitly makes it
   illegal.
6. Conflicting contributions at the same precedence fail compilation or scene
   construction with an inspectable error; source order never decides truth.

Every emitted offer records a composition trace: rules profile, contributing
pack/version, source card instances, target subject, applied variant ids,
resolver, and the state revision used to build it. Submission revalidates that
trace against current authoritative state. A stale composition returns a
refreshable conflict and performs no partial mutation.

### Recomposition triggers

The server recomposes after location entry/exit; card-zone transfer; equip,
unequip, prepare, draw, exhaust, or recovery; visible actor/item arrival or
departure; relevant clock/condition/access change; rules-profile or pack
change; and any committed action whose receipt declares affected composition
inputs. A cosmetic-only change may reuse the same mechanical composition
identity.

For two clients observing the same actor, state revision, rules profile, pack
set, and shuffle seed, the legal action set and ranked hand are identical.
Replay stores the profile and contribution identities needed to reproduce the
mechanical result; it never depends on current pack order or live AI output.

### Scene-composition invariants

1. The action hand, carried deck, spell hand, and physical hands are distinct
   concepts in schemas and player copy.
2. Location composition grants relevance and targets, never ownership.
3. Removing or transferring a contributing card removes its offer or modifier
   on the next state revision.
4. A paid entitlement cannot contribute progression, automatic success, an
   extra turn, or power beyond the free/core-equivalent budget.
5. A client cannot create an offer by naming a card it does not possess or a
   location contribution that is not active.
6. The inspector can explain why every offer exists, why an expected offer is
   absent, and which recomposition trigger changed the hand.

### Carrying capacity is deck size

Each item profile declares weight and a size/bulk class. The selected SRD
profile supplies the base carrying calculation from the avatar's physical
abilities and size; CosyWorld declares any container delta explicitly. The
carried deck is legal only when total weight is within capacity and every item
fits its containing bag, sheath, case, bracelet, or other holder.

Locations may contain multiple loose item cards. Dropping, revealing, or
crafting one item does not evict or block another merely because both occupy
the same room; the action hand groups their Take choices instead. Capacity is
an avatar/container concern, not a one-card location limit.

Bags and similar item cards can extend usable capacity. A container declares
its own weight, additional capacity, opening/maximum item size, allowed roles,
and access cost. Container rules must prevent recursive capacity exploits: a
bag stored inside another bag contributes no capacity until equipped, and an
item instance can have exactly one containing zone. Changing Strength, losing
a bag, or stealing it triggers an encumbrance check and a deterministic choice
or fallback for excess cards; it never silently deletes them.

Bracelet slots are advancement rewards. Carrying capacity is instead derived
from the avatar plus physical container cards. Cards are acquired separately
through play and ownership, which keeps “I can wear one more skill” distinct
from “I found the rare raven-feather charm,” and “I found a larger bag” distinct
from both.

## Player Shell and Menu

The scene and its action hand remain the primary play surface. Account, world,
Orbs, identity, and utility pages are consolidated behind one **Menu** entry.

The Menu contains:

- **Deck & Loadout** — carried/current/max weight, size or container conflicts,
  bags, bracelet slots, equipped weapons/tools, spell deck/hand, exhausted
  cards, and validation warnings;
- **Collection & Account** — owned cards, rarity/provenance, gifts/trades,
  expansion entitlements, and account recovery;
- **Sign in / Identity** — native identity, optional wallet bridge, sessions,
  and delegated agents;
- **World & Packs** — current shard, map, installed packs, gates, and profile;
- **Journal & Export** — Visit Ledger, public history, provenance, and journal
  export/import tools;
- **Orbs** — balance, earn/spend history, and amplification controls; and
- **Settings & Help** — accessibility, audio/media, commands, and rules profile.

A compact identity or Orb balance may remain visible as status, but it links
into Menu rather than opening another competing top-level subsystem. Deck
editing is a first-class page, not a modal hidden inside the one-button hand.

Mechanical collectibles must preserve the RPG bible's progression invariant.
On the official shard, a collectible rules binding must be one of:

- cosmetic or narrative only;
- an expansion-scoped access key;
- an earnable sidegrade with a free/core-equivalent acquisition path; or
- balanced through public equip slots and a budget without increasing the
  maximum attainable power available through play.

Paid ownership may never grant Visit Ledger marks, bracelet slots, automatic
success, extra turns, or an exclusive best-in-slot number. Mechanical charms,
weapons, and spells must be earned in play or have a free/core-equivalent
acquisition path. Rarity can make them desirable and socially valuable without
making payment the source of rules power.

## Pack Extension Contract

Packs may contribute to the action system in four explicit ways:

1. **Reskin** — presentation-only vocabulary and art for an existing offer.
2. **Offer** — a contextual source/target instance of an existing rules action.
3. **Variant** — a declared delta to an existing rule for a named profile.
4. **Extension** — a genuinely new namespaced mechanic with its own resolver.

Variants and extensions are allowed because packs should be able to innovate,
but they carry a higher proof burden. Each must declare:

- its namespace, version, and `based_on` rules profile;
- the exact changed rule fields or new resolver contract;
- a player-facing rationale and compatibility statement;
- deterministic merge order with no implicit override;
- replay and snapshot identity;
- schema, resolver, fixture, and invariant tests; and
- required attribution and a record of modified CC-licensed material.

Core is a pack too. It can say “Listen” instead of “Search,” but it does not get
an undocumented exemption from the binding and validation rules.

## Authority and Replay

SRD authority does not mean JSON bypasses the kernel. It means the selected
SRD profile defines the semantics that the C kernel and Rust projection agree
to enforce. Any state-changing effect still travels through the authoritative
kernel or a narrowly validated, journaled projection reducer.

Durable action codes and historical event meanings are append-only. Migration
must introduce a new action/rules protocol version and map legacy product kinds
to stable identities at the boundary. It must never reinterpret an old journal
record as a different action. Snapshots record the worldpack identity, rules
profile, and extension set used to produce them.

## Gap Analysis Closure

| Area | Implemented state | Deliberate residual boundary |
| --- | --- | --- |
| Rules authority | `cosyworld.srd5/1` under `cosyworld.rules/2`, startup validation, `/meta`, inspector, and exact conformance coverage. | SRD reference text remains non-executable; unsupported actions stay absent. |
| Vocabulary and offers | Stable bindings, operations, authoritative envelopes, deterministic legal set/hand, source/target traces, and stale/tamper rejection. | Friendly labels remain pack presentation. |
| Collectible binding | Item roles, physical zones/capacity, empty-storage-only bags, charms/slots, weapon profile, spell deck/exhaustion, receipts, theft, and provenance. | Broader armor, spell, and equipment catalogs require future authored contracts. |
| Pack composition | Reskin/offer/variant/extension schemas, mutation/conflict gates, exact deltas, fixtures, precedence, inspector output. | No implicit or load-order override path exists. |
| Player shell | One Menu, Deck/loadout/Collection pages, materialize/return controls, terminal parity, server validation. | UI polish can evolve without changing rules. |
| Licensing/provenance | Source/version/reference fields, compiled attributions, machine-readable modified-material report, and traceable offers. | Product-name/marketing claims still require independent review. |
| Replay/tests | Append-only codes, profile/extension identity, offline golden replay, kernel/Rust/worldpack/browser/CLI/conformance/power gates. | A new mechanic must add its own protocol identity and fixtures. |

## Active Supported Profile

The active profile contains:

- Search and Study, splitting the overloaded Listen/check behavior;
- Utilize for mundane items and project tools;
- Help for actors and shared projects;
- Influence as the risky subset of Chat;
- Attack and Dodge through the bounded combat protocol;
- starter skill charms that modify eligible checks while equipped,
  advancement that unlocks additional bracelet slots, and physical carried-deck
  capacity derived from item weight/size, avatar stats, and containers;
- a deterministic prepared spell deck with one fully bounded Magic
  effect; and
- Ready as the bounded one-use project preparation contract, with movement,
  item transfer, Rest, and Cosy advancement kept as separate operations.

Dash, Disengage, Hide, broader Magic, generalized reaction-style Ready, and randomized spell draws should
be added only with a scene that needs them and a complete deterministic
resolver. Until then the profile must list them as unsupported rather than
simulate them in browser code.

## Acceptance Invariants

1. Every mechanical card names a stable rules action or an explicit non-action
   operation; labels never carry hidden semantics.
2. Every state-changing offer is server-authored and revalidated on submit.
3. All legal core actions remain reachable even when absent from the suggested
   hand.
4. Reskins cannot alter rules; variants cannot silently override rules.
5. Owning a card cannot mutate a shared avatar, location, or world item by
   itself.
6. Paid collectibles cannot buy progression, automatic success, or exclusive
   maximum power.
7. A skill and its bonus belong to a charm instance and move with authoritative
   possession; advancement unlocks slots but never creates the charm.
8. Spell-deck constraints affect Magic choices, never the availability of
   ordinary core actions.
9. Collection, carried deck, hand, equipped, exhausted, world, and transfer
   states are explicit authoritative card zones rather than one inventory
   field; carried-deck legality comes from weight/size capacity, not card count.
10. Rules and pack versions are part of replay and snapshot identity.
11. CC BY attribution and change provenance survive compilation and release.
