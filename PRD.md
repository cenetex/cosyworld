# CosyWorld Product Requirements

Last major revision: 2026-07-02. This document replaces the CosyWorld 2.0 PRD, which was written for the original one-room, Chat-only MVP and survived as a stack of amendments. The world it described has shipped and grown past it; this document sets direction from where the product actually is — including the turn system, resident autonomy, and the one-slot world adopted this week.

Companion documents:

- `docs/systems/09-cosyworld-rpg-system.md` (the RPG Bible) — authoritative mechanics design: Callings, Bonds, Clocks, Jobs, Fronts, Covenants, the Visit Ledger, ownership, and poems. This PRD does not restate it.
- `ENG.md` — architecture and engineering priorities.
- `ECONOMY.md` — Orbs, Boxes, packs, and the NFT bridge in detail.
- `AI.md` — AI gateway, payer modes, media pipeline, and combat design in detail.
- `GAP.md` — implementation status audit.

## What CosyWorld Is

CosyWorld is a shared AI MUD played like a cozy tabletop: one persistent world that everyone enters together. A player becomes a generated avatar, keeps a home that is a true sanctuary, follows a Calling that says who they are, builds Bonds with residents and other players, and chooses when to walk out to a frontier with real stakes. Play happens through a transcript-first surface where the server deals a small hand of labeled action cards — playing one is a deliberate turn, and every AI output, resident reply, dice roll, and world change is a public room event that everyone present sees.

The product should feel like living in a small fantasy world that remembers you — not like a dashboard, a wallet app, a quiz, or a one-on-one chatbot.

## Where the Product Stands

CosyWorld V2 is a playable, production-deployable game, live-tested with simultaneous human and agent players:

- 28 locations across CosyWorld Core (free) and the Ruby High: First Bell expansion (card-gated), with 71 cards and complete room sheets, validated by a content gate.
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
5. **One meaningful hand.** The resting UI is a dealt hand of at most three labeled action cards plus shuffle — one surface, server-derived, each card showing its target, cost, and risk before commit. Playing a card is a turn. Speech (`say`, `/me`) is always available and never consumes a turn. No dashboards, no permanent composer, no navigation chrome.
6. **AI is a world actor, not the product.** AI proposes narration, resident speech, and media; the kernel decides truth. Core world actions remain playable without inference. Dialogue is never fabricated from canned text: an explicit dialogue action fails visibly and without charge when inference is unavailable, while incidental resident speech is skipped.
7. **Progression is earned, never bought.** Orbs buy amplification and cosmetics — never power, access, success, or growth. The core loop (listen, help, bond, travel) always has a zero-Orb path.
8. **Ownership without a token.** The target ownership layer is CosyWorld's own signed provenance log (Ed25519, content-addressed, append-only) — gifting free and first-class, trading world-bound and lineage-preserving, secret poems as commit-reveal claim tickets. External NFTs remain an optional bridge that gates official expansions, never the base game.

## The Concept Budget

The systems layer is deliberately rich — Callings, Bonds, Clocks, Jobs, Fronts, Covenants, factions, claim keys, sanctuary/frontier. The player-facing surface must not be. The v1 swarm proved the ceiling: thousands of avatars ran a D&D text MMO inside ordinary Discord channels with an emoji-to-tool grammar (`src/services/tools/ToolService.mjs` — 🗡️ attack, 🛡️ defend, 🏃 move, 🔮 summon, ⚔️ challenge, 🧪 potion) and every avatar carrying its own identity emoji. The lesson: the world can be arbitrarily deep as long as the controls stay small enough to learn by watching one turn.

Two rules follow.

**Rule 1 — six player nouns.** A player should only ever need this vocabulary, and UI copy may not introduce more:

| Player word | What it covers | Internal machinery it hides |
| --- | --- | --- |
| You | avatar, held item, skills, conditions | stat blocks, tags, claim keys, inventory slot |
| Home | sanctuary, later your covenant | zones, covenant sheets, season clocks |
| Calling | who you are | calling tags, ledger triggers |
| Friends | bonds with residents and players | bond entities, reaction states, evolution gates |
| Journal | memories that settle into growth | Visit Ledger marks, advancement points, skill steps |
| Orbs | the one visible currency | ledgers, payer modes, claim gating |

Everything else is *fiction, not vocabulary*: a clock is "the trail feels safer lately," a job is "someone needs help," a front is weather and trouble, a faction is who a character stands with. System names (clock, front, claim key, projection, sanctuary/frontier) never appear in the player UI. A new feature must fit an existing noun or replace one — the budget does not grow by default.

