# Sleep

Status: Decided by the owner on [#2028](https://github.com/cenetex/cosyworld/issues/2028)
(2026-11-02). Rules half built in rules 89; the client label and the sleep art
follow.

Players could not tell how long a Wait lasted: at a rest spot the first Wait
slept up to 24 turns and the lamp ran dry inside it.

- Wait is always one turn, sanctuaries included.
- Sleep is not a new verb. It is `wait` with `sleep: true` and the label
  "Sleep", offered only when the actor's last committed play was a Wait,
  never aboard a ship or in a standoff, and never to residents.
- `actor.sleeping = {since, place, present}` replaces `sleepUntil`.
- Each round, after the lamp burn, a sleeper wakes at the first of: the lit
  lamp where it sleeps at 1 oil, the set of active avatars there differing
  from `present`, a standoff holding it, a ship docking there,
  `turn % DAYLIGHT_TURNS === 0`, or 24 turns asleep. The wake event is a
  `wait` with `woke` set to `lamp`, `arrival`, `departure`, `threat`, `dock`,
  `dawn`, `dusk` or `rested`.
- A Sleep at a sanctuary that lasts at least one turn is a long rest
  (`rest: "long"`, `wake()`, dream, level quest, defeats cleared). A plain
  Wait at a sanctuary clears defeats only.
- Solo play runs the world until the sleeper wakes. Shared play checks every
  sleeper on every accepted play.
- The opening: Sleep in the attic wakes Vale at 1 oil; the next one-turn Wait
  burns it out and opens the mirror.

Replay: journals before rules 89 replay on their own bundles. Loading an older
save drops `sleepUntil` (alpha saves may lose a pending sleep).

The full rules are in [rest and sanctuary](../../v2/docs/card-table/rest-and-sanctuary.md#sleep).
