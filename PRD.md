# CosyWorld Product Requirements

Last major revision: 2026-07-19. This document replaces the CosyWorld 2.0 PRD, which was written for the original one-room, Chat-only MVP and survived as a stack of amendments. The world it described has shipped and grown past it; this document sets direction from where the product actually is — including the turn system, resident autonomy, and the card-composed world.

Companion documents:

- `docs/systems/09-cosyworld-rpg-system.md` (the RPG Bible) — authoritative mechanics design: Callings, Bonds, Clocks, Jobs, Fronts, Covenants, the Visit Ledger, ownership, and poems. This PRD does not restate it.
- `docs/systems/04-action-system.md` — authoritative target for card zones, deterministic scene composition, rules-bound offers, loadouts, and pack extensions.
- `ENG.md` — architecture and engineering priorities.
- `ECONOMY.md` — Orbs, Boxes, packs, and the NFT bridge in detail.
- `AI.md` — AI gateway, payer modes, media pipeline, and combat design in detail.
- `GAP.md` — implementation status audit.

## What CosyWorld Is

CosyWorld is a shared AI MUD played like a cozy tabletop: one persistent world that everyone enters together. A player becomes a generated avatar, keeps a home that is a true sanctuary, follows a Calling that says who they are, builds Bonds with residents and other players, and chooses when to walk out to a frontier with real stakes. Play happens through a transcript-first surface where the server deals a small hand of labeled action cards — playing one is a deliberate turn, and every AI output, resident reply, dice roll, and world change is a public room event that everyone present sees.

The product should feel like living in a small fantasy world that remembers you — not like a dashboard, a wallet app, a quiz, or a one-on-one chatbot.

## Where the Product Stands

CosyWorld V2 is a playable, production-deployable game, live-tested with simultaneous human and agent players:

- CosyWorld Core (free) and the Ruby High: First Bell expansion (card-gated), with compiled cards and complete room sheets validated by the content gate. Release counts are generated from the compiled worldpack rather than maintained in this prose.
- The full verb surface: Chat (server-authored avatar speech), moderated typed `say` and `/me`, Listen, Travel, Take, Drop, Give, Use, Trade, Prepare, Rest, Work, Help, Attack, Defend, Flee, plus Calling/Bond/skill/growth actions.
- The card-hand control surface: dealt action cards with art and labels, a detail/confirm surface, and shuffle — play feels like turns, not clicking.
- Room turn-taking for co-present humans, with ping/pong pacing: waiting players can ping the current player; unresponsive players are skipped, not waited on.
- Resident autonomy on played time: residents wander, remember, and hunt the items they desire — a resident reclaiming her own lost keepsake is now an observed, emergent story beat.
- The RPG retention layer: Callings, first-class Bonds, sanctuary/frontier zoning, progress and danger clocks, seeded Jobs and Fronts, factions, the Visit Ledger with growth banking into skill steps and bond slots — all rendered in the shared transcript (arrivals, callings, clues, dice, growth).
- An economy MVP: starter Orbs, claim-key-gated rewards, server-paid Chat spends, a player OpenRouter payer, durable Orb/AI-usage ledgers, and the Wooden Box burn → pack reveal bridge with production Solana/Core verification.
- Moderation basics: player reports, an operator console, protected all-room replay, actor suspension, and report retention.
- Browser and terminal clients over the same API, with a Playwright smoke, visual baselines, and a production deployment profile with strict guardrails.

The question this PRD answers is no longer "can the loop exist?" It is: **why does a player come back on day seven, and what do they tell a friend?**

## Product Pillars

Every feature must serve at least one of these; a feature that serves none does not ship.

