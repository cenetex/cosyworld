# Two active player quests

Players hold two unfinished quests at a time, including Level Up.
Further quests wait in order. Completing or discarding an active quest
admits the next waiting quest. Incoming quests preserve the player's focus.
Completed reward receipts stay available until claimed and use no active slot.

The existing saved `want` and `under` list retains every quest and its progress.
Its first two entries are active for a current or claimed human player;
the remaining entries wait. An older three-quest save keeps its third quest
waiting. NPC goal stacks keep their current rules.

Admission, source deduplication and save checks read the whole list.
Gameplay and quest cards read active entries. A waiting quest starts observing
plays after admission, so the deed that opened its slot earns only its original
active quests. Level eligibility also checks waiting quests and unpaid final
receipts. One-time story effects retain their new quest even while both slots
are occupied.

Validation covers actual completion and discard, save and shared upgrades,
source quests, level progress, reward claims, NPC stacks and journal replay.
Historical shared rules remain pinned to their recorded behavior.
