# Card-Composed Character Creation

Status: staged-creation vertical slice implemented, broader account collection
proposed (2026-07-22), with the Avatar/Home/Keepsake world-allocation follow-on
groomed locally (2026-07-30).

## Decision

Character creation becomes the first expression of CosyWorld's collection
game. An account receives a free starter set of nine identity cards:

- three **Species** cards;
- three **Class** cards; and
- three **Origin** cards.

A new avatar initially chooses one Species and one Origin. They enter the world
**classless at level 0**. After their first meaningful committed player action,
the three owned Class cards are revealed; choosing one completes the
composition and advances the avatar to level 1. All twenty-seven eventual
starter combinations are legal. The selected cards are locked into that
avatar's history, while the account keeps the cards and may use them again when
beginning a later tale.

The player-facing questions stay ordinary:

1. **What are you?** — Species
2. **Where did you come from?** — Origin
3. **What do you do first?** — one real choice in the world
4. **What did that reveal?** — Class

The selected Class supplies the first authored Calling. Calling may later be
revised through the existing growth rules.

`species`, `class`, and `origin` are stable schema terms, not three new
top-level product nouns. They live under the existing **Cards** concept. Class
does not introduce a class tree: it is a balanced starting approach and kit.
The carried item deck, equipped charms, Friends, Calling, and Journal remain
the long-term build and progression surfaces.

The free starter set must be sufficient to enjoy the whole core game. Cards
found later add identity, story, art, and horizontal build possibilities; paid
ownership never buys a stronger species, an exclusive maximum statistic, an
extra turn, or progression.

## Why this is better than the current picker

The current campaign profile offers one compound choice such as `Lantern
Warden` or `Mothwood Guide`. That single choice currently bundles together:

- identity and appearance;
- a profession or approach;
- an implied past;
- an authored Calling;
- a title and description;
- a starting skill; and
- the campaign entry room.

It is fast, but it hides the collection and produces only four authored
characters. Splitting the choice into three reusable cards creates a small
combinatorial space without a tabletop form: three visible choices at a time
produce twenty-seven coherent starters. It also gives exploration a durable
account reward. The world can later reveal a new Species, teach a new Class, or
make a new Origin available for the account's next tale.

## The card types

Identity cards are account-level creation entitlements. They are not item
cards, world actors, physical possessions, action offers, or equipment.
Player copy may call the collection simply **your cards** and use Species,
Class, and Origin as section labels. The existing word **keepsake** remains
reserved for collectible representations of actors, items, and locations; an
identity card is not a keepsake unless the player lexicon is deliberately
revised.

| Slot | Fictional promise | Bounded rules contribution | It must not do |
| --- | --- | --- | --- |
| Species | body, scale, senses, visual language, naming texture | one validated species trait profile and appearance fragments | grant raw arbitrary stats, lock ordinary content, or imply that a people is loot |
| Class | learned work and favored approach | one validated level-one rules profile plus a choice of common starter kit/charm | create a permanent class tree or exclusive best-in-slot power |
| Origin | a remembered place, custom, and connection | one entry hook, one lore tag or known contact, and Calling fragments | grant paid access, move shared residents, or rewrite the campaign entry room |

The compiler accepts references to validated rules profiles, traits, hooks,
items, and charms. It does not accept arbitrary stat blocks or prose-defined
effects.

The selected Origin and the avatar's unique runtime Home are separate facts.
Origin is a reusable account card and can name a culture, remembered place, or
tradition. Home is one canonical location allocated for this particular
avatar. Creating Home must not move the campaign entry room, bypass a Gate, or
make the selected Origin a private instance.

### Suggested Lantern Keeper starter set

These names are illustrative content, not yet canon:

| Species | Class | Origin |
| --- | --- | --- |
| Human | Lantern Warden | The Cosy Cottage |
| Mouse | Mothwood Guide | The Open Road |
| Badger | Hedge Mender | The Old Chapel |

This eventually gives immediately legible combinations:

- a Mouse Lantern Warden from the Old Chapel;
- a Human Hedge Mender from the Open Road; or
- a Badger Mothwood Guide from the Cosy Cottage.

Moth-Sprite is a good candidate for the first later Species discovery. Its
content pass must test scale-sensitive scenes first; a thumb-sized body needs a
trait profile that explicitly handles carrying, doors, movement, and targeting
without becoming either a superior mobility option or a constant exception.

