# SRD Action-Card Foundation — Backlog

**Epic**: Use SRD 5.2.1 as CosyWorld's versioned action substrate while cards
make locations, avatars, items, weapons, and skill charms collectible sources
and targets of contextual action offers.

**Status**: Implemented engineering foundation (2026-07-19). The tickets below
remain the acceptance record and dependency history. Marketing compatibility
claims remain blocked on the independent license/product-name review required
by SAF-0.

**Implementation ledger**: `cosyworld.srd5/1` is the selected profile under the
`cosyworld.rules/2` adapter. Its twelve-action conformance matrix explicitly
marks Attack, Dodge, Help, Influence, Magic, Ready, Search, Study, and Utilize
as supported and Dash, Disengage, and Hide as unsupported. The compiler,
checker, runtime startup, `/meta`, and inspector all fail closed on missing or
conflicting bindings.

Action offers are authoritative rules-bound envelopes with deterministic legal
sets, ranked three-card hands, contribution traces, targets, source
collectibles, and stale/tamper rejection. Core and Ruby High demonstrate
reskins and contextual offers; variants/extensions require explicit deltas,
fixtures, precedence, provenance, and compatible resolver contracts.

The item-card layer now includes persisted Collection, Carried, Equipped, Spell
deck, Exhausted, Contained, World, and Escrow zones; physical weight/size
capacity; equippable empty-storage-only containers; bracelet slots and
possession-bound skill charms; equipped weapon profiles; bounded executable
spell cards; signed-ownership materialization receipts; reversible returns;
and atomic observable theft with provenance. Menu and terminal clients expose
the same Deck/loadout operations. Golden legacy replay, rules conformance,
mutation/power audits, browser/CLI parity, Core/Ruby migration, and the
non-shipping deck-gated design spike are checked in with the implementation.

**Architecture**: [SRD-Backed Action and Collectible System](../systems/04-action-system.md)

| Ticket | Engineering state | Primary evidence |
| --- | --- | --- |
| SAF-0 | Landed; external marketing review remains a release gate | [ADR](../decisions/001-srd-action-card-profile.md) |
| SAF-1–5 | Landed | `v2/content/rules-profile-srd5/`, rules bindings, contribution compiler/checker |
| SAF-6–10 | Landed | Search/Study, Influence, projects, playable items/spells, `cosyworld.combat/4` |
| SAF-11–12 | Landed | authoritative zones/materialization/theft and Menu/Deck/browser/terminal parity |
| SAF-13–14 | Landed | conformance matrix, golden replay, mutation/power gates, modified-material report, inspector, [pack guide](../../v2/docs/action-pack-authoring.md) |
| SAF-15 | Landed | compiled Core + Ruby High official worldpack and local smoke gates |
| SAF-16 | Spike complete; not enabled | [deck-gated action spike](../../v2/docs/deck-gated-action-spike.md) |

---

## Principles (acceptance gate for every ticket)

1. SRD 5.2.1 supplies stable rule identities; CosyWorld and expansion packs
   may reskin them without hiding semantic changes.
2. Cards wrap legal actions. The default hand is a projection and never the
   complete authority or a random gate on ordinary legal actions.
3. The C kernel or a narrowly validated journaled reducer remains the source
   of state truth; neither pack prose nor the browser resolves mechanics.
4. Reskins and contextual offers compose freely. Variants and extensions are
   namespaced, versioned, justified, test-backed, and never implicit overrides.
5. Old action codes and journal meanings are append-only. A migration adds a
   new identity; it never reinterprets an old record.
6. A collectible entitlement is not automatically a shared-world actor,
   location, or item. Materialization and control are explicit operations.
7. Paid ownership never buys advancement, automatic success, extra turns, or
   exclusive maximum power.
8. SRD attribution and a record of modified material survive import, compile,
   inspection, and release.
9. Avatar, item, and location are the entity cosmology. Skills, weapons, and
   spells are playable item-card roles, not parallel entity or UI systems.
10. Advancement unlocks bracelet slots; it never creates a charm. A
    charm's skill/bonus travels with authoritative possession, and a spell deck
    may constrain Magic cards but not ordinary actions.
11. Collection, carried deck, hand, equipped, exhausted, world, and transfer
    are explicit authoritative card zones. Carried-deck size comes from item
    weight/size, avatar capacity, and containers—not a fixed card count.
12. A scene is a deterministic projection of base rules, location/world cards,
    visible actors and items, and the player's active zones. Composition grants
    relevance and legal offers, never ownership; every offer has an inspectable
    contribution trace.

