# Resident levels earned at home

Roaming residents normally gain levels as soon as their quests earn enough
experience. Night Shift at RatiRadio needs a resident who keeps travelling
but returns to the Listening Room to gain each new level.

A pack avatar may opt in with `levelAtHome: true`. Its existing `home` must
name a sanctuary in its own pack. A conditional `homeWhen` is excluded, so
the destination remains fixed. Human avatars keep their existing level quests.

Experience still accrues from ordinary quests. The saved `level` remains
unchanged while the resident is away. Once experience exceeds that level,
the planner prioritizes legal steps home over ordinary wants. Closed ways
stay closed; a blocked resident waits, including calling a ship when needed.
On arriving at its active home, the resident gains the levels its experience
has earned. No extra sleep or new action is required. Its remaining wants
then guide ordinary roaming again. `roamingQuest: "latest-completion"` can
remain set; neither a quest destination nor another sanctuary replaces home.

The rule uses existing saved `xp` and `level` fields. Loading an older save
without an explicit level preserves the level already implied by its
experience. No pending-return flag, reward copy, or save schema is added.
Residents without the option retain immediate experience-based levels.

The focused tests cover earning away, legal return travel, fixed home,
resuming a held quest, blocked routes, save restoration, deterministic
action replay, unchanged human levels, and unchanged ordinary residents.
The released shared engine must be regenerated during integration; prior
bundles retain their recorded replay behavior.