## First-time flow

The creation surface uses the same three-choice rhythm as the action hand, but
it is not the action hand and never randomly withholds an owned card.

```mermaid
flowchart TD
    A["Begin a new tale"] --> B["Deal 3 Species cards"]
    B --> C["Choose 1 Species"]
    C --> D["Deal 3 Origin cards"]
    D --> E["Choose 1 Origin"]
    E --> F{"Begin this tale?"}
    F -->|"Back"| B
    F -->|"Begin"| G["Commit classless level-0 avatar"]
    G --> H["Play one meaningful world action"]
    H --> I["Reveal 3 Class cards"]
    I --> J["Choose 1 Class"]
    J --> K["Commit Class, Calling, level 1, and starting knack"]
```

On a phone, each step shows:

- the campaign question at the top;
- three illustrated cards in a swipeable row or compact stack;
- one short sentence per card;
- a persistent composition strip whose Class slot remains veiled; and
- Back without losing later choices.

Selecting a Species moves it into the composition strip and deals Origin.
Back returns to Species without losing the Origin choice. There is no separate
wizard progress bar: the Species and Origin silhouettes plus the veiled Class
slot are the progress indicator.

Each card face contains only:

- art, label, and one-line fantasy;
- one plain-language mechanical fact;
- its source mark; and
- a details affordance for trait, kit, hook, provenance, and accessibility
  text.

The card detail explicitly separates **in this tale** from **appearance and
story**. Players should never have to guess whether an attractive visual choice
also changes combat numbers.

### When the collection grows beyond three

The starter account has exactly three cards in each slot, so its first deal is
the whole choice set. Later creation screens still feature three cards at once:

1. newly discovered cards;
2. cards with authored campaign connections; then
3. recently or frequently chosen cards.

The featured three are recommendations, never a random gate. **All Species**,
**All Classes**, or **All Origins** opens the complete owned collection as a
filterable grid, and selecting from that grid returns the chosen card to the
three-card composition surface. An owned, compatible card is always reachable
without a consumable redraw, currency, or luck.

Unknown cards do not fill the creation grid with a global checklist of
silhouettes. The world may place a specific, story-earned hint in the account
collection after the player encounters it; otherwise undiscovered identities
remain undisclosed.

After Origin, the two cards fan together into the arrival preview:

> Mouse · from the Old Chapel · Class unknown

The preview shows body language, connection, and campaign arrival. After the
player acts in the world, the Class cards replace the normal action hand until
one is selected:

> Your first choice revealed three paths.

The chosen Class supplies the starting approach, level-one knack, title, and
authored Calling. Calling remains a personal purpose that may later be revised
through existing growth rules; it is not another account collectible.

The arrival confirmation offers only:

- **Begin this tale**
- **Change a card**

Class selection is a second replay-safe commit; refresh cannot put the avatar
back into initial creation or grant the starting knack twice.

Name and portrait generation begin after arrival commit so an inference delay never
blocks browsing or loses the selected composition. The immediate arrival uses
an authored fallback name/title and composited card art; generated identity art
may replace it through the existing durable media path when ready.

## Returning-player flow

The account owns the identity collection, not the active avatar.

- A returning active avatar resumes immediately. Character creation is not
  shown on every login.
- A knocked-out, retired, released, or deliberately archived avatar remains in
  account history and never receives a fresh active session.
- **Begin a new tale** opens the same composition surface with every identity
  card the account has unlocked.
- The account may initially have one active avatar per shard. Starting another
  requires the previous tale to be in a terminal state; multi-avatar rosters
  can be designed later without changing card ownership.
- The new avatar does not inherit the previous avatar's carried items,
  friendships, Calling, Journal, conditions, or room position.
- Account-level cards, art variants, access entitlements, provenance, and
  account Orbs survive between tales.

This makes defeat consequential without making collection progress disposable.
It also resolves the identity boundary exposed by wallet recovery: a wallet or
passkey restores the account and collection, while an actor session controls
one active avatar.

## Discovery in the world

Identity cards are unique account unlocks. They do not drop as biological
objects and they do not silently rewrite the current avatar.

### Species

A Species card represents welcome, kinship, or enough lived understanding for
a future tale to begin as that kind. Suitable grants include:

- completing a people-specific story with dignity;
- becoming trusted by several members of that community;
- discovering a hidden community and accepting its invitation; or
- carrying an account legacy forward from a completed campaign.