1. **One shared world.** No private room copies, no resident DMs, no per-player AI responses. A resident reply is a world event broadcast to everyone present. Card ownership unlocks shared places, never private instances.
2. **Cozy by guarantee, stakes by consent.** The home and sanctuary rooms never decay, never see combat, and never advance while nobody is playing. Danger, player-powered clocks, and loss exist only on the frontier — where the player chose to walk.
3. **The world runs on played time.** World time advances only through committed player turns — never on a wall clock. A quiet world is still, not rotting; a busy world is alive because people are in it. "The world moved while you were away" is always true in a populated shard, and it always means other players moved it.
4. **Identity through play.** A player should be able to say "I am the kind soul who ___, my home is ___, and I am slowly ___" after ten minutes. Callings, Bonds, and the Journal make that sentence mechanical and publicly remembered.
5. **One meaningful action hand.** The resting UI is a dealt hand of at most three labeled action cards plus shuffle — one surface, server-derived from the player's cards, location cards, visible world state, and base rules. Each card shows its target, cost, and risk before commit. Playing a card is a turn. Speech (`say`, `/me`) is always available and never consumes a turn. The small action hand is a focus mechanism, not an inventory limit.
6. **AI is a world actor, not the product.** AI proposes narration, resident speech, and media; the kernel decides truth. Core world actions remain playable without inference. Dialogue is never fabricated from canned text: an explicit dialogue action fails visibly and without charge when inference is unavailable, while incidental resident speech is skipped.
7. **Progression is earned, never bought.** Orbs buy amplification and cosmetics — never power, access, success, or growth. The core loop (listen, help, bond, travel) always has a zero-Orb path.
8. **Ownership without a token.** The target ownership layer is CosyWorld's own signed provenance log (Ed25519, content-addressed, append-only) — gifting free and first-class, trading world-bound and lineage-preserving, secret poems as commit-reveal claim tickets. External NFTs remain an optional bridge that gates official expansions, never the base game.

## The Concept Budget

The systems layer is deliberately rich — Callings, Bonds, Clocks, Jobs, Fronts, Covenants, factions, claim keys, sanctuary/frontier. The player-facing surface must not be. The v1 swarm proved the ceiling: thousands of avatars ran a D&D text MMO inside ordinary Discord channels with an emoji-to-tool grammar (`src/services/tools/ToolService.mjs` — 🗡️ attack, 🛡️ defend, 🏃 move, 🔮 summon, ⚔️ challenge, 🧪 potion) and every avatar carrying its own identity emoji. The lesson: the world can be arbitrarily deep as long as the controls stay small enough to learn by watching one turn.

Two rules follow.

**Rule 1 — a small player vocabulary.** A player should only need these seven nouns. Adding another requires replacing or absorbing one of them:

| Player word | What it covers | Internal machinery it hides |
| --- | --- | --- |
| You | avatar, equipped cards, conditions | stat blocks, tags, claim keys, loadout slots |
| Home | sanctuary, later your covenant | zones, covenant sheets, season clocks |
| Calling | who you are | calling tags, ledger triggers |
| Friends | bonds with residents and players | bond entities, reaction states, evolution gates |
| Journal | memories that settle into growth | Visit Ledger marks, advancement points, skill steps |
| Cards | your collection and deck; the people, things, places, and spells that meet in a scene | ownership records, card zones, carrying capacity, scene composition, rules bindings |
| Orbs | the one visible currency | ledgers, payer modes, claim gating |

Everything else is *fiction, not vocabulary*: a clock is "the trail feels safer lately," a job is "someone needs help," a front is weather and trouble, a faction is who a character stands with. System names (clock, front, claim key, projection, sanctuary/frontier) never appear in the player UI. A new feature must fit an existing noun or replace one — the budget does not grow by default.

**Rule 2 — the action hand is the controller.** The shipped control surface is a dealt hand of action cards: at most three labeled cards plus shuffle, each opening a card-art detail surface that names target, cost, and risk before commit. It is a projection of a deeper card composition, not the ownership ledger or the player's physical inventory. This won over both the bare one-button rail and the unlabeled-emoji experiment because it makes each turn a readable, deliberate choice. The same contract projects onto every future transport: cards become Discord reactions, terminal keys, or voice intents without new server concepts — the v1 emoji grammar remains the prior art for the Discord revival. Three laws hold regardless of transport: every card carries a visible label (never a bare glyph), browsing the hand is free, and every legal core action remains reachable even when it is not among the three suggestions.

