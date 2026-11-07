# Saved journey progress

A resident's agreed journey now keeps its step when the resident visits
another place. This is the first part of the
[invitation design](invitation-consent-and-visits.md).

`journeyProgress[actor]` saves the authored agreement ID and completed path
index. Agreement starts at zero. An accepted Accompany from that waypoint to
the next advances it. A return to the saved waypoint preserves the step.
Choices at the final journey place require the last step as well as their
existing authored conditions.

Earlier saves derive progress once from the resident's place after their
existing pack migrations. Current saves keep their recorded step through
reload and pack toggles. The record validates against the authored journey
and its saved agreement receipt. A future change to an authored journey path
must migrate its saved step explicitly.

This slice supplies saved progress for later social visits. Current consent
and ordinary travel policy still choose which trips are offered. The next
slice adds visit agreements and common consent across the cast.
