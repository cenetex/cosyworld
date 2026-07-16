# CosyWorld combat protocol

`cosyworld.combat/3` is the deterministic encounter protocol implemented by the
C kernel and projected by the Rust orchestrator. It is a deliberately bounded
fifth-edition-compatible profile, not a complete implementation of SRD 5.1 or
SRD 5.2.1.

## Encounter contract

An encounter has a stable numeric id, location, round, current participant,
status, and an initiative-sorted participant list. Participants belong to side
1 (human avatars) or side 2 (NPC opponents). An active actor can belong to only
one active encounter.

Starting an encounter rolls `d20 + Dexterity modifier` for both initial
participants. Later participants roll initiative when they join. Higher totals
act first; actor id is the deterministic tie-breaker. The kernel accepts one of
three actions from the current participant:

- **Attack:** `d20 + the better of the Strength or Dexterity modifier +
  proficiency bonus` against `10 + target Dexterity modifier`. A natural 1
  misses and a natural 20 hits. Damage is `1d8 + the same chosen modifier`,
  with a second d8 on a critical hit and a minimum of zero damage. This is the
  protocol's bounded finesse rule; every current attack may use it without an
  authored weapon flag.
- **Dodge:** attacks against the actor have Disadvantage until the beginning of
  that actor's next turn.
- **Escape:** move through an existing unlocked exit and leave the encounter.

Proficiency bonus is derived from level using the fifth-edition progression
from +2 through +6. Clients cannot supply roll results, roll mode, Armor Class,
damage, initiative, or encounter outcome; the kernel derives all of them from
authoritative state and the journal seed.

The encounter resolves when only one side has active, non-escaped
participants. CosyWorld combat is always subdual: a finishing hit leaves the
target at 1 Hit Point, sets `CW_ACTOR_KNOCKED_OUT`, and applies
`CW_CONDITION_UNCONSCIOUS`. Death, death saving throws, and damage below zero
are intentionally outside this profile.

## Action economy and unsupported mechanics

While enrolled in an active encounter, a participant may use only Attack,
Dodge, or Escape for their mechanical turn. Brief room speech remains
available but does not advance combat. The kernel rejects normal movement and
legacy item, check, project, trade, search, craft, attack, defend, and flee
actions, and the Rust projection also blocks mutation-only project actions.

The current profile does not implement tactical distance, movement speed,
reach, ranged weapons, cover, grappling, Help, Ready, opportunity attacks,
reactions, bonus actions, spellcasting, concentration, resistances,
vulnerabilities, saving throws, death saves, or SRD monster action blocks.
Those require an explicit protocol revision and kernel tests rather than
client-side interpretation.

## Product integration

Combat encounters are attached to active worldpack jobs. The orchestrator
derives the encounter id from the job id, permits attacks only against active
NPCs declared in that job's `participant_ids`, automatically commits
deterministic NPC Attack turns, and resolves the job progress clock only after
side 1 wins. A successful combat outcome grants its own idempotent Orb reward;
normal job-completion rewards may also apply.

The browser-compatible endpoints remain:

- `POST /actions/attack` for Attack;
- `POST /actions/defend` for Dodge;
- `POST /actions/flee` for Escape.

All require the actor's session. `/state` exposes an optional `combat` object
with protocol id, encounter id, round, current actor, available native actions,
and participant initiative/Hit Point/condition state. `/meta` advertises the
protocol and kernel version.

The durable kernel event vocabulary is append-only:

- `combat.encounter.started`
- `combat.participant.joined`
- `combat.initiative.rolled`
- `combat.turn.started`
- `combat.turn.ended`
- `combat.dodge`
- `combat.attack.attempt`, `combat.attack.hit`, `combat.attack.miss`
- `combat.knockout`
- `combat.flee.success`
- `combat.encounter.resolved`

Encounters and participants are included in runtime snapshots, and their
numeric ids remain stable across protocol revisions. Historical combat/2
journal records retain action code 17 and replay with Strength-only attack and
damage modifiers. New combat/3 player and NPC requests use append-only action
code 20 for finesse attacks. This preserves deterministic legacy replay while
preventing old action semantics from changing underneath durable journals.

## SRD boundary

The embedded SRD packs remain attributed, non-authoritative references under
`cosyworld.rules/1`. `cosyworld.combat/3` implements the compatible primitives
listed above independently in the authoritative kernel. It does not merge the
SRD 5.1 and SRD 5.2.1 namespaces, import reference-only monster statistics, or
claim full rules compatibility.