## The Card-Composed World

Adopted direction (2026-07-19), superseding the one-hand/one-floor simplification. CosyWorld is already a world of cards: a player's deck meets the cards contributed by a location, its residents, its items, and its live conditions. These rules make that reality authoritative instead of pretending that a single physical slot is the system:

1. **Cards live in explicit zones.** Collection, carried deck, equipped loadout, spell deck/hand, exhausted/discard, world, and escrow/transfer are authoritative states. The action hand is a server-authored projection and never doubles as an ownership record. Every transition names the card instance, source, destination, actor, reason, and idempotency key.
2. **A scene is a composition.** On entry and whenever relevant state changes, the server composes the active rules profile, location and room-feature cards, visible resident/avatar and world-item cards, clocks/conditions, and the player's carried/equipped/spell cards. That composition produces legal actions and a ranked action hand; it does not transfer ownership or let presentation text acquire authority.
3. **Capacity is physical, not arbitrary.** An avatar may carry multiple cards. Legality comes from weight, size, physical ability, containers, and typed equipment slots. Bracelet advancement opens space for skill charms; it does not conjure a skill. Bags extend usable carrying capacity only while validly equipped and cannot create recursive capacity.
4. **Search circulates cards through world state.** Search may reveal or make reachable cards when the location, feature, supply, season, or claim state permits it. An empty visual floor can be one authored condition, but it is never the universal faucet. Discovery and materialization remain kernel-validated, journaled, capacity-aware, and idempotent.
5. **Items persist and crafting grows the world.** Use, craft, and evolution may exhaust, attune, rename, tag, recharge, unlock, mint, transform, or create cards, but authored inputs are not silently deleted. A crafted key can open a doorway, a lantern can wake a route, and a relic can anchor a location or project. Recipes declare both their card output and the world capacity, desire, route, or story possibility they add.
6. **Evolution is public arrangement.** Evolution requirements are placement patterns across explicit zones: a charm equipped by Skull, a thread left at the Silver Milepost, a bell carried into the Garden. Patterns compile from a closed vocabulary of existing cards, reachable places, valid zones, and present residents; the kernel checks them against real shared state. Completion is a public ceremony, and placers and witnesses earn Journal credit.

The old phrases “one hand” and “one floor” may survive as scene copy or a deliberately constrained rules variant. They are not storage, ownership, or composition laws. Scarcity comes from authored supply, carrying constraints, typed slots, exhaustion, access, and meaningful placement—not from pretending a deck contains one card.

## Users

- **The new wanderer.** Arrives with no context. Needs to become someone, learn one true thing, and feel the room notice them — within the first session, without typing, on a phone.
- **The returning regular.** The retention audience. Needs bonds that deepen, a Journal worth settling, a covenant that is theirs, and a frontier that visibly changed because players spent turns there.
- **The collector and supporter.** Holds cards, opens packs, unlocks expansions, gifts, trades, and crafts. Must always feel additive: their money makes the world fancier for everyone, never gates another player's progression.
- **The world designer.** Authors rooms, residents, jobs, fronts, recipes, and evolution tracks as worldpack data with a validation gate — not by editing runtime code.
- **The operator.** Runs the official canonical world: moderation queue, suspension, economy audit, deployment guardrails. Later: self-hosted installation operators with their own world identity, content, and gates.

## Product Direction

### Now — earn the seventh visit

The loop exists and multiplayer works; the priority is making the world worth returning to.

