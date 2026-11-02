# Grievance evidence

Status: Decided and built in rules 88 ([#2020](https://github.com/cenetex/cosyworld/issues/2020)).

A grievance (`motives.mjs`) keeps the other avatar, a short reason, the
incident's event fact id (`incident`), its turn, a weight from 1 to 3,
`lastTouched` and `repaired`. The witnessed account of the incident lives in
the shared fact store (`knowledge.mjs`), which holds at most 256 facts and
drops the oldest news first.

## Pin

`retainFact` skips pinned grievance evidence and evicts the next-oldest news.
A grievance names its evidence by `incident`. Saves from before rules 88 have
no id; there the incident is the event its other avatar did on the grievance's
turn, seen by its holder. The pin is derived, not saved: `pinnedFacts` builds
the set once per eviction.

Pins take at most `GRIEVANCE_PIN_LIMIT` (128, half the store), so fresh news
always has room. Active grievances keep their evidence first, by most recent
touch. Dormant ones come next, so the longest-dormant lose their pin first.
Repaired ones are released first of all. Ties break by holder id, then list
order, so the choice never depends on key order. If every aging fact is still
pinned, the oldest goes anyway. The six-grievance cap or an avatar reset
releases a pin. A repeat incident moves the pin to the latest incident.

## Dormancy

Strength never decays. `lastTouched` is the turn of the latest news play
(give, trade, attack, threaten, accompany) between the pair that both saw,
while the grievance is active. A grievance is dormant once
`GRIEVANCE_DORMANT_TURNS` (24) pass without one, or once it is repaired.
Dormant grievances stay out of prompts (`motiveFacts`) and out of hostile
choices (`resentment`, company, learning conditions and strain).

Friendly contact (accompany, trade, a gift or a declined one) keeps an active
grievance on mind but never wakes a dormant or repaired one, so a companion
who accepts an Accompany stays in company. Only a new incident of the same
kind (a threat, an attack, a slight) wakes it and adds 1 to its stored
strength.

24 turns is one day on the world clock (`DAYLIGHT_TURNS`), the same span as
`CONTENT_TURNS`. It sits well past `STALE_TURNS` (6), when news reads as
possibly out of date: a grudge outlasts the news about it, but not a full day
with nothing between the pair.

## Witnessed repair

An accepted Give to a recipient who is present and holds an unrepaired
grievance against the giver records a `repair:<seq>` fact (kind `repair`),
with `answers: { recipient, incident }` for the recipient's latest open
incident. Everyone present witnesses it. Any avatar that knows the repair, by
witnessing it or hearing it through Talk, marks its grievance against the giver
for that incident `repaired`. A gift the aggrieved does not see changes
nothing. Gifts no longer lower strength, and a quiet Wait among pack residents
calms their irritation only.