**Rule 2 — the hand is the controller.** The shipped control surface is a dealt hand of action cards: at most three labeled cards plus shuffle, each opening a card-art detail surface that names target, cost, and risk before commit. This won over both the bare one-button rail and the unlabeled-emoji experiment because it makes each turn a readable, deliberate choice. The same contract projects onto every future transport: cards become Discord reactions, terminal keys, or voice intents without new server concepts — the v1 emoji grammar remains the prior art for the Discord revival. Two laws hold regardless of transport: every card carries a visible label (never a bare glyph), and browsing the hand is free — only playing a card spends a turn.

## The One-Slot World

Adopted direction (2026-07-02) for the item layer, superseding the unbounded-inventory model. Six rules that are load-bearing for each other:

1. **One hand, one floor.** Every avatar holds exactly one item; every location's floor holds exactly one item. Taking is swapping with the room; dropping is placing. What you carry is who you are — the player holding the Hearth Tonic *is* the healer.
2. **Search is the faucet, emptiness is the gate.** Search is offered only when the room's floor is empty, and it can reveal an item drawn from the room's pool. The gate is world-state, not a claim key: carrying an item away creates an empty floor, search refills it, and full hands/floors naturally put the faucet to sleep. Circulation comes from slot pressure and player movement, not item deletion.
3. **Listen absorbs Bank.** Listening is the reflection verb: sit with the room to try for a truth *and* settle unbanked Journal marks into growth. The expressive choice lives in the spend (skill, bond slot, calling revision), which is unchanged. A settled room always offers something: listen (to grow), search (when the floor is empty), or go.
4. **Items are persistent.** World items are not consumables. Use, craft, and evolution may exhaust, attune, rename, tag, recharge, unlock, mint a card, create a new item, or mark the Journal, but they do not delete their input items. A tonic can be drained until recharged; a craft can bind two present items into a provenance event; the physical ingredients remain in their current hand/floor slots for future stories.
5. **Crafting grows the world.** Crafting can create new physical items, but only meaningfully: a crafted key opens a doorway, a crafted lantern wakes a route, a crafted badge calls a resident, a crafted relic anchors a new floor. Every recipe that creates a new item must also declare what new capacity or desire it adds — an unlocked location/floor slot, a resident/avatar role, a covenant project, or an evolution arrangement need — so the item/location/avatar ratio stays balanced as the world expands. Crafting mints cards from play, but its deeper job is making the world larger and better connected.
6. **Evolution is arrangement.** An evolution level's requirement generalizes from "give N items to a resident" to a **placement pattern**: put these X items into these Y hands and floors — a charm in Skull's keeping, a thread on the Silver Milepost, a bell left in the Garden. The one-slot world makes every placement exclusive, visible, and undoable-by-others, so a pattern in progress is shared drama. Each level's pattern can be a **generated quest list**: proposed (by AI or tables) from a closed vocabulary of existing item tags, reachable locations, and present residents; validated fail-closed like every descriptor; then committed as authoritative jobs. Completing the final placement triggers a public ceremony — placers and witnesses all earn Journal credit, the resident evolves, and the items remain in the world.

Consequences the design accepts on purpose: evolution becomes ceremony and logistics (X items, one pair of hands — take trips or bring friends); scarcity comes from occupied slots and meaningful placement instead of destruction; every item must be named, wanted, and storied because it can come around again; the card *collection* stays strictly separate from the physical inventory slot; and migration requires a world reset.

## Users

- **The new wanderer.** Arrives with no context. Needs to become someone, learn one true thing, and feel the room notice them — within the first session, without typing, on a phone.
- **The returning regular.** The retention audience. Needs bonds that deepen, a Journal worth settling, a covenant that is theirs, and a frontier that visibly changed because players spent turns there.
- **The collector and supporter.** Holds cards, opens packs, unlocks expansions, gifts, trades, and crafts. Must always feel additive: their money makes the world fancier for everyone, never gates another player's progression.
- **The world designer.** Authors rooms, residents, jobs, fronts, recipes, and evolution tracks as worldpack data with a validation gate — not by editing runtime code.
- **The operator.** Runs the official shard: moderation queue, suspension, economy audit, deployment guardrails. Later: self-hosted shard operators with their own content and gates.

## Product Direction

### Now — earn the seventh visit

The loop exists and multiplayer works; the priority is making the world worth returning to.

1. **The one-slot world.** Land the six rules above: single hand/floor slots, search-as-faucet, listen-absorbs-bank, persistent non-consumable items, and craft-as-world-growth. This is the structural fix for room exhaustion ("only go"), the renewable economy, and the forced-cooperation beat.
2. **First-session arc.** Instrument the arc: arrive → become someone → play a first card → learn a truth → meet a resident → settle the Journal. Target: a first-time mobile visitor settles their first growth in under ten minutes without typing.
3. **Turn cadence legibility.** The shipped room-turn system (one committed card per active human, ping/pong pacing, speech always turn-exempt) needs its remaining visibility work: a visible ping countdown for both sides, a clear "you've been pinged — play or pass" signal, and warm copy when a room's deck genuinely offers only exits.
4. **Economy circulation.** Wire the already-designed job Orb payouts; add witness credit (players present when a resident claims a desired item or evolves earn a Journal mark, so resident autonomy rewards spectators instead of robbing them); recover items from inactive avatars via resident desire-hunts; scope claim keys to played-time seasons so faucets reopen through play.
5. **Real faces.** Replace deterministic SVG placeholders with generated avatar portraits and card art through the media pipeline (see `AI.md`). The card is the player's identity artifact; it should be worth screenshotting.
6. **Public-traffic moderation.** Content filtering before commit, report-to-action operator workflow, resident line-variety cooldowns (no repeated ambient lines), and abuse review — the shared world cannot open wide without it.