Player copy should say:

> The moth-sprites would welcome one of your future tales.

It should never say that the player captured, looted, or owns a species.

### Class

A Class card represents an apprenticeship or practiced tradition. It may be
earned by:

- completing a mentor's teaching arc;
- resolving a job with the class's approach;
- assembling and using its common kit; or
- finishing a campaign in which the practice is publicly recognized.

Class unlocks a balanced creation profile and starter-kit choice. The active
avatar learns real ongoing capabilities from physical charms, tools, spells,
and play—not from an account menu.

### Origin

An Origin card means a future character may truthfully belong to a place or
tradition. It may be earned by:

- making a sanctuary familiar;
- completing a local story;
- being adopted into a community;
- restoring a forgotten route or home; or
- finishing a world pack.

Origins add relationships and story hooks, not location access. A gated
location still requires its normal pass, and the campaign profile remains
authoritative for the avatar's initial room.

### Duplicate discoveries

The account unlock is unique on `(account_id, identity_card_id)`. Discovering
the same card again adds a provenance stamp or art treatment to that card; it
does not create a second mechanical copy or convert into power/currency.

Identity unlocks are non-transferable by default because they record account
progress. Tradable NFT art or keepsake variants may visually decorate an
already-free identity option, but selling that asset cannot remove the
account's earned ability to begin that kind of tale.

## Composition and balance

Every eventual legal combination must fit the same level-one budget.

1. The arrival commit creates a classless level-zero actor.
2. Species supplies one bounded trait profile. Species never modifies the
   class's primary stat budget.
3. Class selection, only after a qualifying world action, advances the actor to
   level 1 and grants one authored starting knack.
4. A Class may later offer one of up to three common starter kits. The chosen
   kit is granted through the normal collection/equip path with creation
   provenance.
5. Origin supplies one relationship or lore hook and composition text. It does
   not add another combat modifier.
6. Calling supplies existing Journal triggers and identity text, not creation
   stats.
7. Campaign supplies entry room, campaign hook, and any safe presentation
   overlay. It may restrict cards only for an explicit fiction or rules
   incompatibility declared and validated in the world pack.

Core starter cards must be mutually compatible. A pack may add an optional
pair/triple presentation override, but the fallback composition must always
work from the three individual fragments. Authors therefore write nine cards,
not twenty-seven bespoke characters.

Pair overrides may change:

- title grammar;
- visual prompt details;
- arrival wording;
- suggested names; and
- Calling options.

They may not change legality, stats, rewards, access, or power.

## Account boundary

First play must remain possible without a wallet, passkey ceremony, typing, or
purchase.

Recommended account lifecycle:

1. The server creates a provisional account and opaque session on first Begin.
2. It grants the nine starter identity cards idempotently.
3. The player creates and plays an avatar normally.
4. The first non-starter identity discovery prompts the player to add a passkey
   for recovery, but never blocks the reward or the current session.
5. Optional wallets attach external cards and entitlements to the same account.

A browser-local collection is not authoritative. Losing the provisional
session before adding a recovery method may make the account unrecoverable, so
the UI should explain that plainly after the player has something worth
keeping—not before the first tale begins.

Deployments remain tenant boundaries. Card grants are keyed by the deployment's
account/store identity unless an explicit federation or import contract exists;
sharing one email, passkey credential, or wallet address across domains must not
silently merge canonical world history.

## World-pack contract

Character-creation schema version 2 stages Species and Origin before Class. The
implemented vertical slice embeds authored cards in the campaign profile; these
may move to referenced account-card resources when the collection ledger lands:

```json
{
  "schema_version": 2,
  "id": "the-lantern-keeper",
  "name": "The Lantern Keeper",
  "entry_location_id": 800,
  "prompt": "What kind of traveler reaches the last light?",
  "class_prompt": "What did your first choice reveal about you?",
  "default_species_id": "human",
  "default_origin_id": "wayside-inn",
  "default_choice_id": "lantern-warden",
  "species": [{ "id": "human", "label": "Human" }],
  "origins": [{ "id": "wayside-inn", "label": "The Wayside Inn" }],
  "choices": [{ "id": "lantern-warden", "label": "Lantern Warden" }]
}
```

Each referenced card is a versioned world-pack resource with:

