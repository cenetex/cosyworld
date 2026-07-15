# CosyWorld rules adapter

The `cosyworld.rules/1` adapter carries independently licensed rules references
through the worldpack compiler without granting them authority over the game.
The C kernel remains the only authority for movement, checks, conditions,
combat, inventory, rewards, and other world state.

## Pack contract

A `kind: "rules"` pack declares:

- `rules_adapter`: currently exactly `cosyworld.rules/1`;
- `rules_namespace`: a stable lowercase namespace such as `srd5.1`;
- `rules`: one or more supported array resources;
- `attribution`: a source name, source URL, and attribution file included in the
  compiled bundle.

The first adapter version accepts `conditions` and `monster_seeds`. Compiled
entries remain scoped by pack id and namespace; resources from separate rules
packs are never implicitly overlaid.

## Authority boundary

Every adapted entry has a `mapping.status`:

- `reference_only` means authoring and proposal context only. The runtime must
  not apply its statistics, actions, tags, or prose as world truth.
- `kernel` means the entry names an already implemented kernel primitive. It
  does not add a primitive or bypass the kernel action that applies it.

For both SRD 5.1 and SRD 5.2.1, only `Unconscious` maps to the existing
`CW_CONDITION_UNCONSCIOUS` flag. The other fourteen conditions and every monster
seed are reference-only. The two documents remain separate bundles under the
`srd5.1` and `srd5.2.1` namespaces; neither silently overlays the other. A
future mapping requires a kernel change, kernel tests, adapter validation, and
an explicit versioned pack update.

The kernel independently implements a deliberately small compatible surface:
normal, Advantage, and Disadvantage d20 rolls; derived Bloodied state; and a
CosyWorld nonlethal knockout that leaves an actor at 1 Hit Point. The versioned
`cosyworld.combat/2` protocol adds explicit encounters, initiative,
proficiency-scaled melee attacks, critical hits, Dodge, one-action turns, and
escape through an unlocked exit. These primitives do not grant authority to
reference-only entries or turn the adapter into a complete implementation of
either SRD. See [combat-system.md](combat-system.md) for the exact compatibility
profile and exclusions.

## Product boundary

CosyWorld retains six internal abilities and may use monster, condition,
equipment, and spell concepts as conversion seeds. It does not adopt SRD class
trees, subclasses, spell slots, encounter math, XP progression, or automatic
monster stat blocks. Player-facing UI continues to describe risk and outcomes
in CosyWorld's ordinary language.

SRD 5.1 and SRD 5.2.1 are both available as attributed authoring references.
SRD 5.2.1 targets the revised fifth-edition ruleset, but its broader class,
spell, equipment, reaction, bonus-action, tactical-movement, and monster
mechanics remain outside the product boundary.
