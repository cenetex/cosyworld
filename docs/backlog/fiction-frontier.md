# Fiction Frontier — Backlog

**Epic**: Every mechanical system event lands in the shared transcript as authored
natural-language prose. No system vocabulary, clock fractions, zone names, or
mechanical state labels ever reach the player transcript.

**Status**: Groomed, not estimated. Ordered by dependency, not date.

---

## Principles (acceptance gate for every ticket)

1. The transcript never shows: clock fractions (`3/4`), zone names (`frontier`),
   kind labels (`danger`, `progress`), or raw effect descriptors.
2. Events carry a **voice class** that drives prose tone:
   `ambient` (the room observes), `opportunity` (instinct surfaces),
   `stakes` (danger announces itself).
3. A mechanical change with no fiction beat is a missing case — no silent state
   transitions.
4. Authored beats beat generated ones. Generated beats beat raw content strings.
5. Every new event type lands with at least one transcript test that asserts
   the output contains no system vocabulary.
6. A world beat counts as seen only after a client renders it or sends an
   equivalent exposure receipt. Returning it in `/state` is delivery, not
   evidence of exposure.

---

## FF-1 — Cover the transcript fallthrough

**Priority**: P0 (blocks all other fiction work)
**Scope**: Browser `sceneCardEventText` in `index.html`
**Depends on**: nothing

The catch-all fallthrough at the bottom of `sceneCardEventText` — string
concatenation of actor name + raw event content — is where fiction goes to die.
Every event type that currently hits this path is a bug.

### What to do

- Audit every `type_name` the server can emit that reaches the browser (grep the
  Rust `append_*_event` callsites and cross-reference against
  `sceneCardEventText` cases).
- Add an explicit case for every event type currently hitting the fallthrough,
  even if the initial prose is a compact authored template.
- Change the fallthrough to log a console warning in dev (and render nothing in
  prod) so new uncovered types are immediately visible during development.

### Acceptance

- `grep` of all event type strings against `sceneCardEventText` shows zero
  uncovered types.
- The fallthrough path is unreachable in normal play. Smoke test confirms no
  `${actor} raw_content` lines appear in the transcript.
- Dev console warns on uncovered type; prod renders nothing rather than bad
  fiction.

---

## FF-1A — Make transcript exposure measurable

**Priority**: P0 (blocks the live seventh-visit cohort)
**Scope**: Browser transcript receipts + story metrics + CLI parity
**Depends on**: FF-1

### What to do

- Stop recording `world_beat_seen` while constructing or returning `/state`.
- Give each renderable world/story beat a stable exposure id derived from its
  journal event sequence and presentation contract version.
- After the beat is inserted into the visible transcript, send an idempotent
  exposure receipt naming actor, beat, client/transport, and state revision.
- Record `world_beat_seen` only after validating that receipt against an event
  visible to that actor at that location. A CLI or agent transport may use an
  equivalent acknowledged-delivery receipt, but must identify the transport.
- Make reconnects, repeated renders, and multiple tabs idempotent. Do not treat
  background `/state` polling or a hidden Menu panel as exposure.
- Require a valid `world_beat_seen` before `world_beat_answered` can be emitted.

### Acceptance

- Fetching `/state` without rendering changes no `world_beat_seen` metric.
- Rendering a world beat once produces exactly one seen metric even across
  reconnect, refresh, and multiple tabs.
- A forged receipt for an inaccessible location, unknown sequence, or
  non-renderable event is rejected.
- The browser transcript test proves every receipted beat has non-empty authored
  prose on screen; a raw or suppressed event cannot be counted as seen.
- Seventh-visit reporting excludes pre-migration delivery-based rows or labels
  them with a separate schema version.

---

## FF-2 — Fiction beat format for clocks

**Priority**: P0 (every clock tick in the transcript leaks system vocabulary today)
**Scope**: Content schema + Rust clock projection + browser rendering
**Depends on**: FF-1

Clock `label` is currently the only fiction carrier. The `— danger 3/4` suffix
is system vocabulary leaking through. A clock needs authored beats per segment
so each tick is a qualitative world change, not a fraction increment.

### What to do

- Add optional `beats: Vec<String>` to the `ClockState` / seed JSON schema.
  `beats[n]` is the prose rendered when the clock reaches segment `n` (1-indexed).
  Must be same length as `segments`. Optional; falls back to label-only if absent.
