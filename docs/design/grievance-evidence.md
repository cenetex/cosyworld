# Grievance evidence

Status: Pin in review ([#2020](https://github.com/cenetex/cosyworld/issues/2020)).
Repair and dormancy are later rules work, recorded in the issue.

A grievance (`motives.mjs`) keeps the other avatar, a short reason, its turn
and a weight. The witnessed account of the incident lives in the shared fact
store (`knowledge.mjs`), which holds at most 256 facts and drops the oldest
event news first.

## Pin

The incident under a standing grievance is the event fact whose actor is the
grievance's other avatar, whose turn is the grievance's turn, and which the
holder witnessed. `retainFact` skips such facts when it evicts and takes the
next-oldest. If every aging fact is evidence, the oldest still goes, so the
store never grows past its cap.

The pin is derived, not saved. It lasts as long as the grievance: a gift or a
quiet Wait that clears it, the six-grievance cap, or an avatar reset releases
it. A repeat incident moves the grievance's turn, so the pin follows the
latest incident.

## Rules version

`knowledge.mjs` is in the shared bundle. The change needs the next rules
bundle (`npm run v2:card:shared:next` or the lander). Released bundles stay
as they are and keep replaying their own journals.
