# CosyWorld Product Requirements

Last major revision: 2026-07. This document replaces the CosyWorld 2.0 PRD, which was written for the original one-room, Chat-only MVP and survived as a stack of amendments. The world it described has shipped and grown past it; this document sets direction from where the product actually is.

Companion documents:

- `docs/systems/09-cosyworld-rpg-system.md` (the RPG Bible) — authoritative mechanics design: Callings, Bonds, Clocks, Jobs, Fronts, Covenants, the Visit Ledger, ownership, and poems. This PRD does not restate it.
- `ENG.md` — architecture and engineering priorities.
- `ECONOMY.md` — Orbs, Boxes, packs, and the NFT bridge in detail.
- `AI.md` — AI gateway, payer modes, media pipeline, and combat design in detail.
- `GAP.md` — implementation status audit.

## What CosyWorld Is

CosyWorld is a shared AI MUD: one persistent cozy world that everyone enters together. A player becomes a generated avatar, keeps a home that is a true sanctuary, follows a Calling that says who they are, builds Bonds with residents and other players, and chooses when to walk out to a frontier with real stakes. Play happens through a one-button, transcript-first surface where the server always offers one meaningful contextual action — and every AI output, resident reply, dice roll, and world change is a public room event that everyone present sees.

The product should feel like living in a small fantasy world that remembers you — not like a dashboard, a wallet app, a quiz, or a one-on-one chatbot.

## Where the Product Stands

CosyWorld V2 is a playable, production-deployable game, not a prototype:

- 27 locations across CosyWorld Core (free) and the Ruby High: First Bell expansion (card-gated), with 68 cards and complete room sheets, validated by a content gate.
- The full verb surface: Chat (server-authored avatar speech), moderated typed `say` and `/me`, Listen, Travel, Take, Drop, Give, Use, Trade, Prepare, Rest, Work, Help, Attack, Defend, Flee, plus Calling/Bond/skill/ledger actions.
- The RPG retention layer first slice: Callings, first-class Bonds, sanctuary/frontier zoning, progress and danger clocks, seeded Jobs and Fronts, factions, the Visit Ledger with banking into skill steps and bond slots.
- An economy MVP: starter Orbs, claim-key-gated rewards, server-paid Chat spends, a player OpenRouter payer, durable Orb/AI-usage ledgers, and the Wooden Box burn → pack reveal bridge with production Solana/Core verification.
- Moderation basics: player reports, an operator console, protected all-room replay, actor suspension, and report retention.
- Browser and terminal clients over the same API, with a Playwright smoke, visual baselines, and a production deployment profile with strict guardrails.

The question this PRD answers is no longer "can the loop exist?" It is: **why does a player come back on day seven, and what do they tell a friend?**

## Product Pillars

Every feature must serve at least one of these; a feature that serves none does not ship.

1. **One shared world.** No private room copies, no resident DMs, no per-player AI responses. A resident reply is a world event broadcast to everyone present. Card ownership unlocks shared places, never private instances.
2. **Cozy by guarantee, stakes by consent.** The home and sanctuary rooms never decay, never see combat, and never advance while nobody is playing. Danger, player-powered clocks, and loss exist only on the frontier — where the player chose to walk.
3. **Identity through play.** A player should be able to say "I am the kind soul who ___, my home is ___, and I am slowly ___" after ten minutes. Callings, Bonds, and the Visit Ledger make that sentence mechanical and publicly remembered.
4. **One meaningful button.** The resting UI has exactly one primary action surface, derived by the server from world state. It is a suggestion with visible risk and effect, not the only choice — the command palette and focus rail give depth without turning the room into chrome.
5. **AI is a world actor, not the product.** AI proposes narration, resident speech, and media; the kernel decides truth. Every primary verb has a deterministic authored fallback, so the world stays warm when generation is down.
6. **Progression is earned, never bought.** Orbs buy amplification and cosmetics — never power, access, success, or ledger marks. The core loop (listen, help, bond, travel) always has a zero-Orb path.
7. **Ownership without a token.** The target ownership layer is CosyWorld's own signed provenance log (Ed25519, content-addressed, append-only) — gifting free and first-class, trading world-bound and lineage-preserving, secret poems as commit-reveal claim tickets. External NFTs remain an optional bridge that gates official expansions, never the base game.

