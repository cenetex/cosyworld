# CosyWorld combat protocol

`cosyworld.combat/4` is the deterministic encounter protocol implemented by
the C kernel and projected by Rust. It binds Attack and Dodge to
`srd5.2.1:attack` and `srd5.2.1:dodge` under `cosyworld.srd5/1`, while retaining
CosyWorld's documented nonlethal, frontier-only deltas. It is not a complete
implementation of either SRD.

## Encounter contract

An encounter has a stable numeric id, location, round, current participant,
status, and initiative-sorted sides. Initiative is `d20 + Dexterity modifier`;
higher totals act first and actor id breaks ties. The current participant gets
one of three bounded choices:

- **Attack:** if the avatar has an equipped weapon Item, the action records that
  item instance and uses its validated damage die plus the authoritative attack
  ability and proficiency. The current Core practice blade is `1d6`, Strength,
  and nonlethal. Without an equipped weapon, the existing bounded finesse
  fallback uses the better of Strength or Dexterity and `1d8`. A natural 1
  misses, a natural 20 hits and rolls a second damage die, and damage cannot go
  below zero.
- **Dodge:** attacks against the actor have Disadvantage until the beginning of
  that actor's next turn.
- **Escape:** the actor moves through an existing unlocked exit and leaves the
  encounter. It remains a CosyWorld operation; Disengage is not simulated.

Armor Class is `10 + target Dexterity modifier`. Proficiency follows the
fifth-edition +2 through +6 level progression. The client cannot submit attack
bonus, roll mode, Armor Class, damage, initiative, advantage, or outcome.

The encounter resolves when only one side has active, non-escaped
participants. A finishing hit leaves the target at 1 Hit Point, sets
`CW_ACTOR_KNOCKED_OUT`, and applies `CW_CONDITION_UNCONSCIOUS`. Death, death
saves, and negative Hit Points are outside this profile.

## Action economy and exclusions

During an active encounter, a participant may mechanically Attack, Dodge, or
Escape. Brief room speech remains available but does not spend the combat
turn. Normal movement and unrelated item, check, project, trade, search, and
craft actions are rejected by the kernel or projection gate.

The profile does not implement tactical distance, speed, reach, ranged weapon
bands, armor equipment, cover, grappling, combat Help/Ready, opportunity
attacks, reactions, bonus actions, combat spellcasting, concentration,
resistance/vulnerability, saving throws, or SRD monster action blocks. These
remain explicit exclusions, not browser approximations.

## Product integration

Encounters attach to active worldpack jobs. Rust derives the encounter id from
the job, limits targets to active declared participants, commits deterministic
NPC turns, and advances the job only after the player side wins. Sanctuary
rooms reject encounter creation regardless of pack reskins.

The browser and terminal submit current action-offer envelopes through
`POST /actions/submit`; compatibility endpoints remain `/actions/attack`,
`/actions/defend`, and `/actions/flee`. `/state` exposes protocol, round,
participants, current actor, and available choices. `/meta` advertises protocol
and kernel versions.

Combat offer traces name the stable action, target, active profile, resolver,
source location, and—when present—the equipped weapon's item/card/pack
provenance.

## Durable vocabulary and replay

The event vocabulary is append-only:

- `combat.encounter.started`, `combat.participant.joined`
- `combat.initiative.rolled`, `combat.turn.started`, `combat.turn.ended`
- `combat.dodge`
- `combat.attack.attempt`, `combat.attack.hit`, `combat.attack.miss`
- `combat.knockout`, `combat.flee.success`, `combat.encounter.resolved`

Historical combat/2 action code 17 rows with no weapon instance keep their
Strength-only meaning. Combat/3 rows keep append-only finesse action code 20.
Combat/4 weapon attacks use the existing attack code with a nonzero,
authoritatively equipped item id and validated weapon profile. Golden C and
Rust replay fixtures protect all three meanings.

The embedded SRD reference packs remain separately attributed under
`cosyworld.rules/1`; the active action binding comes from `cosyworld.srd5/1`
under `cosyworld.rules/2`.

See the [action architecture](../../docs/systems/04-action-system.md) and
[SAF-10 evidence](../../docs/backlog/srd-action-card-foundation.md#saf-10--align-bounded-combat-with-the-action-registry).