- When `beats` is present, `clock.updated` renders the beat string. When absent,
  render the label without any fraction suffix — the label itself must carry the
  qualitative state.
- Remove the `— danger 3/4` / `— progress 2/4` suffix from the rendering path
  entirely. The clock kind and fill fraction are never shown to the player.
- Add `beats` arrays to all existing seed clocks in `clocks.json`.

### Acceptance

- Moonlit Trail danger clock at 3/4 renders as an authored beat string, not
  `"Echo Shatters the Trail — danger 3/4"`.
- Clock without `beats` renders at fill change as e.g. `"The shared work
  shifts beneath Aria's hands; the trail grows quieter."` — no fraction, no
  kind label.
- Smoke test: search transcript for `/danger|progress|portent|\d\/\d/` and find
  zero clock event matches.

---

## FF-3 — Voice classes for events

**Priority**: P1 (enables differentiated prose tone)
**Scope**: Rust `EventView` struct + browser `sceneCardEventHtml` CSS + all
  event projection callsites
**Depends on**: FF-1

The `WorldPulse` already carries `PulseEffectClass` (ambient / opportunity /
stakes). Events need the same concept so the browser can render different tones
— quiet observation for weather, urgent framing for danger, tempting framing
for opportunity.

### What to do

- Add `voice: Option<String>` to `EventView` (values: `"ambient"`,
  `"opportunity"`, `"stakes"`).
- Thread it through all `append_*_event` callsites — default to `"ambient"` for
  neutral events, `"stakes"` for danger/front events, `"opportunity"` for
  discoverable rewards/jobs.
- Add CSS classes `.voice-ambient`, `.voice-opportunity`, `.voice-stakes` to
  `index.html` event line rendering (different left-border accent color or
  subtle background tint — ambient is muted, opportunity is warm, stakes is
  sharp/cool).
- Render nothing differently in the text itself yet — this ticket is visual
  tone only.

### Acceptance

- World simulation events arrive with `voice` set on the EventView.
- Three visually distinct transcript line styles are visible in the browser.
- Default voice is `ambient` — no loud styling for routine events.

---

## FF-4 — World simulation transcript beats

**Priority**: P0 (biggest single gap — weather, trade, faction, and conflict
  changes are invisible in the transcript)
**Scope**: Rust pulse projection + browser `sceneCardEventText` new cases
**Depends on**: FF-1, FF-3

The simulation pulse produces rich structured data (weather shifts, trade
flows, faction influence changes, conflict pressure) but these are only visible
through the `/world` API simulation view. They never land in the transcript
with literary treatment.

### What to do

- In the Rust pulse-application path, project each pulse sub-outcome as a
  discrete `EventView` with `voice` set appropriately and `content` carrying
  an authored prose string.
- Add `sceneCardEventText` cases for:
  - `world.weather.shifted`
  - `world.weather.held`
  - `world.trade.flowed`
  - `world.trade.disrupted`
  - `world.faction.influence_shifted`
  - `world.conflict.pressure_grew`
  - `world.conflict.pressure_eased`
  - `world.conflict.escalated`
- Each case reads the event fields and renders a full-sentence fiction beat.
  Never falls through to the raw `content` string concatenation.

### Weather rendering spec

| Event | Fiction shape |
|---|---|
| `world.weather.shifted` | "The [before] thins to [after]. The [location] smells of [biome_detail]." |
| `world.weather.held` | "The [weather] settles in and stays. [Location] wears it comfortably." |

### Trade rendering spec

| Event | Fiction shape |
|---|---|
| `world.trade.flowed` | "[amount] [resource] moves from [from] toward [to]. The [route_name] is open today." |
| `world.trade.disrupted` | "The [resource] between [from] and [to] can't find its way. The [route_name] is tangled." |

### Faction rendering spec

| Event | Fiction shape |
|---|---|
| `world.faction.influence_shifted` | "[Faction]'s [symbol/song/presence] carries further into [location] today." or recedes variant for decreasing influence. |

### Conflict rendering spec

| Event | Fiction shape |
|---|---|
| `world.conflict.pressure_grew` | "The strain between [factions] tightens in [location]. [Reason]." |
| `world.conflict.pressure_eased` | "Whatever pressed between [factions] in [location] has loosened, for now." |
| `world.conflict.escalated` | "Two [front/forces] meet in [location] and do not harmonize. The air hardens." |

### Acceptance