## The Concept Budget

The systems layer is deliberately rich — Callings, Bonds, Clocks, Jobs, Fronts, Covenants, factions, claim keys, sanctuary/frontier. The player-facing surface must not be. The v1 swarm proved the ceiling: thousands of avatars ran a D&D text MMO inside ordinary Discord channels with an emoji-to-tool grammar (`src/services/tools/ToolService.mjs` — 🗡️ attack, 🛡️ defend, 🏃 move, 🔮 summon, ⚔️ challenge, 🧪 potion) and every avatar carrying its own identity emoji. The lesson: the world can be arbitrarily deep as long as the controls stay small enough to learn by watching one turn.

Two rules follow.

**Rule 1 — six player nouns.** A player should only ever need this vocabulary, and UI copy may not introduce more:

| Player word | What it covers | Internal machinery it hides |
| --- | --- | --- |
| You | avatar, stats, skills, conditions | stat blocks, tags, claim keys |
| Home | sanctuary, later your covenant | zones, covenant sheets, season clocks |
| Calling | who you are | calling tags, ledger triggers |
| Friends | bonds with residents and players | bond entities, reaction states, evolution gates |
| Journal | the Visit Ledger and banking it | marks, advancement points, skill steps |
| Orbs | the one visible currency | ledgers, payer modes, claim gating |

Everything else is *fiction, not vocabulary*: a clock is "the trail feels safer lately," a job is "someone needs help," a front is weather and trouble, a faction is who a character stands with. System names (clock, front, claim key, projection, sanctuary/frontier) never appear in the player UI. A new feature must fit an existing noun or replace one — the budget does not grow by default.

**Rule 2 — four signs.** The control surface direction is four universal emoji, the tightest playable projection of the one-button rule. The current server-ranked action offers already carry category/target metadata, so the four signs are intent lenses over the same kernel-validated actions:

- 💬 **Speak** — focused resident: Chat; the room: say/emote.
- 👀 **Notice** — the room: Listen; an item or resident: inspect, learn a want.
- 🐾 **Go** — an exit: Travel; in danger: Flee.
- ✋ **Do** — an item: Take/Use; a resident: Give; a job: Work/Help; a hostile: Attack; yourself: Defend/Prepare/Rest.

The server always shows what each sign will do for the current focus (they are labeled buttons in the browser, reactions in a future Discord transport, four keys in the terminal), so ambiguity is resolved by the same authority that ranks the primary action today. Four signs are phone-native, language-independent, work as Discord reactions with zero UI, and rhyme with the world itself — Whiskerwind already speaks the control language. This is a direction to prototype and validate, not yet law; the one-button surface remains the shipped baseline until the prototype earns its place.

## Users

- **The new wanderer.** Arrives with no context. Needs to become someone, learn one true thing, and feel the room notice them — within the first session, without typing, on a phone.
- **The returning regular.** The retention audience. Needs bonds that deepen, a ledger worth banking, a covenant that is theirs, and a frontier that visibly changed because players spent turns there.
- **The collector and supporter.** Holds cards, opens packs, unlocks expansions, gifts and eventually trades. Must always feel additive: their money makes the world fancier for everyone, never gates another player's progression.
- **The world designer.** Authors rooms, residents, jobs, fronts, and evolution tracks as worldpack data with a validation gate — not by editing runtime code.
- **The operator.** Runs the official shard: moderation queue, suspension, economy audit, deployment guardrails. Later: self-hosted shard operators with their own content and gates.

## Product Direction

### Now — earn the seventh visit

The loop exists; the priority is making it worth returning to.