---

## SAF-0 — Record the product and compatibility decisions

**Priority**: P0 (blocks schema and mechanical collectible work)
**Scope**: Architecture decision record + RPG invariants
**Depends on**: nothing

### What to do

- Record SRD 5.2.1 as the default rules source and define
  `cosyworld.srd5/1` as a bounded compatibility profile rather than a claim of
  full Dungeons & Dragons compatibility.
- Record projection CCG as the default: the hand suggests legal action offers;
  More/commands keep all legal core actions reachable.
- Decide the official-shard mechanical collectible policy. Adopt the proposed
  rule: cosmetic, access key, or earned/equip-budgeted item card; no purchased
  slots or exclusive best-in-slot power.
- Record skill charms, weapons, and spell cards as roles of Item. Record charm
  skill/bonus as instance state, bracelet slots as earned progression, and the
  spell deck as the Magic loadout.
- Record weight/size carrying capacity as the physical deck-size rule and bags
  as Item cards that can extend capacity under bounded non-recursive container
  rules.
- State whether Core and every expansion pack must declare the rules profile it
  targets. Recommended answer: yes.
- Obtain a license/product-name review before marketing compatibility claims;
  this ticket does not block internal use of properly attributed CC BY content.

### Acceptance

- The ADR names the selected SRD version, profile id, excluded systems, CCG
  mode, item-card cosmology, and collectible power policy.
- The RPG bible's free-core and earned-progression invariants agree with it.
- No document describes SRD data as both non-authoritative and the active rules
  profile without distinguishing current and target state.

---

## SAF-1 — Define stable action identities and domains

**Priority**: P0 (foundation for every following ticket)
**Scope**: Shared schema/constants + protocol docs
**Depends on**: SAF-0

### What to do

- Define stable ids for the twelve SRD 5.2.1 actions: Attack, Dash,
  Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study, and
  Utilize.
- Define separate domains for movement, communication, object transfer,
  procedures, Cosy advancement, and interface/meta operations.
- State that an SRD skill is a check modifier/qualification supplied by an
  equipped charm, not a new action identity.
- Give each legacy/product kind (`check`, `search`, `work`, `defend`, `flee`,
  and others) an explicit mapping or an explicit “not a rules action” status.
- Generate browser and terminal aliases from the same vocabulary source rather
  than duplicating semantics in clients.

### Acceptance

- A single machine-readable registry contains id, namespace, domain, label,
  source reference, support status, resolver kind, and aliases.
- `Listen` maps to Search or Study by authored context; it is not a third
  discovery rule hidden in UI code.
- `Chat` remains communication unless an authored offer names Influence.
- Unknown or unsupported action ids fail validation rather than degrading to a
  generic check.

---

## SAF-2 — Introduce the authoritative rules-profile adapter

**Priority**: P0
**Scope**: Worldpack compiler/checker + SRD importers + Rust bundle loader
**Depends on**: SAF-1

### What to do

- Add a new adapter version or profile contract that can carry actions,
  abilities and skills used by resolvers, playable-item roles, equipment
  profiles, and supported magic effect descriptors in addition to conditions
  and monster seeds.
- Keep current `cosyworld.rules/1` bundles readable and unchanged. Do not
  silently upgrade SRD 5.1 or 5.2.1 content.
- Import the supported SRD 5.2.1 action definitions with source references,
  mapping status (`kernel`, `projection`, `unsupported`), and CosyWorld delta.
- Compile a selected `rules_profile` into the official world identity.
- Reject two active base profiles or an undeclared profile replacement.

### Acceptance

- `npm run v2:srd:check` and `npm run v2:worldpack` prove imports and the
  compiled profile are current.
- The compiled bundle names exactly one default rules profile and preserves the
  independently versioned SRD 5.1 reference pack.
- Runtime startup fails closed on an unknown adapter/profile or a supported
  action without a resolver mapping.
- `/meta` and inspector output show the profile id, source SRD version, and
  implemented/unsupported actions.

---

## SAF-3 — Preserve legacy journal and snapshot semantics

**Priority**: P0
**Scope**: Kernel protocol version + Rust journal replay + snapshot migration
**Depends on**: SAF-1, SAF-2

### What to do

- Allocate append-only action codes/protocol ids for the new stable actions.
- Define submission-boundary mappings for legacy actions without rewriting old
  journal rows.