1. **Trustworthy seventh-visit evidence.** A story or world beat counts as seen only after it is rendered to that player (or acknowledged by an equivalent client receipt), never merely because `/state` returned it. Complete that exposure seam before starting the live cohort, then hold behavior stable for the measurement window.
2. **The card-composed world.** Land explicit zones, weight/size/container capacity, typed loadouts, and deterministic scene composition. Complete the multi-card migration without reintroducing a parallel single-item authority model.
3. **First-session arc.** Instrument the arc: arrive → become someone → play a first card → learn a truth → meet a resident → settle the Journal. Target: a first-time mobile visitor settles their first growth in under ten minutes without typing.
4. **Turn cadence legibility.** The shipped room-turn system (one committed card per active human, ping/pong pacing, speech always turn-exempt) needs its remaining visibility work: a visible ping countdown for both sides, a clear "you've been pinged — play or pass" signal, and warm copy when a room's action hand genuinely offers only exits.
5. **Economy circulation.** Wire the already-designed job Orb payouts; add witness credit (players present when a resident claims a desired item or evolves earn a Journal mark, so resident autonomy rewards spectators instead of robbing them); recover world-bound cards from inactive avatars via resident desire-hunts; scope claim keys to played-time seasons so faucets reopen through play.
6. **Real faces and public-traffic safety.** Replace deterministic SVG placeholders with generated avatar portraits and card art through the media pipeline, while completing pre-commit filtering, operator resolution workflows, resident line-variety cooldowns, and abuse review.

### Next — a world that makes things

1. **Crafting.** The item-meets-room verb, recipes-as-worldpack, tag-keyed combination, AI-decorated names within kernel rails, and craft-created items that unlock or anchor new world capacity. Ships with its moderation surface (names are sanitized, authored fallbacks exist) and its economy role: creating provenance, tags, doorways, locations, resident hooks, and collection value without deleting the physical ingredients.
2. **Covenants.** The shared home base: a named cottage/guild with its own sheet, boons, resources, projects, reputation, and per-member loyalty — and the renewable sanctuary verbs (tend, brew, keep a promise) driven by room-sheet resources that make *home* the richest room instead of the first exhausted one. (RPG Bible Phase 5.)
3. **A living frontier.** The first slice is live: every sixth committed player tick drives deterministic ambient weather and opportunity-level route trade, faction movement, and conflict pressure. Stakes remain local and consensual: only a recorded action at the affected frontier can let pressure advance its danger clock, while sanctuary and unrelated players remain untouched. Next, let those audited consequences create new Jobs so the Wanderer returns to fresh work produced by play. Spent encounters reset through the same played-time seasons.
4. **Evolution as arrangement.** Placement-pattern evolution tracks with generated per-level quest lists, replacing the fixed two-item gift: patterns compile through the same fail-closed descriptor seam as clock effects, the kernel checks satisfaction against real world state, and ceremonies pay witness credit. This is the renewable quest engine — every resident level mints a fresh constellation of things to find, carry, place, and guard.
5. **Conflict with objectives.** Objective clocks in danger rooms, nonlethal outcomes, gear durability that breaks to absorb harm, and Flee as a first-class success path. Combat stays one risk mode among many, never the default verb. (RPG Bible Phase 6.)
6. **Native ownership, phase one.** The signed card provenance log: native mints bound to the world events that earned them — including craft events — free gifting, world-bound co-signed trading, and commit-reveal poem claims. A player owns, gifts, and trades a base-game card with no wallet.

### Later — many hearths