- stable id, slot, label, detail, art and accessibility text;
- authored identity and visual fragments;
- validated trait/profile/hook references;
- discovery policy;
- source pack, version, license, and attribution;
- compatibility declarations;
- optional pair/triple presentation overrides; and
- an authored fallback for every generated field.

The compiler must reject:

- missing or duplicate slots;
- fewer than three free starter choices in any required slot;
- raw stat/effect payloads;
- unknown rule, item, charm, hook, or location references;
- a starter combination that fails compatibility;
- paid-only or wallet-only core starters;
- origins that bypass location access;
- species or class text that promises unsupported mechanics; and
- a campaign with no fully deterministic creation path.

## Follow-On Epic: Avatar, Home, And Signature Keepsake

Every new tale should add a small authored triptych to the canonical world:

1. one **Avatar**;
2. one unique **Home** location; and
3. one physical **Signature Keepsake** allocated somewhere in the world.

The three identities are allocated together, but they need not all be loaded
into the active simulation or have generated media before the avatar can play.
“Authored” means the location and item have stable canonical identity,
validated mechanical facts, provenance, and presentation inputs. It does not
mean AI controls their rules, topology, placement, or access.

This is a follow-on to staged card creation, not a blocker for the existing
Species/Origin/Class slice.

**Current capacity note (reviewed 2026-07-30)**:
`v2/core-c/include/cosy_kernel.h` currently bounds one loaded `cw_world` at
512 actors, 512 locations, 1,024 items, and 1,024 directed exits. A reciprocal
Home ingress normally consumes two exit rows. One permanent Home and item per
avatar therefore cannot scale to the actor ceiling while all authored and
historical entities remain loaded. AVH-4 deliberately proves the game below
those bounds; AVH-5 is required before removing the cohort ceiling.

| Ticket | Queue | Depends on |
| --- | --- | --- |
| AVH-0 — record the Avatar/Home/Keepsake contract | P1 / proposed | staged creation contract, THR-0 |
| AVH-1 — allocate the triptych atomically | P1 / proposed | AVH-0, THR-D0 |
| AVH-2 — place homes through bounded route slots | P1 / proposed | AVH-1, THR-7, THR-7G |
| AVH-3 — decorate the triptych asynchronously | P1 / proposed | AVH-1 |
| AVH-4 — prove a bounded living-world cohort | P1 / proposed | AVH-1 through AVH-3 |
| AVH-5 — hydrate cold canonical homes by partition | P1 / later / proposed | AVH-4, ADR 0003 |
| AVH-6 — remove the bounded-cohort production gate | P1 / later / blocked | AVH-5 |

The AVH rows are issue-ready local proposals and are not yet filed.

### AVH-0 — Record The Avatar/Home/Keepsake Contract

**Scope**: identity, ownership, privacy, lifecycle, access, and compatibility

#### What to decide

- Allocate stable identities for the actor, Home, Signature Keepsake,
  discovery placement, and initial Home ingress in one versioned bundle.
- Home is unique to the avatar but remains part of the one canonical shared
  world. It is not a private shard, campaign copy, or client-owned room.
- Origin remains a reusable creation card. It may influence Home presentation
  inputs but does not select topology, grant access, or substitute for Home.
- The campaign profile remains authoritative for the avatar's initial room.
  Creation grants the owner truthful private knowledge of Home and one
  geographically contextual way to seek it; it does not teleport the actor
  there or globally map the route.
- The Keepsake is a physical world item, not the identity card and not a
  guaranteed starting possession. Its frozen discovery placement may be at
  Home or in another eligible bounded Slot, but retry cannot move or duplicate
  it.
- Define what retirement, release, archive, account unlinking, pack upgrade,
  and owner absence do. Recommended: Home and Keepsake remain canonical world
  history; access and stewardship may change through authored rules, but the
  bundle is not silently deleted.
- Define the minimum mechanical fallback for all three subjects so creation
  succeeds and remains understandable while AI services are unavailable.

#### Acceptance

- One contract distinguishes Origin, Home, Signature Keepsake, identity card,
  starter equipment, campaign entry, ownership, stewardship, and access.
- No lifecycle state implicitly deletes a canonical Home or item.
- The owner can truthfully know Home without every actor learning it or every
  route to it.
- AI and wallet availability are outside the authoritative creation
  preconditions.

### AVH-1 — Allocate The Triptych Atomically

**Scope**: allocator receipt, idempotency, bounded materialization, and replay