### Next — a world that makes things

1. **Crafting.** The item-meets-room verb, recipes-as-worldpack, tag-keyed combination, AI-decorated names within kernel rails, and craft-created items that unlock or anchor new world capacity. Ships with its moderation surface (names are sanitized, authored fallbacks exist) and its economy role: creating provenance, tags, doorways, locations, resident hooks, and collection value without deleting the physical ingredients.
2. **Covenants.** The shared home base: a named cottage/guild with its own sheet, boons, resources, projects, reputation, and per-member loyalty — and the renewable sanctuary verbs (tend, brew, keep a promise) driven by room-sheet resources that make *home* the richest room instead of the first exhausted one. (RPG Bible Phase 5.)
3. **A living frontier.** Player-turn portent movement for Fronts — frontier-only, opt-in-only, committed as audited world actions — so the Wanderer returns to consequences and new jobs created by play, and the sanctuary player returns to exactly the home they left. Spent encounters reset through the same played-time seasons.
4. **Evolution as arrangement.** Placement-pattern evolution tracks with generated per-level quest lists, replacing the fixed two-item gift: patterns compile through the same fail-closed descriptor seam as clock effects, the kernel checks satisfaction against real world state, and ceremonies pay witness credit. This is the renewable quest engine — every resident level mints a fresh constellation of things to find, carry, place, and guard.
5. **Conflict with objectives.** Objective clocks in danger rooms, nonlethal outcomes, gear durability that breaks to absorb harm, and Flee as a first-class success path. Combat stays one risk mode among many, never the default verb. (RPG Bible Phase 6.)
6. **Native ownership, phase one.** The signed card provenance log: native mints bound to the world events that earned them — including craft events — free gifting, world-bound co-signed trading, and commit-reveal poem claims. A player owns, gifts, and trades a base-game card with no wallet.

### Later — many hearths

- The federation dial: from operator-signed authority (quorum 1) toward P2P quorum signing; messaging stays honest — "verifiable and permanent" until it is actually trustless.
- Self-hosted shard kit: own worldpacks, own gates, own ownership adapters; the official shard trusts only official feeds.
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

- The one-slot world live: single slots, search-as-faucet, listen-absorbs-bank, with the world reset that ships it.
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
- Self-hosted shard configuration surface.
- Higher-level evolution tracks.

## Non-Goals

- No private AI companions, teacher DMs, or per-user room instances — for any price.
- No pay-for-power, no purchasable progression, no anonymous secondary market, no speculation loop.
- Not a full D&D engine; the rules layer stays compact, legible, and kernel-audited.
- No unbounded inventories, stash tabs, or item spreadsheets — one hand, one floor, and the collection lives on the provenance log, not in your pockets.
- No consumable world items — use, craft, and evolution may exhaust or transform meaning, but must not delete physical items from the world.
- No dashboard/admin chrome in the player surface; operator tools live behind protected routes.
- No wall-clock world simulation; the world's pulse is its players.
- No cross-shard routing or global presence in this era; shards scale as isolated processes.
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

- **The one-slot migration is a hard cut.** It changes item semantics everywhere (kernel capacities, evolution flows, smoke tests, seeded content) and requires a world reset. Ship it as one package with its own gate coverage, not incrementally — half a one-slot world is worse than either whole.
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
- No settled room's hand ever collapses to exits alone: there is always listening to do, or a floor to search, or both.
- Two players can complete a resident's placement-based evolution ceremony together without consuming the arranged items, and a present witness earns a Journal mark when a resident claims what it desires.
- The room transcript reads as a place: at most one resident reply per turn, no repeated ambient lines, dice and clocks visible as public events.
- A player with zero Orbs and no wallet can listen, help, bond, travel, and settle the Journal.
- Killing the AI provider leaves every core world action functional; explicit dialogue fails visibly without spending Orbs or emitting substitute speech, and incidental dialogue is skipped.
- A waiting player in a shared room can always see whose turn it is, ping them, watch the countdown, and never waits on a ghost.
- An operator can go from player report to resolution (including suspension) inside the console, and the queue reflects it.
- No client-supplied claim (card ids, affordability, outcomes) changes world state on the official shard.
