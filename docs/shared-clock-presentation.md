# Shared Clock Presentation

Player-visible clocks are presented as shared questions about a place. The
question projection explains what is happening, why it matters, what an avatar
can try, and what changed. It does not create a second source of mechanical
truth: jobs, clocks, contribution bindings, requirements, claims, effects, and
the event journal remain authoritative.

## Authored contract

Every player-visible clock carries `presentation` metadata at version 1:

- `question` names the unresolved story question.
- `rhythm` is one of `immediate`, `session`, `multi_session`, `construction`,
  `civic`, or `seasonal`.
- `attention` is one of `immediate`, `local`, `communal`, or `background`.
- `priority` is an integer from 0 through 100.
- `situation`, `stakes`, `outcome`, and `completion_memory` provide concise
  player-facing prose.

The worldpack checker and Rust content loader reject visible clocks with
missing or invalid presentation metadata. Runtime-generated pathway and
delivery clocks author the same schema in code. Old snapshots receive a
deterministic fallback derived from existing clock labels; the fallback is a
migration boundary, not a replacement for authored content.

## One derived projection

The shared-question view joins a job to its progress and danger clocks. From
those existing records it derives:

- `active` when at least one authored strategy is currently legal;
- `unavailable` when the question is open but this avatar cannot currently use
  an approach;
- `quiet` when the question is active but outside the place's attention
  budget; and
- `completed_memory` when the authoritative job or clocks have settled it.

Available approaches expose the actual authored target and a readable reason
when an approach is unavailable. Work and Help remain distinct universal
verbs under the same project invitation. Avatar identity, controller type,
Calling, and practice do not grant extra verbs or change legality.

The current situation comes from the most recent reached narrated threshold,
then the authored initial situation. Completion uses durable memory captured
when the clock fills. The latest three effective contributions are stored
incrementally on the clock; duplicate, rejected, and zero-delta attempts do not
produce public contribution memory. Snapshots and journal replay therefore
restore the same question, contributors, and completion memory without
rescanning raw history.

## Attention budget

A place promotes at most three active questions. Ranking is deterministic:
priority, attention, most recent causal change, then canonical ID. A place may
promote at most one `immediate` and one `communal` question, and never promotes
`background` questions. The remaining active questions stay available as
quiet state rather than disappearing.

The browser and text transport consume this same ordered projection. The
browser keeps situation and progress visible, with stakes, outcome, next
threshold, approaches, targets, and recent contributors in an accessible
disclosure. Text `look` presents the same question, outcome, targets, and next
sign. The inspector exposes the authored metadata and incremental memory for
debugging.

## Receipts and measurement

A contribution, its clock delta, any crossed threshold, and completion are one
causal chain. Player-facing action output folds that chain into one coherent
receipt; room memory suppresses the redundant child beats. The canonical
events remain separate for replay and inspection.

State reads never count as presentation. The browser sends a versioned receipt
only after a promoted question is visibly rendered or its explanation is
opened. The server accepts receipts only for the authenticated avatar, current
visible projection, supported transport, canonical exposure ID, and a state
revision no newer than the world. Metrics store opaque player, place, and
question references plus interaction metadata; they do not store question
prose or avatar names.
