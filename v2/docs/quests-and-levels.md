# Quests, knowledge, and Level Up

CosyWorld progression separates four things that used to blur together:

1. A **quest** is one active objective attached to an avatar.
2. Completing its committed world-event condition grants a typed **knowledge unlock**.
3. An unlock makes a class or Skill eligible; it does not immediately add it to the character.
4. **Level Up** spends one banked journal memory on one complete, server-authored package.

Items remain ordinary world objects. A quest may ask an avatar to obtain or use an item, but the
item does not carry quest state. Quest, completion, unlock, and build state are snapshot-persisted
and reconstructed by journal replay.

New human avatars are level 0 and classless. The first Level Up requires an unlocked class and the
number of compatible unlocked D&D Skill proficiencies required by that class. The server derives a
stable set of at most two complete choices from that pool. Selecting one atomically sets class level
1, the class Hit Die, maximum first-level Hit Points, Skill proficiencies, and the class's automatic
level-1 feature names. A changed unlock/build state produces a different offer id, so a stale client
cannot submit an obsolete combination.

Only a quest available at the current location appears as a Quest card. Once accepted, it leaves the
hand and appears on the avatar sheet until its objective is satisfied. Skills and classes are spread
through the worldpack's `quests.json` and `knowledge.json` resources rather than being globally
available menus.

All cards remain turn-based, including Quest, Grow, and Level Up. The deterministic card mutation
commits immediately. Resident/AI observation is queued afterward and may produce its own later world
event, so inference latency never holds the played card open.

## SRD compatibility boundary

The player build model uses familiar fifth-edition names and formulas: Strength, Dexterity,
Constitution, Intelligence, Wisdom, Charisma; the standard ability modifier; class level; Hit Die;
first-level Hit Points; proficiency bonus; named Skills; and class-compatible Skill selection.

That is a deliberately small compatible surface, not a claim of full SRD conformance. In the first
vertical slice, only the 0→1 class transition is implemented. Fighter and Rogue feature names are
recorded automatically, but their complete combat/action mechanics are not yet implemented. Saving
throw proficiencies, armor and weapon proficiencies, equipment, Expertise selection, spellcasting,
multiclass prerequisites, subclasses, later class levels, feats, and the full eighteen-Skill action
mapping remain future work. Existing generic checks map Strength to Athletics, Dexterity to Stealth,
Intelligence to Investigation, and Wisdom to Perception when the corresponding proficiency exists.

SRD 5.1 and SRD 5.2.1 remain separately attributed authoring references. The authoritative runtime
state is still CosyWorld's kernel plus the explicit quest/build projection described here.
