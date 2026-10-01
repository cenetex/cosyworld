# Changelog

## 1.0.208 — 2026-10-01

- Ask the level-up self-description job for its three lines in plain words.
  Production logs showed these jobs dying after three attempts with "must
  contain PERSONA, APPEARANCE, and CONTINUITY lines": the voice model
  (gpt-5.4-nano) answered the terse `AWAKEN · PERSONA: / APPEARANCE: /
  CONTINUITY:` cue in character, and in a lab run returned the three lines in 0
  of 10 attempts. With a plain format request it returned them in 12 of 12.

## 1.0.207 — 2026-10-01

- Reject a free-context reply that still carries `*` markup after extraction:
  it has no spoken words, and one leaked a persona goal in italics.
- Hoppycat goal motivations are now the residents' own first-person thoughts.
  Models quote the goal lines back, and a third-person motivation turns into a
  narrator voice. Pack 0.4.7, world 9; the live bundle is declared
  replay-compatible.

## 1.0.206 — 2026-10-01

- Give free-context prompts the shape a model continues as speech. A prompt
  lab run against the pool models showed that the physical description invites
  body narration and the "so. hi." cue makes a model introduce itself. The
  summoning is now the surfacing, the persona, and one positive speaking habit.
  The user message ends with the conversation as a `Name: line` transcript and
  then `Name:` for the speaker's turn.
- Extract the spoken words from a reply before the gate judges it: action beats,
  inline `*action*` spans, bold markers, the speaker's own label, and paragraph
  breaks. Models that roleplay are kept instead of rejected and redrawn.
- Move `x-ai/grok-4.3` to the common voice tier: in the lab it gave the
  shortest in-voice lines.

## 1.0.205 — 2026-10-01

- Trim an over-long free-context line to whole sentences within the word
  budget, so a model with no length rule in its prompt is kept instead of
  rejected and redrawn. A line whose first sentence alone is over budget, or
  that has several paragraphs, is still left whole for the gate.
- Take `google/gemini-3.5-flash` out of the Lonely Forest voice pool: the
  provider rejects it with "Reasoning is mandatory for this endpoint".
- Raise Hoppycat's history floor past the narrated lines that 1.0.202 to 1.0.203
  produced.

## 1.0.204 — 2026-10-01

- Judge free-context lines for spoken shape: one paragraph that neither opens
  with a markdown label nor narrates its own speaker in the third person. A
  rule-free prompt let some models drift into scene prose. The line budget
  drops from 120 to 70 words, and the summoning gains one first-person habit,
  "i talk out loud, a line at a time."

## 1.0.203 — 2026-09-30

- Add a decision-model client for the OpenRouter Decisions API and a pack
  opt-in, `x-cosyworld-decisions`. The operator names the model with
  `COSYWORLD_AI_DECISION_MODEL`; every call fails open to the previous behaviour.
- Decide the chat floor with a seeded draw over a yes/no probability instead of
  a language-model call, so residents speak in proportion to what they have to
  say.
- Add a repeat judge: a decision model flags a candidate that repeats an idea
  the room already heard, even reworded, and the publication gate rejects it.
- With an operator model set, decisions are on for every world; a pack can
  tune them or declare `{"schema_version": 1}` to turn both off for itself.
  Hoppycat declares its policy explicitly. Pack 0.4.6, world 8; the live bundle
  is declared replay-compatible.

## 1.0.202 — 2026-09-30

- Add `COSYWORLD_FREE_CONTEXT_HISTORY_FLOOR_SEQ`, an operator history floor for
  free-context prompts. Dialogue, scene evidence, and recollections recorded
  before it stay in the journal but leave the prompt, so a world can start
  fresh from an earlier echo habit. Hoppycat's floor is set at this release.

## 1.0.201 — 2026-09-30

- Bring player-controlled avatars into free-context worlds. A pack may declare
  `traveler_personas`, short system-owned first-person lines chosen by stable
  hash, so player avatars no longer share one plain fallback persona. Player
  text stays in the user role.
- Clean free-context prompts of engine bookkeeping: internal planner labels,
  raw tags, turn-order notices, embedded instructions, and duplicate memories.
- Hoppycat declares eight jagged traveler personas. Pack 0.4.5, world 7; the
  live 1.0.200 bundle is declared replay-compatible.

## 1.0.200 — 2026-09-30

- Recast the Hoppycat cast: sixteen residents with distinct comic voices, one
  short first-person persona each, and goals that collide with one another.
  The previous deployed bundle is declared replay-compatible.
- Add `x-cosyworld-free-context`, a pack opt-in that summons residents with a
  first-person surfacing and plain-prose world and memory context, with no
  rules, word budgets, output cues, or safety text in the prompt. The
  publication gate judges these lines as raw speech and redraws a rejected
  line without feedback text.
- Add `x-cosyworld-voice-pool`, a pack opt-in that gives each unbound actor one
  stable model drawn by hash from the operator's rarity-tiered voice pool, with
  an optional pack sampling temperature. Hoppycat opts in and runs without the
  shared voice pin; every other world is unchanged.

## 1.0.26 — 2026-08-13

- Declare the live official-world bundle replay-compatible with the additive
  Ruby High population and art update, preserving its journal and checkpoint
  across deployment.