- The federation dial: from operator-signed authority (quorum 1) toward P2P quorum signing; messaging stays honest — "verifiable and permanent" until it is actually trustless.
- Self-hosted installation kit: own world identity, world packs, gates, and ownership adapters; the official world trusts only official feeds. A self-hosted world is not a capacity shard or fork of official history.
- A second official expansion beyond Ruby High: First Bell, proving the expansion pipeline is repeatable content work, not bespoke engineering.
- Designer tooling and community content packs over the worldpack format.
- Additional transports as thin adapters over the same world API — Discord first, with cards projected as reactions (the v1 swarm's home ground).

## Requirements

### P0 — product law (held today; regressions are release blockers)

- A human must create an avatar before acting; returning players recover their avatar (local session or signed wallet) instead of duplicating people.
- The resting UI is one dealt hand: at most three labeled action cards plus shuffle, server-derived; no permanent composer, send button, or navigation sidebar. Browsing is free; playing spends a turn.
- All world mutation resolves through the C kernel; AI and clients never decide outcomes, rewards, access, or affordability.
- World time advances only through committed player turns; nothing mutates on a wall clock.
- Every player-visible AI output is a shared room event; there are no private resident conversations.
- Sanctuary rooms reject combat and never receive autonomous pressure or decay.
- Every reward, mint, spend, and one-shot effect is claim-key gated and idempotent.
- The core loop is playable with zero Orbs and with AI generation unavailable.
- In shared rooms, one human commits one card per turn; speech and emotes are always turn-exempt; waiting players can always see whose turn it is and can pace it (ping/pong) — a present player is never hostage to an absent one.
- Resident speech contracts hold: Rati prose, Whiskerwind emoji-only (with accessible labels), Skull emote-only; at most one resident replies to a normal turn.
- Typed player speech (`say`, `/me`) is moderated and sanitized before it reaches the journal; server-authored `Chat` never takes player text.
- Content safety: cozy, non-explicit, no harassment, no gore escalation; engine-owned facts override character improvisation; residents never mention models, prompts, or system internals.

### P1 — current build targets

- Card-zone and scene-composition contracts live: multi-card carrying, explicit zones, weight/size/container validation, typed loadouts, and deterministic action-hand projection.
- World/story-beat exposure is measured from a rendered client receipt or equivalent acknowledgement, not server delivery alone.
- The instrumented first-session arc, with time-to-first-settled-growth as a tracked metric.
- Turn legibility: visible ping countdowns, pinged-player signal, settled-room copy.
- Economy circulation: job Orb payouts, witness credit, ghost-item recovery, played-time season scoping for claim keys.
- Generated avatar portraits and card art in the live product; media jobs durable, idempotent, payer-attributed.
- Moderation at public-traffic grade: pre-commit content filtering, operator workflow with a resolution-time target, resident line-variety cooldowns, documented policy.
- Covenant contribution and expanded growth-spend choices.

### P2 — designed, staged behind P1

- Crafting live: recipes.json, tag-keyed combination, AI-decorated names within rails, crafted items, crafted exits/unlocks, recipe balance declarations, and non-consuming craft-event card mints.
- Native provenance log live: native mints, gifting, world-bound trading, one-time poem claims and world-gate incantations (repeatable).
- Covenant-spawned jobs and played-time seasonal cadence.
- Self-hosted installation configuration surface.
- Higher-level evolution tracks.

## Non-Goals

- No private AI companions, teacher DMs, or per-user room instances — for any price.
- No pay-for-power, no purchasable progression, no anonymous secondary market, no speculation loop.
- Not a full D&D engine; the rules layer stays compact, legible, and kernel-audited.
- No unlimited or spreadsheet-like inventory. A carried deck is bounded by weight, size, containers, typed slots, and access costs; the wider collection remains distinct from cards materialized in the shared world.
- No consumable world items — use, craft, and evolution may exhaust or transform meaning, but must not delete physical items from the world.
- No dashboard/admin chrome in the player surface; operator tools live behind protected routes.
- No wall-clock world simulation; the world's pulse is its players.
- No player-facing capacity shards or isolated official-world copies. The current release stays one writer; later capacity processes must share canonical identity, history, routing, and presence under [ADR 0003](docs/decisions/0003-one-canonical-world.md).
- No poem-derived keys, ever: poems are tickets and incantations, keys are keys.

## Success Metrics

Activation:

- Percentage of first-time visitors who create an avatar and play a first card.
- Time to first settled growth (target: under ten minutes, mobile, no typing).

Retention (the metrics this era is judged by):

- Day-1 / day-7 return rate.
- Visits that settle at least one Journal mark; active Bonds per returning player; covenant membership rate once covenants land.

World health:

- Rooms whose hand offers only exits (target: zero — every settled room offers listen or search).
- Items held by inactive avatars (target: near zero via recovery).
- Turns with more than one resident reply (keep near zero); repeated identical ambient lines per session (target: zero); dialogue inference failure rate; resident speech-contract pass rate.
- Ping-to-skip rate in shared rooms (high values mean turn friction); report resolution time.

Economy health:

- Orb faucet/sink balance per cohort week; percentage of sessions blocked on an Orb wall for a core-loop action (target: zero); pack/burn completion without support intervention; craft events per active player once crafting lands.

## Risks

- **Card-zone ambiguity creates duplicate authority.** Collection ownership, world possession, carried cards, equipped cards, spell preparation, and the action hand must never collapse into one field or be inferred from the browser. Migrate each legacy field through a versioned boundary and reject ambiguous state rather than guessing.
- **Scene composition can become illegible.** The underlying merge may be deep while the resting surface stays small. Keep the three-card action hand, make precedence inspectable, and test that a legal core action remains reachable even when it is not suggested.
- **Retention layer under-delivers.** If Journal marks feel like chores, the whole Now bet fails. Keep marks tied to genuinely novel events (truths, bonds, frontier returns, witnessed moments), never grind.
- **Crafting opens a generative moderation surface.** AI-decorated names/blurbs on player-triggered mints must pass the same sanitizer as speech, with authored fallbacks — and recipe outputs must never be kernel-arbitrary.
- **Moderation debt blocks launch.** One shared world with open traffic and thin filtering is an incident, not a risk. Public-traffic moderation is a P1 gate.
- **UI creep.** Every new system (covenants, trading, crafting, media) will ask for chrome. The hand rule and transcript-first surface are product law; new surfaces must be focus states, not panels.
- **Economy drift.** Any path where Orbs or cards buy outcomes breaks pillar 7 permanently. Claim keys and kernel authority are the enforcement; review guards key granularity, and the Orbs identity (AI meter funneling to BYOK vs. renewable play energy) must stay a written decision, not an accident.
- **Trading reintroduces speculation.** World-bound, co-signed, lineage-preserving trades are the line; hold it even when a marketplace would be easier.
- **Turn systems can suffocate a chat world.** Speech stays turn-exempt, browsing stays free, and absent players are skippable — if any of those three slips, shared rooms stop feeling alive.
- **Scope gravity toward simulation.** Covenants, fronts, seasons, and crafting can each become a management game. Ship the smallest slice that serves a fantasy, per the RPG Bible's acceptance criteria.

## Acceptance Criteria Snapshot

A release of the current era is acceptable when:

- A new mobile user plays a first card and settles their first growth in one session without typing.
- A returning user's home is exactly as they left it, and at least one opted-in frontier goal has visibly moved through player turns.
- No settled room's action hand collapses to exits alone: scene composition always yields a reflective, investigative, social, or useful local action in addition to travel.
- Two players can complete a resident's placement-based evolution ceremony together without consuming the arranged items, and a present witness earns a Journal mark when a resident claims what it desires.
- The room transcript reads as a place: at most one resident reply per turn, no repeated ambient lines, dice and clocks visible as public events.
- A player with zero Orbs and no wallet can listen, help, bond, travel, and settle the Journal.
- Killing the AI provider leaves every core world action functional; explicit dialogue fails visibly without spending Orbs or emitting substitute speech, and incidental dialogue is skipped.
- A waiting player in a shared room can always see whose turn it is, ping them, watch the countdown, and never waits on a ghost.
- An operator can go from player report to resolution (including suspension) inside the console, and the queue reflects it.
- No client-supplied claim (card ids, affordability, outcomes) changes state in the official world.