#### What to do

- Keep the allocator as the live authoritative procedure. On creation it
  selects and reserves, from validated bounded candidates:
  - actor, Home, and Signature Keepsake IDs;
  - a typed Home location template and rules profile;
  - one eligible Home ingress/route Slot;
  - one eligible item Discovery Slot;
  - allocation seed, table versions, inputs, and pack hashes.
- Commit one idempotent allocation receipt before exposing success. A retry
  returns the same bundle and cannot consume another route or discovery Slot.
- Validate all kernel and projection capacity needed for the bounded slice
  before commit. Reject cleanly if the bundle cannot fit; never create the
  actor while dropping Home, item, or route reservation.
- Allow Home and Keepsake to remain cold canonical allocations until revealed
  or approached. Their IDs and receipts exist even if their active kernel
  rows, prose, or media do not.
- Extend `actor.created` provenance with the bundle identity without placing
  private Home coordinates or item truth in the public room transcript.

#### Acceptance

- Repeating the same creation request produces one actor, one Home, one
  Signature Keepsake, one ingress reservation, and one item placement.
- A crash after the receipt but before presentation reconstructs the same
  bundle.
- An allocation failure creates none of the three canonical subjects and
  consumes no capacity.
- Replay with AI disabled reconstructs the same rules, identities, placement,
  and private knowledge.

### AVH-2 — Place Homes Through Bounded Route Slots

**Scope**: route eligibility, connection capacity, private Home Leads, gossip,
and access

#### What to do

- Replace “choose a random location with fewer than five exits” with authored
  typed `home_route_slots`. An eligible source declares region/biome,
  directionality, Home kinds, privacy/access policy, and an available
  connection-capacity slot.
- Count unique neighbor connections, not two reciprocal exit rows. Reserve one
  slot at Home and one at its selected source before the private Lead is
  offered.
- Allocate exactly one initial hidden ingress. Additional approaches are
  earned later through scouting and infrastructure if both endpoints have
  capacity; creation does not randomly make a Home a hub.
- Grant the owner Home knowledge and an actionable Lead tied to the selected
  source Anchor. Other avatars learn the place by visiting, receiving gossip,
  or discovering a compatible bounded Sign.
- Separate knowledge, route legibility, and entry access. Knowing a cottage
  exists or reaching its doorstep does not bypass its hospitality, lock,
  invitation, or stewardship rules.
- Use THR-7's Scout/cairn development ladder for the approach. Do not add a
  Home-only navigation system.

#### Acceptance

- A Home can only be allocated where both endpoints have compatible free
  capacity.
- Two simultaneous creations cannot claim the same single-capacity route Slot.
- A Home has exactly one initial ingress and stable placement after retry.
- The owner can Scout toward Home from the frozen source context; another
  avatar without knowledge receives no omniscient Home offer.
- Gossip can teach the Home's existence without opening its route or door.

### AVH-3 — Decorate The Triptych Asynchronously

**Scope**: AI workshop jobs, deterministic fallback, subject consistency, and
media replacement

#### What to do

- After the authoritative bundle commits, enqueue linked Avatar, Home, and
  Signature Keepsake presentation jobs.
- Give the workshop only certified mechanical facts, pack style, identity-card
  fragments, safe relationship context, and allocated subject IDs.
- Generate names, descriptions, composition text, and media as replaceable
  presentation. Do not allow generated output to add exits, capabilities,
  item effects, access, rarity, occupants, loot, or history.
- Require an authored deterministic fallback card and image treatment for all
  three subjects. The avatar can enter play immediately using those fallbacks.
- Keep the three subjects visually and narratively related without forcing the
  Keepsake to spawn at Home or making Origin and Home identical.
- Bind every job and result to the stable subject identity and allocation
  receipt so retry or model change cannot create a fourth subject.

#### Acceptance

- Creation completes and is playable when the model, image workshop, or job
  queue is offline.
- Late media replaces fallback presentation without changing rules, topology,
  placement, or knowledge.
- Retried jobs update the same three subjects and never allocate new ones.
- The player can recognize a coherent Avatar/Home/Keepsake relationship
  without generated prose promising unsupported mechanics.

### AVH-4 — Prove A Bounded Living-World Cohort

**Scope**: small-cohort gameplay proof before partitioned scaling

#### What to do