- Store rules profile and active extension identities with new snapshots and
  action records.
- Specify behavior when a shard loads a snapshot under a different profile:
  migrate explicitly or refuse; never guess.
- Add golden replay fixtures spanning current combat/2, combat/3, checks,
  project verbs, and the new profile.

### Acceptance

- Existing golden journals replay byte-for-byte to their prior authoritative
  result.
- A new Search record cannot be decoded as an old generic check, and vice versa.
- A snapshot/profile mismatch produces an actionable error containing both
  identities.
- Replay does not need network access or mutable source documents.

---

## SAF-4 — Upgrade `action_offers` to rules-bound card envelopes

**Priority**: P0 (vertical seam already exists)
**Scope**: Rust `RankedActionOffer`, `/state`, inspector, browser and CLI
**Depends on**: SAF-1, SAF-2

### What to do

- Extend each mechanical offer with `offer_id`, `rules_action`,
  `rules_profile`, source collectible, target, resolver summary, and pack
  provenance.
- Carry equipped item instance, skill-charm modifier, weapon profile, or spell
  card provenance when one participates in resolution.
- Give non-action operations an explicit `operation` binding instead of a fake
  SRD action.
- Make the browser and terminal clients consume this envelope; remove semantic
  inference from labels and duplicated client-side target selection.
- Retain rank, risk, effect, cost, progress, disabled reason, and claim key.
- Revalidate offer identity and all authoritative inputs on submission; an
  expired offer fails with a refreshable reason.

### Acceptance

- Every rendered mechanical card can be traced in the inspector to a rules
  action or named operation, source pack, source/target collectible, and
  resolver.
- Renaming “Search” to “Listen closely” changes no request or outcome semantics.
- Tampering with rules action, target, cost, or availability in the browser is
  rejected server-side.
- Every legal core action remains reachable when it is not in the top-ranked
  hand.

---

## SAF-5 — Add pack contribution schemas and conflict rules

**Priority**: P0 (blocks third-party rules work)
**Scope**: `pack.json`, action resources, compiler/checker/inspector
**Depends on**: SAF-1, SAF-2

### What to do

- Add explicit resource contracts for `reskins`, `offers`, `variants`, and
  `extensions`.
- Permit reskins to change only presentation fields. Permit offers to bind
  existing rules actions to authored subjects and context predicates.
- Require variants to declare `based_on`, exact deltas, scope, rationale,
  compatibility, and precedence. Require extensions to declare a namespaced
  resolver contract.
- Keep the existing no-implicit-override rule. Two contributions to the same
  identity without explicit compatible composition are a compile error.
- Include every active variant/extension version in world and snapshot identity.

### Acceptance

- A Ruby High reskin can present Study as “Review your notes” without copying
  or changing Study mechanics.
- A test pack that changes a DC or timing field under `reskin` is rejected.
- A justified, namespaced variant with fixtures compiles and appears in
  inspector output with its exact delta.
- Load order alone can never decide which rule wins.

---

## SAF-6 — Split discovery into Search and Study

**Priority**: P1 (first playable rules slice)
**Scope**: Kernel/check resolver + room features + offers + commands
**Depends on**: SAF-3, SAF-4

### What to do

- Author each discoverable fact as perceptual (Search), analytical (Study), or
  available through both with distinct framing.
- Map Search primarily to Wisdom and Study primarily to Intelligence while
  allowing explicitly authored alternatives.
- Migrate Listen/Notice/Inspect labels onto those stable actions.
- Preserve the current learn-once and Visit Ledger claim behavior.

### Acceptance

- Moonlit Trail contains at least one Search offer and one Study offer whose
  labels can be reskinned independently.
- Safe discoveries succeed without a roll; risky discoveries use the
  authoritative deterministic check path.
- Retrying the same learned truth cannot mint a second reward or Ledger mark.
- Browser and terminal paths resolve the same action and event sequence.

---

## SAF-7 — Separate Chat from Influence

**Priority**: P1
**Scope**: Dialogue offers + NPC attitude/cooperation state + AI boundary
**Depends on**: SAF-4

### What to do

- Keep ordinary public Chat/Say outside the action economy.
- Offer Influence only when a player is trying to change an NPC's attitude,
  willingness, or bounded choice and there is an authored consequence.
- Define deterministic attitude/cooperation outcomes before AI narration.
- Ensure failed or unavailable generation cannot alter or fabricate the result.

### Acceptance

