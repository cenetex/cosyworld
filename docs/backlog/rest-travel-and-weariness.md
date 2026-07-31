# Rest, Travel, and Weariness — Backlog

**Epic**: Make rest the recovery verb the card layer already promises — graded
by place and carried gear, refreshing exhausted cards through the kernel, with
expedition depth visible as an unlabeled ring rather than a stamina number.

**Status**: Groomed and filed (2026-07-26); delivery is in progress. The
short-rest/Fatigue follow-on (RT-8, RT-9) was groomed 2026-07-29 and the
prepared-frontier-camp follow-on (RT-10) proposed 2026-07-30; all three were
folded in from their issues 2026-07-30. RT-0 through RT-7 track live issues;
RT-8 onward is direction.

**Execution backlog**: epic [#356](https://github.com/cenetex/cosyworld/issues/356).

| Ticket | Issue | Priority |
| --- | --- | --- |
| RT-0 — decisions | [#348](https://github.com/cenetex/cosyworld/issues/348) | P0 |
| RT-1 — `CW_ACTION_REST` with card refresh | [#349](https://github.com/cenetex/cosyworld/issues/349) | P1 |
| RT-2 — grade from place and gear | [#350](https://github.com/cenetex/cosyworld/issues/350) | P1 |
| RT-3 — lodging feature and a Core inn | [#351](https://github.com/cenetex/cosyworld/issues/351) | P1 |
| RT-4 — flip rest availability | [#352](https://github.com/cenetex/cosyworld/issues/352) | P1 |
| RT-5 — the expedition ring | [#353](https://github.com/cenetex/cosyworld/issues/353) | P1 |
| RT-6 — action reachability decision | [#354](https://github.com/cenetex/cosyworld/issues/354), amended by [#529](https://github.com/cenetex/cosyworld/issues/529) | P0 decision, resolved |
| RT-7 — lodging pays in fiction | [#355](https://github.com/cenetex/cosyworld/issues/355) | P2 |
| RT-8 — decide three short rests and the Spent hand | [#603](https://github.com/cenetex/cosyworld/issues/603), folded here | P1, direction |
| RT-9 — implement long-rest epochs and Spent recovery | [#604](https://github.com/cenetex/cosyworld/issues/604), folded here | P1, direction |
| RT-10 — require a prepared frontier camp | not filed | P1, proposed |

**Related architecture**:

- [SRD-Backed Action and Collectible System](../systems/04-action-system.md)
- [CosyWorld RPG System Bible](../systems/09-cosyworld-rpg-system.md)
- [ADR 0002: the action hand is authoritative state](../decisions/0002-action-hand-is-authoritative-state.md)
- [ADR 0005: thresholds, trails, and the strict referee](../decisions/0005-thresholds-trails-and-strict-referee.md)

**Related backlog**: [Action Verbs And Economy](action-verbs-and-economy.md)
and [Thresholds, Trails, And The Strict Referee](thresholds-trails-and-strict-referee.md).
AVE owns the verb lexicon, per-offer cost/risk presentation, and complete legal
reachability. THR owns Anchors, Scout forays, cairns, and traversal recovery
proof, and consumes the Fatigue restrictions decided here rather than inventing
a second rest system. This backlog owns what rest *does* and where it is legal.
Where they touch — the cost surface a rest offer renders into, and the Recover
intention group — AVE is authoritative and RT consumes it.

## Why now

Three facts make this a coherent slice rather than a feature request.

1. **Nothing ever un-exhausts a card.** `charges` is set at creation
   (`v2/core-c/src/cosy_kernel.c:252`, `:269`) and only ever decremented into
   `CW_CARD_ZONE_EXHAUSTED` (`:830`, `:866`). The deck UI already tells players
   otherwise — "Used spells stay exhausted until refreshed"
   (`v2/orchestrator-rust/src/index.html:8564`). Exhaustion is a one-way door
   with a promise painted on it.
2. **Rest has no upside.** The projection route
   (`v2/orchestrator-rust/src/main.rs:35921`) only clears tags. It removes
   debuffs and grants nothing, which is why it reads as a chore.
3. **A two-axis weariness model already exists and already replays** — the
   `tired` condition plus one `frontier_travel_since_rest:<seq>` tag per
   frontier move (`main.rs:10474`), required count scaling with level
   (`main.rs:16529`). It is invisible and its availability rule is inverted.

The card-zone and capacity work in PRD P1 is the right moment: camping gear
that costs carry slots which could hold loot is the trade-off that makes this
an expedition system instead of bookkeeping.

## Current behavior (baseline to preserve or migrate)

| Concern | Today | Location |
| --- | --- | --- |
| Rest action | Projection only; clears `tired`, `trained_since_rest`, all `frontier_travel_since_rest:*` | `main.rs:35921` |
| Frontier rest cost | Advances the room's frontier danger clock by 1 | `main.rs:36006` |
| Gear exemption | Hardcoded to Moonlit Trail + Hearth Tonic warmth tag | `main.rs:16596` |
| Rest availability | Requires `tired` **and** travel count ≥ `level.clamp(1,4)` | `main.rs:16523` |
| `tired` sources | Work, repeated unprepared Help, repeat frontier Listen, knack practice | `main.rs:10766`, `:11512`, `:23081`, `:35697`, `:35880` |
| Hand promotion | Rest ranks 84 outside the frontier; provider `rules:recovery` when tired | `main.rs:19846`, `:19961` |
| Action reachability | Browser presents two suggestions plus a complete grouped chooser; `hand.shuffled` and free `shuffle`/`more` command compatibility remain | `main.rs`, `index.html` |
| Lodging | `Wayside Lantern Inn` exists only in `v2/content/the-lantern-keeper/` | — |
| Core zoning | 6 sanctuary / 16 frontier room sheets, no lodging rung | `v2/content/core/room_sheets.json` |

---

## Principles (acceptance gate for every ticket)

1. Rest is graded by **place and carried gear**, never by a currency and never
   by a continuous meter.
2. Refreshing charges and card zones is authoritative state, so it crosses the
   C kernel. Tag clearing may stay projection.
3. Weariness never removes a legal option. A full ring raises risk; it never
   blocks Travel, or a player strands with an empty hand.
4. Sanctuary rest is always free, always complete, and never interruptible —
   `PRD.md` pillar 2 holds without exception.
5. Lodging is paid in fiction (access, bond, job, room resource), never in
   Orbs. The only negative Orb reason stays `community_image_generation`.
6. The ring is a projection served typed from `views.rs`, computed from state
   that already replays. The client never derives it from tags.
7. No new player-facing noun. "Stamina" and "weariness" are system words and do
   not appear in player copy (`PRD.md:56`).
8. Old journaled rest records keep their tag-clearing meaning. A new grade
   semantic needs a new action code, never a reinterpretation.
9. A cairn, Signal Anchor, temporary Mark, active Lead, route familiarity, or
   discovered place is navigation state, not shelter or rest entitlement.
   Camp still requires equipped shelter; Lodged and Hearth keep their own
   eligibility.

ADR 0005 does not change current weariness or Rest behavior. The proposed
short-rest/fatigue cadence is owned by
[#603](https://github.com/cenetex/cosyworld/issues/603) and must explicitly
supersede any conflicting current rule before implementation in #604. Scout
and Pressure consume that decision; they cannot embed a second fatigue ladder.

---

## RT-0 — Record the rest-grade and ring decisions

**Priority**: P0 (blocks every ticket below; resolves a product-law conflict)
**Scope**: ADR + PRD amendment
**Depends on**: nothing

### What to do

- Record the three-rung rest ladder — Hearth (sanctuary), Lodged (a room with
  the lodging feature), Camp (frontier with equipped shelter) — and the fourth
  case where frontier rest without gear is simply not offered.
- Record what each rung refreshes, so the grade ladder is a contract rather
  than tuning: Camp clears `tired` and one spell; Lodged clears `tired` and
  `trained_since_rest` and the whole spell hand; Hearth clears everything
  including the expedition counter, charms, and relics.
- Record that lodging is never Orb-priced, and name the permitted gates:
  access, an existing bond, a completed job, or an authored room resource.
- Record the ring as **expedition depth**, filling as the player travels out,
  discrete pips equal to `frontier_travel_since_rest_required`. Record that it
  is unlabeled, single (not concentric with HP), and animates only on commit.
- Consume the reachability decision from ADR 0002 and RT-6. Rest and recovery
  offers use the same ordinary hand and complete chooser as every other offer;
  no rest ticket owns or changes that surface.
- State whether the ring supersedes or coexists with any future HP surfacing.
  Recommended answer: one ring, weariness only; wounds get portrait treatment.

### Acceptance

- The ADR names the four rest grades, their refresh contracts, the lodging
  gates, and the ring's semantics.
- `PRD.md`, ADR 0002, and the RPG bible agree that the two-card hand is a
  spotlight and the grouped chooser renders the complete legal set.
- The RPG bible's Rest row (`docs/systems/09-cosyworld-rpg-system.md:417`)
  reflects the kernel decision rather than "projection action now."
- No document describes rest as both currency-priced and zero-Orb.

---

## RT-1 — Add `CW_ACTION_REST` with card refresh

**Priority**: P1 (load-bearing; closes the exhaustion dead end)
**Scope**: C kernel + ABI + Rust FFI + replay mapping
**Depends on**: RT-0

### What to do

- Add `CW_ACTION_REST = 26` after `CW_ACTION_THEFT`
  (`v2/core-c/include/cosy_kernel.h:152`). Do not overload an existing code.
- Give the action a rest-grade argument supplied by the orchestrator. The
  kernel validates and applies; it does not infer the grade from geography.
- Implement charge restoration and `CW_CARD_ZONE_EXHAUSTED` → prior-zone
  transitions per grade, respecting the profile-declared `exhaustion` recovery
  string (`v2/orchestrator-rust/src/content_load.rs:749`) rather than a
  hardcoded rule.
- Emit one authoritative event per refreshed card so the transcript can render
  recovery as a public beat.
- Reject a grade the caller is not entitled to rather than silently downgrading
  it.
- Add the Rust FFI wrapper, replay mapping, and C tests in the same change,
  per the kernel-rule checklist in `CLAUDE.md`.
- Leave the existing projection rest route intact and journaled as-is; old
  records keep their meaning.

### Acceptance

- A spell used to exhaustion, then rested at Hearth grade, is castable again,
  and the transition is journaled and replayable.
- Replaying a journal containing pre-RT-1 rest records reproduces the old
  tag-only outcome exactly; the golden replay fixture is extended, not edited.
- Kernel tests cover each grade's refresh scope, an over-claimed grade, and a
  rest with nothing to refresh.
- The deck UI's refresh promise (`index.html:8564`) is true.

---

## RT-2 — Derive rest grade from place and carried gear

**Priority**: P1
**Scope**: Rust projection + item capability schema
**Depends on**: RT-1

### What to do

- Introduce a declared `camp_shelter` item capability. Keep it a capability on
  the existing `tool` role rather than a ninth role — the role vocabulary
  (`consumable`, `container`, `generic`, `relic`, `skill_charm`, `spell`,
  `tool`, `weapon`) stays closed.
- Require the shelter to be validly equipped, not merely owned, matching the
  container capacity rule.
- Replace `hearth_tonic_warmth_guards_rest` (`main.rs:16596`) and its
  `MOONLIT_TRAIL_LOCATION_ID` constant with the capability check. Preserve the
  Hearth Tonic's existing warmth behavior by giving the item the capability.
- Derive the grade in one place: sanctuary → Hearth, lodging feature → Lodged,
  frontier with equipped shelter → Camp, otherwise not offered.
- Keep the frontier danger-clock tick on Camp grade only.
- When rest is not offered on the frontier, give the hand an honest reason
  naming the missing gear, in register per `v2/docs/writing-style.md`.

### Acceptance

- Resting on the frontier with an equipped shelter does not advance the danger
  clock; without one, rest is absent from the legal set entirely.
- The Moonlit Trail behavior covered by
  `hearth_tonic_warmth_spends_to_block_frontier_rest_danger`
  (`main.rs:55991`) holds with no location ID in the code path.
- Grade derivation has one call site and is covered for all four cases.
- A shelter that is carried but unequipped does not confer Camp grade.

---

## RT-3 — Add the lodging room feature and a Core inn

**Priority**: P1 (the free world currently has no middle rung)
**Scope**: Worldpack content + compiler validation
**Depends on**: RT-2

### What to do

- Add a `lodging` room feature to the room-feature schema with its own
  validation, so lodging is authored data rather than a location allowlist.
- Author at least one lodging room in `v2/content/core/` reachable from the
  Cottage hub, so the ladder exists without any expansion pack.
- Give `Wayside Lantern Inn` (`v2/content/the-lantern-keeper/`) the feature.
  Per `CLAUDE.md`, cross-pack topology belongs in composition data, not in
  either reusable pack.
- Run the worldpack lock and compile, and commit the generated bundle with the
  lock, per the content workflow.

### Acceptance

- A zero-Orb player with no expansion cards can reach a lodging room from The
  Cosy Cottage and rest there at Lodged grade.
- The content gate rejects a lodging feature that omits its required fields.
- No runtime code names an inn by location ID.

---

## RT-4 — Flip rest availability from grind gate to place gate

**Priority**: P1
**Scope**: Rust projection + journal compatibility
**Depends on**: RT-1

### What to do

- Replace `rest_available` (`main.rs:16523`). Today it requires `tired` **and**
  travel count ≥ required, which withholds rest until the player has gone far
  enough. Rest should be offered wherever the grade is legal.
- Keep the anti-grind property by cost and effect, not by absence: a rest with
  nothing to refresh and no tags to clear stays out of the ranked hand while
  remaining reachable as a legal action.
- Preserve `frontier_travel_since_rest_required` as the ring's pip count and
  the Hearth-grade reset target; it stops being an availability predicate.
- Confirm the existing rank promotion (`main.rs:19846`) and `rules:recovery`
  provider (`main.rs:19961`) still surface rest at the right moment.

### Acceptance

- A player who has never left sanctuary can rest at home.
- `tired_actor_must_rest_before_more_project_exertion` (`main.rs:55729`) still
  passes or is replaced by an equivalent assertion on the new semantics.
- No journaled action changes meaning; the flip lives in offer projection only.

---

## RT-5 — Serve and render the expedition ring

**Priority**: P1
**Scope**: `views.rs` projection + browser client
**Depends on**: RT-4

### What to do

- Add a typed actor-view field carrying filled count, pip total, and a
  needs-rest flag. The client must not read tags or infer the ring.
- Render an unlabeled segmented ring around the avatar portrait, 1–4 pips,
  filling outward as the player travels into frontier rooms.
- Give the tired state a soft, dimmed treatment rather than an alarm colour;
  cozy register, no red.
- Animate only on commit. Nothing about the ring may move on a wall clock.
- Do not add a second concentric arc for HP. If wounds need visibility, treat
  the portrait itself.
- Add the ring to the visual baseline set.

### Acceptance

- The ring's filled count equals `frontier_travel_since_rest_count` after any
  sequence of moves, verified across a snapshot round trip and a replay.
- No player-visible string contains "stamina," "weariness," or "tired" as a
  gauge label.
- The ring does not re-render or animate on a timer with no committed turn.
- Mobile viewport keeps the ring legible at portrait size.

---

## RT-6 — The two-card spotlight has a complete chooser

**Priority**: P0 decision, no implementation of its own
**Scope**: Decision only; recorded in ADR 0002 and consumed by AVE-3
**Depends on**: RT-0

The originating design conversation asked for a binary choice with an escape
hatch — *don't like these two? here are two others*. #354 initially resolved
that request in favor of **redeal** alone. #529 supersedes the reachability
portion of that decision after playtest fixtures proved the browser could
collapse same-kind target offers before the redeal cycle.

### Resolution

- The ordinary resting surface remains exactly two suggested cards plus one
  compact control that opens the complete legal set, grouped by intention and
  target.
- Redeal remains an optional control inside the chooser. It pages the finite
  authoritative order without repeats until the pool is exhausted, then cycles.
- `hand.shuffled` is the journal record. Redeal consumes no turn, currency,
  item use, or progression and cannot change legality, rank, target, cost,
  risk, effect, or resolver.
- The chooser is a rendering of the authoritative `action_offers` projection,
  not a second legality source. It must preserve all same-kind targets and use
  the same submission and stale-offer guards as the two suggestions.
- Rest and recovery offers require no special surface. They enter the same
  legal set and can appear in the opening pair or a later redeal.
- ADR 0002 requires exactly two suggestions, a complete accessible chooser,
  and the optional journaled redeal. Command aliases remain compatible.

### Acceptance

- `PRD.md`, the action-hand ADR, and both backlogs describe the same
  two-suggestion spotlight and complete authoritative chooser.
- Browser fixtures prove every legal action and target is reachable directly,
  while shuffle assertions continue to cover the optional turn-free redeal.
- No RT ticket depends on the outcome; the rest ladder is surface-agnostic.

---

## RT-7 — Give lodging a fiction price

**Priority**: P2
**Scope**: Jobs + bonds + worldpack content
**Depends on**: RT-3

### What to do

- Make the first stay free and subsequent stays ask for something the world
  already models: a delivery, firewood, a message carried, or a bond with the
  keeper.
- Seed the ask through the existing job system so the inn becomes a content
  faucet — an expedition converts into work — rather than a currency sink.
- Grant a Lodged-grade boon that is mechanically distinct from Hearth: a hot
  meal as a next-risk reduction, i.e. a free Prepare, so the middle rung has
  its own identity instead of being a weaker home.
- Verify no path debits Orbs.

### Acceptance

- A player with zero Orbs and no wallet can lodge indefinitely by doing the
  inn's work.
- The Orb ledger records no lodging-related debit under any reason.
- Lodging an nth time without satisfying the ask fails visibly, with a reason,
  and without charging anything.

---

## RT-8 — Decide Three Short Rests And The Spent Survival Hand

**Priority**: P1 / later / parked (decision before implementation)

**Scope**: Superseding ADR, migration law, player-facing action contract

**Depends on**: original rest ladder decisions; coordinates with THR-0/THR-7

### Candidate rule to decide

- A long-rest epoch grants three short-rest uses.
- Fatigue has four states: Fresh, Winded, Weary, and Spent.
- A short rest costs one turn and one use, clears one Fatigue plus transient
  `tired`, and may refresh one eligible limited resource. Unsafe short rests
  can trigger pressure; they do not reset the expedition.
- Camp, Lodged, and Hearth consume a full watch and begin a new epoch, with
  distinct place/gear costs and refresh contracts. Camp remains in the
  expedition and can attract frontier pressure; Hearth closes it.
- At Spent, disallow new outward scouting, searching, studying, working,
  forcing, and route branching. Preserve the survival hand: retreat to the
  last secure Anchor, short rest if a use and opportunity remain, Camp, accept
  aid, defend/flee, or call for rescue.
- No action may transition the character to Spent unless retreat, Camp, aid,
  or rescue remains reachable.
- Cairns are navigation/recovery Anchors and never satisfy shelter.

### Decisions required

- Confirm or replace three uses, four Fatigue states, and one step recovered.
- Decide whether a short rest refreshes a chosen resource, an archetype-fixed
  resource, or no resource beyond Fatigue/tags.
- Map the complete action taxonomy into allowed and disallowed Spent groups.
- Reconcile and supersede conflicting parts of ADR 0004 and RT-0 without
  changing historical event meanings.
- Fix player-facing copy without exposing system words or hidden pressure.

### Acceptance

- One ADR owns the cadence, Spent hand, migration, and exact superseded text.
- The rule prevents short-rest spam without creating a recovery soft-lock.
- Cairn, Camp, Lodged, and Hearth have non-overlapping meanings.
- Every Spent state has at least one understandable legal recovery route.

---

## RT-9 — Implement Long-Rest Epochs And Spent Recovery

**Priority**: P1 / later / blocked

**Scope**: Kernel/rest state, offers, replay, traversal reachability

**Depends on**: RT-2, RT-4, RT-5, RT-8

### What to do

- Persist remaining short rests and long-rest epoch in authoritative state.
- Apply the accepted Fatigue thresholds, recovery, time costs, rest-grade
  reset, card refresh, and pressure hooks.
- At Spent, filter the complete legal surface to the accepted survival hand;
  do not merely hide actions from the two-card spotlight.
- Reject an unavailable rest without spending time, a rest use, or any partial
  mutation.
- Project remaining capacity and honest disabled reasons without exposing
  hidden table/pressure state.
- Preserve snapshots, reconnects, replay, and historical rest records.
- Extend worldpack reachability validation so an authored route cannot enter
  Spent with no retreat, Camp, aid, or rescue edge.

### Acceptance

- Exactly the accepted number of short rests succeeds in one epoch; the next
  is rejected without mutation.
- A valid long rest resets the epoch and applies its grade-specific effects.
- Spent exposes the survival hand across browser, terminal, API, and inference
  controllers.
- Direct and inferred intents have identical legality and consequences.
- Golden replay preserves Fatigue, rest count, offered recovery, time, and
  pressure results.
- No legal authored traversal can strand the party.

---

## RT-10 — Require A Prepared Frontier Camp

**Priority**: P1 / later / proposed

**Scope**: frontier Camp eligibility, durable site preparation, fixture
composition, and migration from the gear-only rule

**Depends on**: RT-2, THR-7S; coordinates with RT-8 and RT-9

### Candidate rule to decide

- Hearth and Lodged retain their existing place rights.
- Frontier Camp requires both:
  - a durable prepared navigation site such as a cairn, Signal Anchor, or
    pack-equivalent fixture; and
  - equipped Shelter capability.
- An established fire ring is a separate higher development tier. It grants
  the authored third connection slot and can host a fire, but a ring alone
  supplies no fuel, light, warmth, or rest grade.
- A lit fire consumes fuel and may improve a Camp or prevent an authored cold
  or dark consequence. It is not durable connection capacity.
- Packs without cairn stone provide a mechanically equivalent installed
  marker made from suitable local or carried materials. The capacity and rest
  contract stay the same even when vocabulary changes.

### What to do

- Record whether the prepared-site requirement supersedes the current
  `frontier + equipped camp_shelter` Camp derivation or is introduced only for
  newly authored expedition regions. Recommended: supersede it with an
  explicit compatibility projection for historical saves.
- Reuse THR-7S construction receipts and fixtures; Rest must not create cairns,
  fire rings, fuel, or shelter implicitly.
- Project honest separate disabled reasons: no prepared site, no Shelter,
  missing required fuel, unsafe pressure, or Spent restriction.
- Ensure the first outbound leg always has a reachable authored preparation,
  retreat, lodging, sanctuary, aid, or rescue path before the actor can become
  unable to continue.
- Give successful preparation, lighting, extinguishing, and Camp semantic
  Journal beats without exposing internal capability nouns.

### Acceptance

- Carrying a tent into arbitrary wilderness is no longer sufficient for Camp
  under the accepted new-content rule.
- A cairn plus equipped Shelter permits Camp without pretending the cairn is a
  bed.
- A fire ring without fuel is durable infrastructure but not a lit fire; a
  transient campfire without the installed ring does not grant connection
  capacity.
- Sanctuary and lodging remain usable without cairns.
- Direct input, inference, reconnect, replay, and AI-offline fallback derive
  identical Camp eligibility and disabled reasons.
- No route can force a tired or Spent actor into an unrecoverable state.

---

---

## Open questions

- **Ring direction.** Fills (depth travelled) or drains (supplies left)?
  Recommended: fills, matching the existing tag accumulation and reading
  cozier. Drains is the more orthodox OSR framing and is the alternative if
  playtesting shows depth reads as progress rather than cost.
- **Closed — reachability surface.** #529 amended RT-6: the compact complete
  chooser is authoritative presentation, with deterministic redeal optional
  inside it.
- **`tired` from Work.** Work is currently the main `tired` source. Once rest
  is graded and gear-gated, tiring a player inside sanctuary may strand nothing
  but still feel punitive. Confirm during RT-4 whether Work should tire only on
  the frontier.
- **Short-rest refresh.** RT-8 must decide whether the limited-resource refresh
  is player-selected, archetype-fixed, or omitted. Do not bury that product
  decision in RT-9 implementation.