1. **First-session arc.** Design and instrument an explicit arc: arrive → create avatar → commit a first card turn → learn a room truth → meet a resident → act on your Calling → bank your first Visit Ledger mark. Target: a first-time mobile visitor commits a card turn quickly, then reaches a banked ledger mark in under ten minutes without typing.
2. **Finish the retention layer.** Land the RPG Bible Phase 2 follow-ups: covenant contribution as a banked spend and additional advancement choices, so banking the ledger is always a real decision.
3. **Real faces.** Replace deterministic SVG placeholders with generated avatar portraits and card art through the media pipeline (see `AI.md`). The card is the player's identity artifact; it should be worth screenshotting.
4. **Public-traffic moderation.** Content filtering before commit, report-to-action operator workflow, and abuse review — the shared world cannot open wide without it. (Engineering detail in `ENG.md`.)
5. **Turn feel and mobile polish.** Quiet rooms with presence, at most one resident reply per turn, sparse player-triggered beats, readable transcript over art at mobile widths, accessibility contracts held. Action cards should use mini card images plus concise labels in the bottom bar, open a card-art detail/confirm surface before committing, and make play feel like deliberate turns instead of rapid-fire clicking.
6. **Unified turn cadence.** Move humans, residents, and ambient actors toward one room-level initiative timer: a confirmed player action consumes a turn, resident and world reactions resolve in initiative order, and the room does not accept another committed player action for that actor until the turn has settled. The first shipped guardrail is active-human room turns: when multiple active humans share a room, one human owns the card play and waiting humans get a timeout card that can ask them to play or pass instead of letting a passive timer advance the room.
6. **Four-sign prototype.** Build the 💬 👀 🐾 ✋ control surface (see The Concept Budget) over the existing ranked action offers and playtest it against the one-button baseline, on a phone, with a first-time player. If it wins, it becomes the default surface and the natural contract for a Discord transport revival of the v1 swarm.

### Next — a world that moves where you asked it to

1. **Covenants.** The shared home base: a named cottage/guild with its own sheet, boons, resources, projects, reputation, and per-member loyalty. This is the unit of ownership that survives a crowded world, and the Homemaker's week-over-week goal. (RPG Bible Phase 5.)
2. **A living frontier.** Player-turn portent movement for Fronts — frontier-only, opt-in-only, committed as audited world actions — so the Wanderer returns to consequences and new jobs created by play, and the sanctuary player returns to exactly the home they left.
3. **Conflict with objectives.** Objective clocks in danger rooms, nonlethal outcomes, gear durability that breaks to absorb harm, and Flee as a first-class success path. Combat stays one risk mode among many, never the default verb. (RPG Bible Phase 6.)
4. **Native ownership, phase one.** The signed card provenance log: native mints bound to the world events that earned them, free gifting, world-bound co-signed trading, and commit-reveal poem claims. A player owns, gifts, and trades a base-game card with no wallet.

### Later — many hearths

- The federation dial: from operator-signed authority (quorum 1) toward P2P quorum signing; messaging stays honest — "verifiable and permanent" until it is actually trustless.
- Self-hosted shard kit: own worldpacks, own gates, own ownership adapters; the official shard trusts only official feeds.
- A second official expansion beyond Ruby High: First Bell, proving the expansion pipeline is repeatable content work, not bespoke engineering.
- Designer tooling and community content packs over the worldpack format.
- Additional transports (Discord and the legacy companion surfaces) as thin adapters over the same world API.

## Requirements

### P0 — product law (held today; regressions are release blockers)

- A human must create an avatar before acting; returning players recover their avatar (local session or signed wallet) instead of duplicating people.
- The resting UI has exactly one primary action surface, server-derived; no permanent composer, send button, or navigation sidebar.
- All world mutation resolves through the C kernel; AI and clients never decide outcomes, rewards, access, or affordability.
- Every player-visible AI output is a shared room event; there are no private resident conversations.
- Sanctuary rooms reject combat and never receive autonomous pressure or decay.
- Every reward, mint, spend, and one-shot effect is claim-key gated and idempotent.
- The core loop is playable with zero Orbs and with AI generation unavailable.
- Resident speech contracts hold: Rati prose, Whiskerwind emoji-only (with accessible labels), Skull emote-only; at most one resident replies to a normal turn.
- Typed player speech (`say`, `/me`) is moderated and sanitized before it reaches the journal; server-authored `Chat` never takes player text.
- Content safety: cozy, non-explicit, no harassment, no gore escalation; engine-owned facts override character improvisation; residents never mention models, prompts, or system internals.

### P1 — current build targets

