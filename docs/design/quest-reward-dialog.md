# Claim quest rewards in the descriptor

The owner requested ordinary quest cards and an explicit completion dialog:
select the card, tap Complete the Quest, then see earned points and progress.
Use the existing card descriptor and context action; do not add an overlay.

Completion still creates a saved receipt. The UI claims that same receipt,
retains the existing idempotency key on uncertain retries, and celebrates only
after the receipt leaves committed state. Display the receipt's frozen XP,
including old saves, rather than recomputing from visual rarity. New +1–6 rarity
rewards are a separate rules change; this view accepts any saved receipt amount.

A full progress bar means enough experience for the next level quest, not an
automatic level. That distinction follows the current human progression rules.
Selecting, dismissing, repeated taps, failed local saves and delayed replies
must not grant extra XP. A late response must not replace a newer selection.
Motion reduction removes the completion pulse. The progress meter has a spoken
label, and the reward note is a status announcement.

The owner-requested progress meter and dialog glow update the UI inventory
and style snapshots for review. No rules bundle or released version changes.
