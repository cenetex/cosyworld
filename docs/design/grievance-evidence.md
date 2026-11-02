# Grievance evidence

Status: Decided and built in rules 88 ([#2020](https://github.com/cenetex/cosyworld/issues/2020));
repair narrowed in rules 90.

A grievance (`motives.mjs`) keeps the other avatar, a short reason, the
incident's event fact id (`incident`), its turn, a weight from 1 to 3,
`lastTouched`, `repaired` and, from rules 90, `item`: what the incident took
or damaged, when it touched a thing. The witnessed account of the incident lives in
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

Rules 90 (owner decision after a philosophical review): a repair answers the
incident, and only the wronged avatar's grievance closes.

An accepted Give to a recipient who is present and holds an unrepaired
grievance against the giver repairs it only when the gift answers that
incident:

- the item is the grievance's `item`, what the incident took or damaged: a
  threat's stake, the first thing a beaten avatar dropped (`droppedItemIds`),
  or the light that was spoiled (the lamp snuffed or covered); or
- the gift meets an item want anywhere in the recipient's stack, judged as
  `settleWants` judges it (`meetsItemWant`): a want that names the item's
  light is answered only by the item lit or dark as wanted. It is read
  before the gift settles it.

A dropped item belongs to the avatar who dropped it: a guard who steps in
and is beaten takes a threat grievance of its own with that item, and the
avatar it covered keeps the stake. A repeat incident names only what it
touched, so one that takes nothing clears an older `item`.

Noise and pestering take nothing, so only a wanted gift answers them.
Grievances saved before rules 90 have no `item` and can be answered only by
the want. The rules cannot tell kinds of thing apart, so only the same item
counts.

A repair records a `repair:<seq>` fact (kind `repair`), with
`answers: { recipient, incident }` for the recipient's latest answered
incident, and marks that grievance `repaired`. Everyone present witnesses the
fact and Talk can pass it on, so knowledge stays truthful, but it changes no
one else's grievance: witnesses and hearers keep theirs, and they go dormant
on the ordinary clock. A gift that answers nothing is an ordinary gift: no
repair, no penalty, and trust and keepsakes work as before. A gift the
aggrieved does not see changes nothing. Gifts never lower strength, and a
quiet Wait among pack residents calms their irritation only.

## Open questions

- Forgiveness is not a rule. Whether a witness or a hearer forgives the giver
  stays in dialogue: the model may voice it from the repair fact, but the
  rules keep the grievance until it goes dormant.