- The instrumented first-session arc, with time-to-first-banked-mark as a tracked metric.
- Covenant contribution and expanded banked-advancement choices.
- Generated avatar portraits and card art in the live product; media jobs are durable, idempotent, and payer-attributed.
- Moderation at public-traffic grade: pre-commit content filtering, operator workflow with a resolution-time target, documented policy.
- Action-card detail/confirm and the first unified-turn guardrails: no accidental double-fire, no hidden action costs, active-human card turns in shared rooms, timeout nudges for stalled human turns, and a clear path to resident initiative.
- Player-turn frontier movement and reset cadence shipped with its audit trail and the sanctuary-never-moves smoke assertion.
- Job rewards, consequences, and completion memory; Use/Give/combat can move job clocks.

### P2 — designed, staged behind P1

- Native provenance log live: native mints, gifting, world-bound trading, poem claims (consumable) and world-gate incantations (repeatable).
- Covenant-spawned jobs and seasonal cadence.
- Self-hosted shard configuration surface.
- Higher-level evolution tracks and reusable item classes.

## Non-Goals

- No private AI companions, teacher DMs, or per-user room instances — for any price.
- No pay-for-power, no purchasable progression, no anonymous secondary market, no speculation loop.
- Not a full D&D engine; the rules layer stays compact, legible, and kernel-audited.
- No dashboard/admin chrome in the player surface; operator tools live behind protected routes.
- No cross-shard routing or global presence in this era; shards scale as isolated processes.
- No poem-derived keys, ever: poems are tickets and incantations, keys are keys.

## Success Metrics

Activation:

- Percentage of first-time visitors who create an avatar.
- Time to first banked Visit Ledger mark (target: under ten minutes, mobile, no typing).

Retention (the metrics this era is judged by):

- Day-1 / day-7 return rate.
- Visits that bank at least one ledger mark; active Bonds per returning player; covenant membership rate once covenants land.

World health:

- Turns with more than one resident reply (keep near zero); AI fallback rate; constraint pass rate for resident speech contracts.
- Report resolution time; suspension appeal outcomes.

Economy health:

- Orb faucet/sink balance; percentage of sessions blocked on an Orb wall for a core-loop action (target: zero); pack/burn completion without support intervention.

## Risks

- **Retention layer under-delivers.** If ledger marks feel like chores, the whole Now bet fails. Mitigate by playtesting the first-session arc and keeping marks tied to genuinely novel events (truths, bonds, frontier returns), never grind.
- **Moderation debt blocks launch.** One shared world with open traffic and thin filtering is an incident, not a risk. Public-traffic moderation is a P1 gate, not a nice-to-have.
- **UI creep.** Every new system (covenants, trading, media) will ask for chrome. The one-button rule and transcript-first surface are product law; new surfaces must be focus states, not panels.
- **Economy drift.** Any path where Orbs or cards buy outcomes breaks pillar 6 permanently. The claim-key and kernel-authority invariants are the enforcement, and review must guard key granularity.
- **Trading reintroduces speculation.** World-bound, co-signed, lineage-preserving trades are the line; hold it even when a marketplace would be easier.
- **AI cost and latency.** Server-paid generation must stay budgeted per room; the player payer covers only explicit player actions; deterministic fallback keeps the product playable when providers fail.
- **Scope gravity toward simulation.** Covenants, fronts, and seasons can each become a management game. Ship the smallest slice that serves a fantasy, per the RPG Bible's acceptance criteria.

## Acceptance Criteria Snapshot

A release of the current era is acceptable when:

- A new mobile user commits a first card turn, then reaches a banked ledger mark in one session without typing.
- A returning user's home is exactly as they left it, and at least one opted-in frontier goal has visibly moved through player turns.
- The room transcript reads as a place: at most one resident reply per turn, player-triggered beats sparse, dice and clocks visible as public events.
- A player with zero Orbs and no wallet can listen, help, bond, travel, and bank the ledger.
- Killing the AI provider leaves every primary verb functional with authored fallback.
- An operator can go from player report to resolution (including suspension) inside the console, and the queue reflects it.
- No client-supplied claim (card ids, affordability, outcomes) changes world state on the official shard.
