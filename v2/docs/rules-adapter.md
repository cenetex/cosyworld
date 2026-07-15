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

The kernel and RPG projection independently implement a deliberately small
compatible surface: the six D&D ability names and standard modifier formula;
normal, Advantage, and Disadvantage d20 rolls; level, first-level class Hit Die
and Hit Points; proficiency bonus and a small named-Skill mapping; derived
Bloodied state; and a CosyWorld nonlethal knockout that leaves an actor at 1 Hit
Point. These primitives do not grant authority to reference-only entries or
turn the adapter into a complete implementation of either SRD.

## Product boundary

CosyWorld's quest/build projection currently implements only level 0 to class
level 1, with Fighter and Rogue as authored knowledge definitions. Feature
names are recorded, but their full feature mechanics are not implied. It does
not yet implement later class trees, subclasses, saving throw/equipment
proficiencies, spell slots, multiclass prerequisites, encounter math, XP tables,
or automatic monster stat blocks. See `quests-and-levels.md` for the exact
compatibility boundary.

SRD 5.1 and SRD 5.2.1 are both available as attributed authoring references.
SRD 5.2.1 targets the revised fifth-edition ruleset, but its broader class,
spell, equipment, action-economy, and monster mechanics remain outside the
product boundary.