- Set an explicit test cohort, recommended at 16 first and 32 as the stretch
  gate, within the current fixed-capacity kernel.
- Create the cohort under deterministic seeds and prove:
  - unique triptych identities and receipts;
  - collision-free Home route reservations;
  - exactly one initial ingress per Home;
  - owner-only initial knowledge;
  - scouting, loss, cairn marking, gossip, and access at one Home;
  - discovery and recovery of one Signature Keepsake;
  - restart, snapshot, replay, AI-offline, and pack-upgrade behavior.
- Report remaining actor, location, item, and unique-connection headroom. The
  test must count reciprocal exit rows correctly in the kernel capacity
  budget.

#### Acceptance

- The full cohort creates without duplicate subjects, half-committed bundles,
  capacity overrun, or route collision.
- Every bundle replays byte-for-byte in authoritative identity and placement.
- At least one other avatar learns of and reaches a Home through gossip and
  Scout without receiving owner access automatically.
- This proof does not require a new database product or partition loader.

### AVH-5 — Hydrate Cold Canonical Homes By Partition

**Scope**: durable canonical registry, active-world hydration, ownership
fencing, and capacity release

**Depends on**: [ADR 0003](../decisions/0003-one-canonical-world.md)

#### What to do

- Preserve the allocator/runtime boundary:
  - the allocator commits the authoritative bundle and immutable receipt;
  - durable storage retains cold canonical identity, placement, and history;
  - the C kernel hydrates only active partitions and their bounded neighbors;
  - approaching a cold Home loads the same place rather than allocating it.
- Begin with the existing journal/snapshot/SQLite persistence where practical.
  This ticket requires a canonical storage and hydration contract, not a
  premature database-product migration.
- Define partition contents for a Home, its occupants/floor state, local
  fixtures, items, discovery Slots, and adjacent route stubs.
- Use ADR 0003 lease epochs and fenced single-writer commits for movement and
  other actions that cross partitions.
- Prove eviction and rehydration preserve IDs, receipts, knowledge, access,
  route state, items, and generated presentation.

#### Acceptance

- A dormant Home and Keepsake remain canonical without occupying permanent
  rows in every live `cw_world`.
- Loading, evicting, and reloading a Home cannot duplicate it or change its
  topology.
- Cross-partition arrival commits once under the canonical event history.
- The bounded AVH-4 gameplay remains unchanged when the storage boundary is
  introduced.

### AVH-6 — Remove The Bounded-Cohort Production Gate

**Scope**: rollout limits, capacity telemetry, failure behavior, and migration

#### What to do

- Keep public creation capped at the proven bounded cohort until AVH-5 passes.
  Increasing C array constants alone is not the production scaling design.
- Add capacity and hydration telemetry for actors, hot/cold locations, items,
  route Slots, partition loads, allocation failures, and orphan checks.
- Migrate already allocated bounded-cohort bundles into the cold canonical
  registry without changing IDs or receipts.
- Fail creation before commit when canonical storage or route allocation is
  unavailable. Never create an actor without the promised Home and Keepsake.

#### Acceptance

- Public creation no longer depends on all historical avatars, Homes, items,
  and exits fitting simultaneously in one fixed-capacity kernel instance.
- Capacity exhaustion is observable, bounded, and mutation-free.
- Migration preserves every AVH-4 identity, placement, knowledge, and replay
  result.

## Persistence and events

Suggested durable records:

```text
account_identity_card_unlocks
  account_id, card_id, source_event_id, source_pack_hash,
  first_unlocked_at, latest_provenance_json
  UNIQUE(account_id, card_id)

avatar_creation_drafts
  draft_id, account_id, campaign_id, selections_json,
  composition_hash, status, expires_at

avatar_identity_composition
  actor_id, account_id, species_card_id, origin_card_id,
  nullable_class_card_id, class_selection_ready, qualifying_world_actions,
  calling, starter_kit_card_id, campaign_pack_hash, composition_hash
  UNIQUE(actor_id)
```

Draft choices are private account state and may expire. Arrival is one
idempotent transaction that:

1. verifies the account session and card unlocks;
2. validates Species and Origin against the mounted pack/rules profile;
3. creates the actor through the kernel;
4. forces level 0 and records the partial immutable identity composition;
5. links the account to the new active actor;
6. writes the arrival events; and
7. returns the same result on retry.