- Running 12 world ticks on a shard with active fronts produces weather, trade,
  faction, and conflict transcript beats visible in the browser.
- No beat contains the word `clock`, `tick`, `pulse`, `simulation`, `pressure`,
  `influence`, `trade_stock`, or a fraction.
- Smoke test transcript for simulation event types confirms all covered.

---

## FF-5 — `on_fill` beats for clock completion effects

**Priority**: P1 (clock chains are mechanical but should read like story beats)
**Scope**: Content schema + Rust `apply_clock_fill_effects` + browser rendering
**Depends on**: FF-2

When a progress clock fills and triggers a chain — advancing the danger clock,
setting a tag, completing a job — the player sees a stack of `clock.updated`
and `tag.applied` lines. These are individually correct but read as a checklist,
not a story moment. A clock filling to completion is a narrative threshold and
should render as a single composed beat, not a mechanical cascade.

### What to do

- Add optional `on_fill_beat: Option<String>` to `ClockState` / seed JSON. When
  present and the clock fills, render this beat instead of the individual
  effect event lines. The individual effects still fire — they're just not
  surfaced as separate transcript lines.
- The beat can reference effect outcomes with simple template variables:
  `{next_clock_label}`, `{tag_label}`, `{job_status}`.
- When `on_fill_beat` is absent, fall back to rendering individual beats
  (FF-2), but compose them into a single transcript block with a shared voice
  rather than separate lines.
- Add `on_fill_beat` strings to all existing clocks that have `on_fill` effects.

### Example

```json
{
  "id": "moonlit-trail.progress",
  "label": "Quiet the Moonlit Trail",
  "segments": 4,
  "beats": [
    "One echo softens. The trail listens more than it repeats.",
    "Coach nods once. Two of the gathered voices have gone still.",
    "The trail's chorus thins. Only the oldest echo remains.",
    "The trail is quiet. Coach sets down the last stray sound like a finished letter."
  ],
  "on_fill_beat": "Coach sets down the last stray sound like a finished letter. The trail is quiet. But silence this deep always wakes something — {next_clock_label}.",
  "on_fill": [
    { "AdvanceClock": { "clock_id": "moonlit-trail.danger", "amount": 1 } }
  ]
}
```

### Acceptance

- Filling Moonlit Trail progress clock renders a single composed beat that
  mentions the danger clock's label in fiction, not as a system reference.
- No individual `clock.updated` or `tag.applied` lines appear alongside the
  composed beat.
- Clocks without `on_fill_beat` still render their individual beats, but
  grouped into a single block.

---

## FF-6 — Faction/front event transcript presence

**Priority**: P2 (fronts produce great authored text but only through the
  inspect/journal API — they need transcript moments)
**Scope**: Rust front projection + browser `sceneCardEventText`
**Depends on**: FF-1, FF-3, FF-4

Fronts currently surface only as goal lines in the narrative panel and as
ported events in the simulation view. When a front's impending outcome clock
advances, or when a front moves from `active` to `imminent`, the transcript
should carry a distinct story beat that anyone present can read.

### What to do

- When a front's portent clock advances, emit a `front.portent.advanced` event
  with `voice: "stakes"` and a content string built from the front's
  `impending_outcome` and the clock's current beat.
- When a front's status changes (active → imminent), emit `front.status.changed`
  with the front's `premise` and `impending_outcome` woven into the content.
- Add `sceneCardEventText` cases for both.
- These are rare, high-impact beats — they should be visually distinct
  (border-left flare, slightly larger text, voice-stakes styling).

### Acceptance

- Advancing the Moonlit Trail danger clock emits a `front.portent.advanced`
  beat visible in the transcript: *"The trail is almost through listening.
  Coach's gathered echoes are finding a shape, and the shape is finding a
  voice."*
- A front hitting `imminent` status produces a transcript beat that names the
  stakes without naming the system: no `front`, `portent`, `clock`, or `status`
  words.

---

## FF-7 — Job completion ceremonies

**Priority**: P2 (jobs are the core cooperative loop; completion should be a
  shared transcript moment, not a state field)
**Scope**: Rust job projection + browser `sceneCardEventText` + reward
  projection
**Depends on**: FF-1, FF-2, FF-5

When a job's progress clock fills, the reward fires and the job status changes.
Today this surfaces as a `job.updated` event and an Orb award line. It should
be a ceremony — a distinct transcript moment that names what was accomplished,
who was present, and what changed.