## 1.0.25 — 2026-08-13

- Double the deterministic kernel's actor capacity so one world can absorb all
  authored residents and the existing live populations with growth headroom.

## 1.0.24 — 2026-08-13

- Populate Ruby High with autonomous students and teachers, usable school
  items, and local borderless presentation art for every First Bell card.

## 1.0.23 — 2026-08-12

- Restrict the browser state projection to an explicit public allowlist, load
  room history separately, and validate action details on the server.

## 1.0.22 — 2026-08-12

- Move pending human gift consent into the recipient's action hand, mark the
  corresponding room avatars, and cancel the offer when either player leaves.

## 1.0.21 — 2026-08-12

- Redesign Travel confirmation around the destination and route context, with
  compact neutral and primary actions instead of repetitive copy and controls.

## 1.0.20 — 2026-08-12

- Clarify that semantic instruments rank only facts a holder can already reach,
  remain subordinate to the authoritative fact contract, and never become a
  source of history or provenance.

## 1.0.19 — 2026-08-12

- Keep one illustrated journey tracker and fold its way, party, and next-step
  context into a restrained route header instead of repeating a second panel.

## 1.0.18 — 2026-08-12

- Lock Rati's authored portrait into Core and Ruby High cards, recompiling every
  affected composition while preserving production replay compatibility.

## 1.0.17 — 2026-08-12

- Recover once from stale command observations when the refreshed hand still
  contains the same certified choice, while preserving fail-closed concurrency.

## 1.0.16 — 2026-08-12

- Restore Hoppycat startup by aligning authored job-strategy provenance with
  its current pack, and require every shipped registry to pass runtime loading.

## 1.0.15 — 2026-08-12

- Simplify single-destination Travel cards to their concise route label while
  preserving full context for confirmation, execution, and accessibility.

## 1.0.14 — 2026-08-12

- Declare tenant 7's live Bethlehem bundle replay-compatible with the Emmaus
  presentation update, preserving its journal and checkpoint across deployment.

## 1.0.13 — 2026-08-12

- Declare the live official-world bundle replay-compatible with the Emmaus
  presentation update, preserving its journal and checkpoint across deployment.

## 1.0.12 — 2026-08-12

- Keep an active journey's exact next Travel card in one hand slot while every
  other eligible action rotates fairly through the remaining slot.

## 1.0.11 — 2026-08-12

- Record semantic instruments as subjective, replay-safe memory lenses and
  reflective resident work as off-tick batch computation that cannot mint
  history.

## 1.0.10 — 2026-08-12

- Lock Hoppycat's pregenerated avatar and location cards as canonical local
  artwork, and add a matching ten-image set for every portable story item.

## 1.0.8 — 2026-08-12

- Declare the exact Hoppycat bundle currently deployed to Lonely Forest as
  replay-compatible with the avatar identity and naming update, preserving its
  journal and checkpoint while keeping all other bundle transitions fail-closed.

## 1.0.4 — 2026-08-12

CosyWorld 1.0 is the first stable release of the canonical V2 product: a shared,
persistent AI MUD with a deterministic rules kernel, a Rust HTTP/SSE host, and a
small card-driven browser interface.

### Stable product surface

- One canonical living world with durable SQLite actions, checkpoints, journal
  replay, reconnect convergence, and fail-closed production startup gates.
- Moderated, evidence-grounded AI characters whose public speech and generated
  images remain behind explicit publication and safety boundaries.
- The Lantern Keeper campaign, including its golden journey, Journal continuity,
  and seventh-visit memory proof.
- The Project 89 composition with playable onboarding, populated actors, durable
  progress, and the narrow optional Proxim8 linked-avatar pilot.
- The illustrated Hoppycat living archive as a dedicated Lonely Forest tenant.
- Version-locked world packs, deterministic content compilation, explicit upgrade
  compatibility, and production recovery evidence.
- Browser coverage for onboarding, card actions, persistence, failure states,
  mobile layouts, accessibility, and ordered combat.

Ordinary play remains wallet-optional. Broader wallet-linked avatar
productization and removal of legacy collectible surfaces remain explicitly
post-1.0 work; historical materialization records are retained only as read-only
audit evidence.

### Upgrade from 0.1.16

The 1.0 release changes release identity and documentation, not persisted gameplay
schema, content-engine contract, or world-pack content. The independently
versioned content-engine contract remains `0.0.373`; `/meta` reports both product
and content-engine versions. Deploy with the existing SQLite and generated asset
volumes intact. The release workflow must pass the production gate, deploy both
the primary and Lonely Forest applications, and show zero checkpoint rejections
in each live `/meta` response.

Do not treat a failed candidate image as an accepted persistence epoch. If an
upgrade needs an explicit recovery capture, follow
[`docs/deployment/07-deployment.md`](docs/deployment/07-deployment.md) and the
application-specific runbook. Recovery must preserve the accepted checkpoint and
retained journal cursor; it must not reseed or fork the canonical world.

### Release evidence

The final GitHub release and issue #533 record the immutable candidate and final
tag workflow runs, production observations, and the completed milestone evidence.
The earlier `v1.0.0-rc.1` candidate failed during image construction before any
production process was replaced; its tag remains immutable as failure evidence.