- Greeting a resident never requires an Influence check.
- An Influence offer names target, desired cooperation, risk, effect, and
  allowed outcomes before submission.
- AI can narrate the committed outcome but cannot choose attitude or reward.
- Paid Chat amplification cannot improve an Influence roll or outcome.

---

## SAF-8 — Recast projects through Study, Utilize, and Help

**Priority**: P1
**Scope**: Work/Prepare/Help projections + clocks + tools
**Depends on**: SAF-4, SAF-6

### What to do

- Replace generic Work semantics with contextual offers: Study to plan or
  understand, Utilize to perform with a tool/object, and Help to assist.
- Keep `Work` as an optional product label, not a hidden fourth resolver.
- Require Prepare to be either Ready with a trigger or a declared CosyWorld
  extension with duration and consumption rules.
- Preserve clock, reward, and Visit Ledger idempotency.

### Acceptance

- Every project contribution says which stable action advanced it and why.
- The same tool and project context produces the same authoritative offer after
  restart.
- Help names who/what receives assistance and cannot self-stack without an
  explicit rule.
- Existing project replay fixtures remain unchanged.

---

## SAF-9 — Define the playable-item contract and spell deck

**Priority**: P1
**Scope**: Item profiles + use resolver + pack validation
**Depends on**: SAF-2, SAF-4

### What to do

- Give usable items typed roles: tool, consumable, weapon, skill charm, spell,
  relic, or transfer-only. Skills, weapons, and spells remain Item roles.
- Define their common contract: action/check binding, equip/hand slot, target
  predicate, resolver, skill bonus/effect budget, weight, size/bulk, uses or
  exhaustion, recovery, and transfer/theft policy.
- Define a container role with its own weight, added capacity, opening/maximum
  item size, allowed contents, access cost, and nested-container behavior.
- Reject an item that promises a mechanical effect in prose without a validated
  descriptor and resolver.
- Keep Take, Give, Trade, equip, and unequip as inventory/ownership operations.
- Add a spell deck as the prepared Magic loadout. Start deterministic; if draw,
  discard, exhaust, and refresh land, version those rules explicitly.
- Implement at least one bounded spell card with complete targeting, usage,
  duration, persistence, and replay tests.

### Acceptance

- Hearth Tonic, a weapon, a skill charm, and a spell card each expose their
  correct operation/action and never rely on name matching in the client.
- Use counts and consumption are authoritative and idempotent.
- The spell deck can limit available Magic offers but never Search, Study,
  Help, Utilize, movement, or communication.
- Unsupported magic content can exist as reference/presentation but cannot
  produce a mechanical offer.
- An item's pack and SRD/Cosy resolver provenance are visible in the inspector.

---

## SAF-10 — Align bounded combat with the action registry

**Priority**: P1
**Scope**: `cosyworld.combat/4` + combat offers; preserve combat/2 and combat/3
**Depends on**: SAF-3, SAF-4

### What to do

- Bind current Attack and Dodge to their stable SRD action identities while
  documenting every CosyWorld combat delta.
- Model Escape/Flee as the current bounded operation; introduce Disengage plus
  movement only if engagement consequences actually land.
- Bind weapons to authoritative equipment profiles instead of applying the
  combat/3 bounded-finesse fallback to every new attack.
- Keep unsupported combat actions out of the offer list and profile report.

### Acceptance

- Combat cards show stable action, weapon/source, target, and profile version.
- The browser cannot supply attack bonus, damage, Armor Class, advantage, or
  outcome.
- Current combat/2 and combat/3 journals keep their existing meanings.
- Sanctuary combat rejection remains invariant across every pack and reskin.

---

## SAF-11 — Add authoritative card zones, decks, and charm slots

**Priority**: P1 (blocks mechanical weapons and skill charms)
**Scope**: Ownership projection + deck/loadout state + kernel item receipts
**Depends on**: SAF-0, SAF-4, SAF-9

### What to do

- Add item roles for weapon, skill charm, spell, relic, tool, and consumable
  without introducing new entity kinds.
- Replace target avatar skill ranks with charm-instance skill/bonus fields. An
  avatar may attempt a general ability check without a charm, but receives a
  skill bonus only from an eligible charm it possesses and wears. Specialist
  tasks may require an authored charm qualification.
- Define Collection, Carried deck, Equipped, Spell deck/hand, Action hand,
  Exhausted/discard, World, and Escrow/transfer as authoritative zones.
- Implement deterministic scene composition from the rules profile, active
  location/feature/condition cards, visible actor and world-item cards, the
  player's carried/equipped/spell cards, and valid access/pack contributions.