### What to do

- On job progress clock fill (via `on_fill` or direct check), emit a
  `job.completed` event with `voice: "opportunity"` and content built from the
  job's `premise`, `reward.label`, and `consequence`.
- Emit a `job.rewarded` event for the Orb/item reward with a fiction framing:
  *"Aria earns 2 Orbs for quieting the trail's echo."* — not
  `orb_delta: 2, reason: job_reward`.
- Add `sceneCardEventText` cases for both.
- Witness credit: any player in the room when the job completes gets a
  `ledger.marked` event rendered as *"Watching the trail grow quiet teaches
  Aria something worth keeping."*

### Acceptance

- Completing a job produces at least two transcript lines: the completion beat
  and the reward beat, both in natural language.
- Witnesses in the room receive visible Journal mark events.
- No `job.updated` raw state line appears.

---

## FF-8 — Resident desire/autonomy as fiction

**Priority**: P2 (autonomous resident actions already work mechanically; they
  need fiction rendering not raw event templates)
**Scope**: Rust autonomy projection + browser rendering
**Depends on**: FF-1

When a resident autonomously wanders, picks up a desired item, or trades with
another resident, the events currently render through the generic `event_content`
templates — functional but not literary. A resident reclaiming her lost
keepsake should be a memorable transcript moment.

### What to do

- Add `sceneCardEventText` cases specifically for autonomous resident events,
  keyed on a new `voice: "resident"` or detected from NPC actor kind:
  - Resident pickup: *"Rati pauses, then carefully lifts the Wolfprint Charm. She had been looking for this."*
  - Resident trade: *"Rati and Skull exchange a quiet look. The charm passes
    between them — old belonging meeting new purpose."*
  - Resident wander: *"Rati follows a thread of cold air toward the Moonlit
    Trail. Something she wants is out there."*
- Use the resident's desire/reason data (already in the continuity system) to
  drive the prose shape.

### Acceptance

- Autonomous resident actions render with literary framing, not raw event
  templates.
- A resident picking up a desired item produces a beat that names *why* they
  wanted it.

---

## FF-9 — Prose validation gate

**Priority**: P1 (prevents regression — system vocabulary must not leak back in)
**Scope**: Smoke test suite + worldpack check script
**Depends on**: FF-1 through FF-8

The fiction frontier is a product invariant. It needs automated enforcement.

### What to do

- Add a `check-prose.mjs` script to `v2/scripts/` that replays a known event
  journal and greps the resulting SSE event stream for banned system vocabulary.
- Banned terms list (configurable): `clock`, `tick`, `pulse`, `simulation`,
  `pressure`, `influence`, `trade_stock`, `frontier`, `sanctuary`, `danger`,
  `progress`, `portent`, `tag.applied`, `tag.cleared`, `job.updated`,
  `ledger.banked`, `calling.revised`, `bond.created|revised|resolved`,
  `orb_delta`, `claim_key`, and any fraction pattern `\d+\/\d+` in event
  content.
- Add the check to `./v2/mvp.sh check` so it runs alongside kernel tests and
  worldpack validation.
- Add a unit test in the Rust test suite that constructs one of each event type
  and asserts the content string contains no banned vocabulary.

### Acceptance

- `./v2/mvp.sh check` fails if any event type produces banned vocabulary in
  its rendered content.
- A PR that adds a new event type without a `sceneCardEventText` case fails CI
  (the banned terms filter catches the raw template fallthrough).

---

## Dependency Order

```
FF-1 (cover fallthrough) ─────────────────────────────────────────────────
  ├── FF-2 (clock beats) ── FF-5 (on_fill beats) ── FF-7 (job ceremonies)
  ├── FF-3 (voice classes) ── FF-4 (simulation beats) ── FF-6 (front beats)
  └── FF-8 (resident autonomy fiction)

FF-9 (prose validation gate) ← depends on FF-1 through FF-8 existing
```

FF-1, FF-2, and FF-3 can be worked in parallel. FF-4 through FF-8 stack on
their dependencies. FF-9 is the final guardrail.

---

## Out of scope (not in this epic)

- AI-generated prose for event beats (keep it authored for now; AI-proposed
  beats are a separate swarm-content feature governed by `AI.md`).
- Localization / i18n of fiction beats.
- Prose quality review / editorial pass (separate content workstream).
- Voice variation by resident perspective (always room-level omniscient
  observer for now).
