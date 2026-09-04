# Player Journal as a Semantic Chronicle — Backlog

**Epic**: Replace the player Journal's event-log grammar with a deterministic
chronicle of meaningful story beats. Preserve canonical events and replay while
grouping their player-facing consequences into consistent, useful entries.

**Status**: Groomed and filed (2026-07-28). The linked issues are the source of
truth for each slice's implementation state.

**Execution backlog**: epic
[#505](https://github.com/cenetex/cosyworld/issues/505).

| Ticket | Issue | Priority | Depends on |
| --- | --- | --- | --- |
| JRN-0 — record the Journal contract | [#506](https://github.com/cenetex/cosyworld/issues/506) | P0 | nothing |
| JRN-1 — project typed `JournalBeatView` records | [#507](https://github.com/cenetex/cosyworld/issues/507) | P1 | JRN-0 |
| JRN-2 — group discovery and journey event chains | [#508](https://github.com/cenetex/cosyworld/issues/508) | P1 | JRN-1 |
| JRN-3 — separate context, open threads, and history | [#509](https://github.com/cenetex/cosyworld/issues/509) | P1 | JRN-1 |
| JRN-4 — migrate remaining event families and remove raw fallbacks | [#510](https://github.com/cenetex/cosyworld/issues/510) | P1 | JRN-2, JRN-3 |
| JRN-5 — add semantic coverage and disclosure regression gates | [#511](https://github.com/cenetex/cosyworld/issues/511) | P1 | JRN-2, JRN-3 |
| JRN-6 — keep raw evidence in developer tooling only | [#512](https://github.com/cenetex/cosyworld/issues/512) | P2 | JRN-4 |

**Related contracts**:

- [CosyWorld writing style](../../v2/docs/writing-style.md)
- [Player lexicon](../../v2/docs/player-lexicon.md)
- [Canonical world](../../v2/docs/canonical-world.md)
- [One canonical world ADR](../decisions/0003-one-canonical-world.md)

## Why now

The current Journal is a hybrid of player story, room state, and developer
event inspection. That makes each individual string look like a copy defect,
but the defects share one structural cause.

1. The surface renders current questions, first-tale updates, room memory, and
   room history as the same kind of console row
   (`v2/orchestrator-rust/src/index.html:3984`).
2. Copy is assembled through several independent paths:
   `statusUpdateMeta`, `eventText`, `sceneCardEventText`, and
   `atmosphericMemoryBeat`. They do not share one subject, tense, category, or
   fallback contract.
3. Unknown events fall back to their internal type. This exposes strings such
   as `journey.paused` and `pathway.discovered` to players
   (`index.html:10372`).
4. Internal mutations are treated as journal entries. `tag.applied` produces
   subjectless copy such as "is now path to Old Oak Tree," while movement is
   deliberately rendered with `Actor: origin -> destination` grammar
   (`index.html:9023`, `:10333`).
5. The existing coalescer only joins a few adjacent event pairs
   (`index.html:7264`). A single action can therefore leave separate search,
   tag, move, journey, and pathway rows.
6. Every row is a `<details>` disclosure even when its expanded text only
   repeats the collapsed summary (`index.html:8216`).
7. Browser smoke coverage enforces compact console mechanics, including an
   expansion on the first row, but does not require semantic copy or additive
   detail (`v2/scripts/smoke-browser.mjs:9092`).

The result is neither a trustworthy player Journal nor a sufficiently complete
developer event console.

## Product decision

The production Journal is a **player chronicle**, not an event inspector.

It answers three distinct questions in three distinct regions:

1. **Current place** — where am I, and what is the durable state of this place?
2. **Open threads** — what remains unresolved or newly available?
3. **Story so far** — what meaningful things happened here?

The canonical event journal remains the source of truth. The player Journal is
a deterministic projection over it. Projection may group or omit events but
must never change, replace, or reinterpret canonical replay data.

The compact visual treatment can remain. Console syntax is not part of the
product contract: `journal://`, `> event`, `> tag`, raw sequence numbers,
machine keys, colon-delimited payloads, and `->` movement are developer
language.

## Information architecture

### Current place

- One non-chronological summary, visually separate from history.
- Derived from room memory and current authoritative state.
- Never duplicated as the newest history row.

### Open threads

- Contains active shared questions, fronts, and concrete growth opportunities.
- Appears only when the player can understand what is unresolved or available.
- Does not duplicate action controls from the authoritative action hand.
- A vague statement such as "lets what happened shape what comes next" is not
  sufficient. Name the available choice or omit it.

### Story so far

- Contains chronological `JournalBeatView` records.
- One row represents one meaningful action or outcome, not one stored event.
- A row may cite several canonical source events.
- Routine intermediate mutations are evidence for a beat, not standalone
  player history.

## Player-copy contract

1. Use a closed category vocabulary: **story**, **discovery**, **travel**,
   **search**, **relationship**, **growth**, **work**, **item**, and
   **consequence**. Additions require a copy-contract change.
2. Never expose the labels **event** or **tag** in production Journal copy.
3. Every history headline is a complete sentence with an explicit subject and
   meaningful verb.
4. Shared history uses named third-person past tense: "Elsie discovered…",
   not a mixture of "you", fragments, present tense, and mutation syntax.
5. Use ordinary punctuation. Colons may join natural clauses but may not
   decode event payloads. Arrows are prohibited.
6. Routine beats use the memory-line register: concrete and flat. Rare
   discoveries may spend the rare-system-moment register defined by the
   writing-style contract.
7. Unknown event types are omitted from the player projection and counted as
   missing presentation coverage. Their type name is never the fallback copy.
8. The room-header ticker reuses the exact headline of the latest visible
   story beat. It does not run a second formatter.

## Disclosure contract

Every row contains one semantic category tag and one complete prose string.
Collapsed prose is clamped to one visual line. An expansion affordance appears
only when that prose actually overflows at the current rendered width.
Expanding the row unclamps and wraps the same prose node in place; it does not
reveal a duplicate headline or separate detail block.

Non-overflowing rows have no marker and are not keyboard-focusable
disclosures. Overflow must be re-evaluated after viewport, text-size, and font
changes. Expanded prose never exposes raw source events or becomes a second
action menu.

## Screenshot chain rewritten as beats

The reported Rain-Soft Garden sequence should project approximately as:

| Source events or state | Region | Player-facing result |
| --- | --- | --- |
| `location.searched` + pathway tag/mutation + `pathway.discovered` | Story so far | **Discovery — Elsie discovered a path to the Old Oak Tree while searching Rain-Soft Garden; the route is now available for travel.** |
| `actor.moved` + `journey.paused` | Story so far | **Travel — Elsie left Rain-Soft Garden for the Cosy Cottage; the journey to the Old Oak Tree is paused and can be resumed later.** |
| Banked growth or available advancement | Open threads, only if actionable | **Growth — A growth choice is ready for Elsie.** |

The search, tag, raw pathway event, move mutation, and pause event do not each
earn their own top-level row.

---

## JRN-0 — Record the Journal contract

**Priority**: P0
**Scope**: product contract and vocabulary
**Depends on**: nothing

### What to do

- Record the three-region information architecture and the distinction between
  canonical events and their player-facing projection.
- Decide whether the visible title stays "Journal"; recommended: keep it.
- Remove console syntax from the product contract while allowing the compact
  typography and density to remain.
- Record the category, tense, fallback, disclosure, and ticker rules above in
  the writing-style and player-lexicon documents.
- Record that the Journal remains scoped to the current place for this epic.
  A portable all-world avatar chronicle is a separate product decision.

### Acceptance

- Product, writing, and accessibility guidance agree on what belongs in each
  region.
- No contract calls the production Journal an event console or raw log.
- The vocabulary defines what a "story beat" means without introducing that
  phrase as required player-facing copy.

---

## JRN-1 — Project typed `JournalBeatView` records

**Priority**: P1 (load-bearing)
**Scope**: Rust projection/view model and browser consumption
**Depends on**: JRN-0

### What to do

- Add a typed player-facing projection with, at minimum:
  `id`, `source_event_seqs`, `category`, `headline`, optional `detail`,
  optional `consequence`, `location_id`, and an ordering sequence.
- Produce it deterministically from committed events and authoritative
  projection state. No language-model call belongs in this path.
- Make the server projection the owner of grouping and semantics. The browser
  renders the typed view and does not reconstruct meaning from raw event
  names.
- Extend the existing semantic-receipt idea rather than introducing a second
  incompatible grouping mechanism. A receipt's covered event sequences are
  evidence for one beat.
- Keep source sequences for traceability without exposing them in production
  HTML.
- Give the header ticker and history row the same `headline` field.

### Acceptance

- Replaying the same canonical journal produces byte-for-byte equivalent beat
  ordering, categories, and copy.
- A browser refresh does not change grouping or prose.
- The client has no unknown-event string fallback.
- Canonical events and old replay records remain unchanged.

---

## JRN-2 — Group discovery and journey event chains

**Priority**: P1 (first visible vertical slice)
**Scope**: search, pathway, movement, and journey semantics
**Depends on**: JRN-1

### What to do

- Group by committed action/causal identity, not adjacency alone.
- Project search plus its resulting item, avatar, exit, or pathway discovery as
  one discovery beat when the outcome is meaningful.
- Treat pathway tags and reveal mutations as evidence, not entries.
- Project movement plus journey start/progress/pause/complete as one travel
  beat unless two independently meaningful outcomes occurred.
- Name origin, destination, and resumable paused destination when available.
- Do not hide a meaningful consequence merely to reach one row; include it in
  the row's complete prose string.

### Acceptance

- The Rain-Soft Garden chain renders the three-region example above.
- Reordering non-semantic intermediate events inside the same causal group
  does not split the beat.
- `journey.paused`, `pathway.discovered`, `tag`, `event`, and `->` are absent
  from rendered player text and accessibility labels.
- A search with no discovery remains one clear search beat; a discovered route
  is not duplicated as search plus discovery.

---

## JRN-3 — Separate context, open threads, and history

**Priority**: P1
**Scope**: Journal DOM, hierarchy, and disclosure behaviour
**Depends on**: JRN-1

### What to do

- Render current place, open threads, and story history as semantically and
  visually distinct regions.
- Stop passing room memory through the generic history-row component.
- Convert shared questions/fronts into open-thread views with copy that names
  the unresolved matter.
- Keep chronological history ordered consistently and cap it without changing
  canonical storage.
- Replace unconditional disclosures with rows that are interactive only when
  their complete prose actually overflows one visual line.
- Re-evaluate overflow after resize and text-size or font changes.
- Preserve keyboard navigation, region labels, and useful focus states.
- Keep actions in the action hand. A thread may describe availability but does
  not submit an action from the Journal.

### Acceptance

- A player can distinguish current state, unresolved matters, and completed
  history without interpreting labels or chronology.
- Non-overflowing rows have no plus marker and are not focusable disclosures.
- Expanding every interactive row wraps the complete same prose without a
  duplicate detail block.
- Current-place copy does not reappear as the newest story beat.

---

## JRN-4 — Migrate remaining event families and remove raw fallbacks

**Priority**: P1
**Scope**: complete player-visible semantic coverage
**Depends on**: JRN-2, JRN-3

### What to do

- Inventory every event currently admitted by `eventIsJournalEvent` and every
  current question/front row.
- For each, decide: project as a beat, fold into another beat, present as an
  open thread/current-state fact, or omit as low signal.
- Migrate relationships, growth, work/clocks, items, rolls, combat, world
  simulation, and community-image milestones.
- Consolidate copy construction so the Journal no longer depends on four
  independently evolving event-text functions.
- Remove `event.type` and `"Something changed"` as production player
  fallbacks.
- Preserve authored semantic story receipts as the highest-fidelity source
  when their covered events are valid.

### Acceptance

- Every admitted player-visible source type has an explicit projection policy.
- No production path can surface a dotted event key or generic fallback label.
- Every headline passes the subject/verb, tense, category, and punctuation
  contract.
- Low-signal mutations do not produce empty, vague, or redundant rows.

---

## JRN-5 — Add semantic coverage and disclosure regression gates

**Priority**: P1
**Scope**: Rust tests, browser smoke tests, and golden fixtures
**Depends on**: JRN-2, JRN-3

### What to do

- Add golden projection fixtures for discovery, empty search, ordinary travel,
  paused journey, completed journey, growth availability, relationship change,
  clock progress, and an unknown event.
- Assert causal grouping and source-sequence coverage in Rust tests.
- Replace the browser assertion that the first row is always expandable with a
  truthful overflow-disclosure contract.
- Assert that the ticker text exactly matches the latest visible beat headline.
- Add a production-copy lint for dotted event keys, `> event`, `> tag`, `->`,
  `"Something changed"`, and subjectless `is now`/`shakes off` fragments.
- Preserve density, non-overlap, accessibility, and state-nonmutation coverage
  from the existing smoke test.

### Acceptance

- The screenshot regression is represented by a deterministic fixture.
- CI fails when a newly admitted event lacks an explicit projection policy.
- CI fails when a disclosure duplicates its prose in a separate detail block.
- CI proves that non-disclosure rows do not expose an expansion affordance.
- Presentation tests validate useful semantics as well as layout mechanics.

---

## JRN-6 — Keep raw evidence in developer tooling only

**Priority**: P2
**Scope**: diagnostics
**Depends on**: JRN-4

### What to do

- Remove raw-event inspectors from production Journal markup.
- Provide a development-only inspector or structured diagnostic endpoint that
  maps each beat to its source sequences and events.
- Make omitted and unprojected events inspectable without weakening the
  production fallback rule.
- Do not ship access credentials, private context, moderation fields, or hidden
  events through the inspector.

### Acceptance

- Developers can explain why a beat exists and which committed events support
  it.
- Production players cannot reveal event type names or raw payloads through
  Journal interaction.
- The diagnostic path obeys the same event-visibility and privacy rules as the
  room view.

## Epic completion gate

The epic is complete when:

1. The Journal contains no raw event taxonomy or mutation grammar.
2. One committed action produces at most one top-level beat unless it has two
   independently meaningful outcomes.
3. Every visible headline has a stable category, explicit subject, meaningful
   verb, consistent tense, and deterministic source.
4. Every expansion adds a fact; rows without detail do not expand.
5. Current place, open threads, and completed history are distinct.
6. The header ticker and latest visible beat cannot disagree.
7. Unknown presentation coverage is observable in development and silent in
   player copy.
8. Canonical replay and authoritative action state are unchanged.

## Out of scope

- Redesigning the action hand or duplicating its controls in the Journal.
- Generating Journal copy with a language model.
- Rewriting canonical historical events or breaking old replay records.
- Building a portable all-world avatar journal.
- A broad visual redesign of the room, transcript, or action cards.

## Generated page presentation

**Shipped**: Daily long-rest Journal pages have generated images and accessible
text through #817. The browser presents one page per avatar-day. It also shows
recent chat lines beneath a page and recent moments before the first page.

**Planning**: The wider image-only presentation proposed in #968 remains a
product change. That issue is a historical reference for the proposal.

Use the authoritative Journal pages, room memory, Visit Ledger marks, and daily
Journal state as inputs to the media pipeline. The proposed player surface is
a generated page image with a short accessible caption. Keep the source data
journaled and replayable behind that presentation.

Promote a bounded implementation slice after community-art retries recover
reliably and the campaign proof supports this presentation change. Define the
pending, failure, and accessible reading states before implementation. The
acceptance proof must cover the image and caption, client treatment of the
source rows, and replay of the authoritative Journal data.