- Produce an authoritative legal-action superset and a separately ranked
  three-card action hand. Keep legal core actions reachable when not suggested.
- Record a composition trace on every offer: rules and pack versions, source
  card instances, target, applied variants, resolver, and state revision.
- Recompose on location, visibility, zone, loadout, condition, clock, access,
  or profile changes. Reject stale submissions atomically instead of applying
  a partially outdated offer.
- Define bracelet slots for active skill charms, weapon/equipment slots, spell
  deck/hand rules, and a deterministic carried-deck capacity derived from item
  weight/size, avatar stats/size, and equipped containers.
- Spend earned advancement to unlock bracelet slots. It never creates a charm
  or increases carrying capacity by itself. The charm's skill, bonus, rarity,
  and provenance travel with it when given, traded, dropped, or stolen; the
  former holder immediately loses access.
- Prevent recursive bag exploits: one containing zone per item, nested bags do
  not contribute capacity while stored, and capacity loss never deletes cards.
- Define deterministic encumbrance and excess-card handling when Strength,
  container equipment, possession, or an item's weight changes.
- Materialize an account-owned item into a shard through a durable,
  idempotent receipt. Define unmaterialize, transfer, and duplicate behavior.
- Implement theft as a risky, observable, server-resolved possession transfer
  with target legality and consequences; never as a client inventory edit.
- Keep shared NPC control and shared location mutation outside ownership grants.
- Migrate existing six starter skill steps into a common starter charm plus
  earned bracelet-slot state without changing historical journal meaning.
- Add an audit that flags purchased slots, paid-only numerical
  superiority, or progression grants.

### Acceptance

- Owning a location card can grant access but cannot edit the room or its NPCs.
- Owning an avatar/resident card does not permit signing actions as that shared
  resident.
- Retrying a materialization receipt cannot duplicate a world item.
- An earned advancement milestone can unlock a second bracelet slot without
  minting or granting a second charm; a rare skill remains unavailable until
  its charm is actually found or acquired in play.
- Two decks with the same card count can differ in legality because their total
  weight, item sizes, and containers differ.
- Two clients with the same actor, state revision, rules profile, active packs,
  and shuffle seed receive the same legal-action set and ranked action hand.
- Entering a location can make a carried or equipped card relevant but cannot
  move, equip, materialize, or duplicate that card.
- Removing a source card or leaving a location removes the offers and modifiers
  that depended on it at the next state revision.
- The inspector explains why every action offer exists and names every rules,
  pack, location, and card contribution that affected it.
- Equipping a larger bag can make a carried deck legal; putting that bag inside
  another bag removes its contributed capacity and cannot produce infinite
  capacity.
- Transferring a charm transfers its skill and bonus and removes the former
  holder's access immediately.
- Buying or merely importing a charm cannot create a slot, a Ledger mark,
  automatic success, an extra action, or exclusive best-in-slot power.
- A failed or illegal theft changes neither holder nor provenance; a successful
  theft produces one journaled transfer and a visible consequence.
- Collection/deck zones, weight/size totals, container contents, bracelet-slot
  progression, possession changes, and materialization survive restart and
  replay.

---

## SAF-12 — Consolidate the player shell into Menu and Deck

**Priority**: P1 (the deck model needs a durable home in the UI)
**Scope**: Browser shell + terminal equivalents + state/navigation APIs
**Depends on**: SAF-4, SAF-11

### What to do

- Replace separate top-level Account, World, and Orbs surfaces with one Menu
  entry while leaving the scene/action hand primary.
- Add first-class pages for Deck & Loadout, Collection & Account, Sign in /
  Identity, World & Packs, Journal & Export, Orbs, and Settings & Help.
- Show carried/current/max weight, size/container conflicts, bags and their
  contents, bracelet slots, equipped cards, spell deck/hand,
  exhausted/discarded cards, and server validation errors in Deck & Loadout.
- Keep a compact identity or Orb status indicator only if it links into Menu.
- Give CLI/agent clients equivalent deck inspection and mutation commands.

### Acceptance

- A player can distinguish everything owned from what the active avatar carries,
  equips, can play now, has exhausted, and left in the world.
- The Deck page explains exactly which item or container causes overweight or
  size-invalid state and previews the result of equipping a bag.
- Deck edits are server-validated, persisted, and reflected in action offers
  without reloading ownership from client state.