When the AVH follow-on is enabled, AVH-1 extends this transaction with one
precommitted triptych allocation receipt. The actor commit must not succeed
without its promised Home, Signature Keepsake, ingress, and placement
reservations; asynchronous AVH-3 presentation remains outside the transaction.

The first qualifying player card or speech event records
`class.selection_ready`. Class selection is then a separate replay-safe system
mutation that validates the profile, records `class.chosen`, sets level 1,
updates Calling and title, and grants the starting knack exactly once.

Public world history needs one compact event such as `actor.created` with the
resolved title. The detailed account card choices may be projected into the
avatar sheet, but private creation drafts do not enter the room transcript.

Identity discovery uses an idempotent `account.identity_card_unlocked` account
event linked to its committed world source event. A public room beat may
celebrate the discovery without exposing account identifiers.

## API shape

The implemented vertical route surface is:

```text
GET    /state
POST   /avatar          { character_creation_id, species_id, origin_id }
POST   /avatar/class    { actor_id, character_creation_id, class_id }
```

The account-card and durable draft routes remain future work. Both implemented
mutations recompute their selection from mounted content; the client cannot
submit a stat block, level, title, Calling, or skill grant.

## Migration from character creation v1

Schema v1 remains replayable and mountable during migration.

1. Introduce identity card resources and schema v2 behind a feature flag.
2. Map each v1 compound choice to a canonical v2 composition for history and
   support displays. Do not reinterpret the old `actor.created` event.
3. Grant existing accounts the free starter set.
4. Project existing avatars with `legacy_choice_id` plus the mapped composition
   version; their stats, items, Calling, and entry history do not change.
5. Make v2 the creation default only after all twenty-seven starter
   combinations pass compiler, rules, copy, portrait, mobile, and smoke checks.
6. Retain v1 request acceptance until old clients are outside the supported
   release window.

## Instrumentation

Record:

- creation opened;
- Species and Origin inspected and selected;
- Back/change-card use;
- level-zero arrival reached;
- first qualifying world action;
- Class cards revealed and selected;
- confirm attempted/succeeded/rejected;
- time per slot and total time to arrival;
- starter versus discovered card use; and
- new-tale creation after a terminal avatar.

Do not optimize for the fastest possible confirm alone. The primary funnel is:

> Begin → choose Species and Origin → arrive → act → choose Class

Target for a first-time phone visitor: reach the world in under ninety seconds
without typing, while being able to answer “what am I and where am I from?”
The world then helps answer “what do I do?”

## Acceptance gates

1. A guest can create a valid avatar from the free starter set with no wallet,
   passkey, typing, payment, or AI availability.
2. All nine Species/Origin arrivals and all twenty-seven eventual starter
   combinations compile, commit, replay, and render on the narrow mobile
   layout.
3. Refreshing or retrying arrival or Class selection cannot create a second
   actor, grant the starting knack twice, or duplicate a card grant.
4. An account linked to an inactive avatar may begin a new tale; an active
   avatar resumes instead of opening creation.
5. A found identity card belongs to the account and never mutates the current
   avatar.
6. Species, Class, and Origin cards cannot directly grant arbitrary stats,
   paid access, progression, extra turns, or best-in-slot power.
7. Removing or selling an external art/NFT variant cannot remove an earned
   native identity unlock.
8. Every unlock and final composition is linked to committed, replayable
   provenance.
9. Packs can add cards and presentation overrides through data, but cannot
   execute client text or bypass kernel/Rust validation.
10. A Class is unavailable before the first qualifying committed player action,
    and selecting it atomically advances level 0 to level 1.
11. Existing v1 avatars replay byte-for-byte under their original creation
    semantics.

## Recommended first slice

Build only the vertical path needed to prove the idea:

1. nine authored starter identity cards;
2. the two-step Species/Origin mobile selector;
3. classless level-zero arrival;
4. first-action Class reveal and selection;
5. immutable staged avatar composition persistence;
6. one authored Calling per Class;
7. account-level idempotent starter grants;
8. v1-to-v2 compatibility mapping;
9. one later in-world identity-card discovery;
10. one terminal-avatar **Begin a new tale** flow; and
11. complete twenty-seven-combination and retry coverage.

Do not begin with trading, rarity, booster duplication, arbitrary user-authored
cards, species stat bonuses, multiple simultaneous avatars, or AI-generated
mechanics. The value of the first slice is the clear identity composition and
the discovery promise, not collection breadth.
