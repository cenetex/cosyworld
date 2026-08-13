# ADR 0012: Notice observes actors, Search examines places, and Scout follows leads

- Status: Accepted
- Date: 2026-08-13
- Decision owners: CosyWorld maintainers
- Related: #693, #725–#729, #774, #783, ADR 0005

## Context

CosyWorld currently uses **Notice** for two different promises. The discovery
pipeline presents a broad room-focused Notice, while avatar inspection can
offer a targeted Notice that reveals something about a nearby resident. Search
has also revealed routes in historical records even though Scout is the
route-facing verb.

That overlap is difficult for people and agents to learn. A label must identify
one target class and one authoritative result before the action is offered. An
action that can truthfully do nothing is not a useful promise.

## Decision

The disputed discovery vocabulary settles on three verbs: Notice, Search, and
Scout. Obvious scene facts remain automatic and **Study** keeps its separate
interpretation role. There is no additional Observe or Survey action.

| Surface                                    | Exact target class                                                               | Bounded authoritative promise                                                                                                                               | Empty result                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| automatic scene notice (`scene_notice_v1`) | the actor's current location                                                     | Project every currently obvious exit, present subject, sensory sign, and perceivable hazard tell. This is presentation, not a played action.                | Show the scene without an extra message or action.                                        |
| **Notice** (`notice_actor_v1`)             | one nearby, visible actor                                                        | Reveal exactly one eligible unresolved viewer-scoped observable fact about that actor.                                                                      | Do not offer the action. An already-open actor inspector may say “Nothing new to notice.” |
| **Search** (`search_v2`)                   | one local searchable physical subject: the current location or one named feature | Reveal exactly one eligible unresolved physical-evidence fact bound to that subject. Search never reveals a route or an actor profile.                      | Do not offer the action. A named inspector may say “Nothing new to search here.”          |
| **Scout** (`scout_v2`)                     | one active geographic Lead or eligible route edge                                | Reveal exactly the authorized next route segment or geographic target. Scout never moves the actor.                                                         | Do not offer the action. Preserve the Lead's current state without a no-change event.     |
| **Study** (`study_v2`)                     | one already perceived subject                                                    | Reveal exactly one eligible unresolved interpretive fact about operation, provenance, meaning, or a better method. Study never materializes physical truth. | Do not offer the action.                                                                  |

A room with non-obvious ambient truth authors the current location as a Search
target. A room with no such target has no played ambient-discovery action;
automatic scene notice still presents everything obvious. This avoids adding a
fourth verb merely to provide a button in every room.

Notice is an ordinary repeatable exploration action, not rest-bound readiness.
It has no charge, cooldown, or rest refresh. A successful reveal exhausts only
that fact for that viewer. A later authoritative change or newly eligible fact
may make Notice available again.

### Labels and transport identity

Every transport preserves the same action identity and target.

| Action | Browser                                         | Terminal                    | Agent/API                                                                |
| ------ | ----------------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| Notice | `Notice` on an eligible actor card or inspector | `notice <actor>`            | intention `notice`, procedure `notice_actor_v1`, exact `target_actor_id` |
| Search | `Search` on the room or a named feature         | `search <place-or-feature>` | intention `search`, procedure `search_v2`, exact physical-subject target |
| Scout  | `Scout` on an eligible Lead or route            | `scout <lead-or-route>`     | intention `scout`, procedure `scout_v2`, exact Lead/edge target          |
| Study  | `Study` on a perceived subject                  | `study <subject>`           | intention `study`, procedure `study_v2`, exact perceived-subject target  |

Clients and inference controllers select one server-authored offer certificate.
They cannot substitute a target, choose a fact, or request an empty result.

### Knowledge and replay

#725 owns the viewer-scoped fact and provenance schema. These verbs consume
that contract but do not create a second knowledge store. The selected fact and
its reveal method commit before any optional prose. Generated dialogue can
describe the result but cannot choose or enlarge it.

Historical records keep their original meaning:

- legacy Search records that revealed routes remain Search in historical
  Journal and snapshot replay;
- `scout_v1` remains the legacy no-movement route procedure;
- `focused_notice_v2` remains a broad environmental Notice for replay and
  compatibility, but new offers do not use it;
- targeted `CW_ACTION_ABILITY_CHECK` records whose content is `notice` retain
  their historical success-gated disclosure; and
- migration may add compatibility projections, but never rewrites old action,
  event, target, or result identities.

New records use `notice_actor_v1`, `search_v2`, `study_v2`, and `scout_v2`.
Browser copy, terminal output, the Journal, and agent-facing responses derive
their labels from those committed identities.

## Rejected alternatives

- **Broad Notice over rooms and actors.** Rejected because one verb would still
  promise two target classes and compete with Search.
- **Survey or Observe as a fourth played verb.** Rejected because Search can
  target the current location and automatic scene notice already owns obvious
  ambient truth.
- **Rest-bound Notice charges.** Rejected because rest should recover actor
  readiness, not manufacture unresolved facts. The Deck therefore does not
  display a Notice charge.
- **Truthful no-change events.** Rejected for these discovery verbs. Absence is
  projected before selection, so a successful played action always keeps its
  promised reveal.

## Consequences

- #774 implements truthful actor-only Notice rather than room-or-inhabitant
  Notice.
- #726 keeps Search physical and Scout geographic.
- #727 uses one fact per actor Notice rather than an observable-profile bundle.
- #728 remains fact transfer through Chat and does not compete with Notice.
- #729 migrates presentation and compatibility without reinterpretation.
- #785 may show recovery readiness, but not a Notice charge or rest refresh.
