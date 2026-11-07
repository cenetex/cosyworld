# Committed battle context

The first combat-awareness change reads the existing committed battle events
into typed records, then gives each character first-person facts about their
own actions and witnessed results. It keeps intended target, actual recipient,
protection, brace, damage, resolve and retreat separate. Later results in the
same exchange remain in order, so protection followed by defeat stays clear.

Current battle state supplies the person's resolve, stance and cover now.
Older events with partial fields supply only their recorded facts. A person
elsewhere receives facts only when they participated or witnessed the event.
Claim and Focus retain their quiet context.

This is narrative projection over existing saved events. The rules version
and saved combat state stay at their current format. Rebuild the shared
narrator, authored-text catalog and public assets with this change. The later
speaker-selection PR uses these same facts and the existing dialogue bar;
see [combat awareness](combat-awareness-and-abilities.md).

Validation covers actual covered blows, later defeat, observer knowledge,
partial old events, save/reload and local/shared narrator agreement.