- Account sign-in, world/pack access, Orb ledger, and journal export remain
  reachable through Menu with no lost functionality.
- Browser, terminal, and delegated-agent deck mutations enforce the same rules.

---

## SAF-13 — Add rules conformance, mutation, and parity gates

**Priority**: P1
**Scope**: Kernel/Rust/JS tests + CI reports
**Depends on**: SAF-3 through SAF-12 as their slices land

### What to do

- Build a profile matrix: action id, support status, resolver, safe/risky
  behavior, legal targets, event outputs, and known CosyWorld deltas.
- Add pack mutation tests proving reskins cannot alter rules and implicit
  override fails.
- Add property tests for offer determinism, idempotent item materialization,
  card-zone transitions, weight/size accounting, nested-container safety, slot
  unlocking, charm transfer, theft atomicity, claim-key stability, and
  entitlement/power invariants.
- Add browser/CLI parity fixtures sourced from the same server offers.
- Include legacy replay fixtures in the required gate.

### Acceptance

- The CI report cannot say “profile supported” while any supported action lacks
  resolver and replay coverage.
- Mutating labels/art leaves golden outcomes unchanged; mutating rule fields
  changes identity or fails validation.
- Browser and CLI submit equivalent payloads for the same offer.
- Paid-card-only fixtures cannot create slots or exceed the core maximum
  power budget.

---

## SAF-14 — Complete provenance, attribution, and author tooling

**Priority**: P1
**Scope**: Import pipeline + compiled attribution + inspector + pack guide
**Depends on**: SAF-2, SAF-5

### What to do

- Preserve source document, version, section/reference, license, attribution,
  import transform, and modification status for every adapted rule resource.
- Compile required attributions and a machine-readable modified-material
  report into releases.
- Teach `v2:worldpack:inspect` to show action contributions, variants,
  extensions, conflicts, resolver coverage, and collectible power warnings.
- Add a pack-author guide with one reskin, one contextual offer, one variant,
  and one extension example.

### Acceptance

- An offer can be traced from UI card through pack contribution to rules
  resource and source attribution.
- Removing a required attribution or source reference fails the worldpack gate.
- The inspector explains exact variant deltas and why their merge is legal.
- No guide example relies on “later pack wins.”

---

## SAF-15 — Migrate Core content and one expansion end to end

**Priority**: P1 (release proof)
**Scope**: Core + Ruby High: First Bell or another selected expansion
**Depends on**: SAF-6 through SAF-14

### What to do

- Convert Core action offers to stable bindings while retaining cozy labels.
- Convert one expansion using reskins and contextual offers only, unless it has
  a genuinely justified tested variant.
- Add location, avatar, item, weapon, and skill-charm collectible examples
  plus a bounded spell deck across the two packs; mechanical examples must
  follow SAF-0 policy.
- Run the complete local MVP, worldpack, replay, browser, and terminal gates.

### Acceptance

- A player can collect nouns, choose a loadout, enter a scene, receive
  contextual SRD-backed cards, resolve them authoritatively, and see durable
  public results.
- A player can earn a second bracelet slot without receiving a charm, find a
  rare charm separately, play a weapon or spell card, and transfer or steal an
  eligible charm without leaving the card/action interface.
- A player can expand the legal carried deck by finding and equipping a bag;
  no rule or UI describes deck capacity as a fixed number of cards.
- Menu exposes Deck, Collection/Account, sign-in, World/Packs, Orbs, and Journal
  export without crowding the primary scene.
- Core remains complete and free with no external wallet or NFT.
- The expansion can change every visible action label without forking the base
  resolver.
- Inspector output accounts for every active offer and contribution.

---

## SAF-16 — Research a deck-gated ordinary-action variant

**Priority**: P2 (explicitly outside the default foundation)
**Scope**: Design spike only
**Depends on**: SAF-15

### What to do

- Prototype, do not ship, a namespaced mode where draws can constrain ordinary
  actions. This is separate from a spell deck constraining owned Magic effects.
- Specify deck construction, draw/refresh timing, dead-hand recovery, card
  advantage, encounter length, AI/terminal parity, monetization limits, and
  accessibility.
- Compare it with the projection CCG using playtests and measurable failure
  rates.

### Acceptance

- The spike cannot alter the default profile or existing journals.
- The proposal includes a free legal fallback so a bad draw cannot lock a
  player out of the shared world.
- Shipping requires a separate decision record, balance plan, and protocol
  version; completing this ticket alone authorizes none of them.
