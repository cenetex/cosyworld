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
  `present` lists who is physically there; being discovered or met is not an
  arrival.
- Sleep is not offered beside a lit lamp with one oil or less: the player gets
  a plain Wait, which burns the last oil and opens the mirror.
- A sleeper's plays are Sleep (sleep on) plus its normal plays. Any other play
  wakes it first (`woke: "chose"`, "Vale wakes."). Coordinator decision on
  #2028 (2026-11-02): a shared seat is never stranded asleep.
- Each round, after the lamp burn, a sleeper wakes at the first of: being
  moved (`moved`), the lit lamp where it sleeps at 1 oil (`lamp`), the lamp
  running dry there (`dry`), someone physically arriving or leaving, a way out
  opening or closing (`crossing`), a standoff (`threat`), a ship docking
  (`dock`), dawn or dusk after it fell asleep, or 24 turns asleep (`rested`).
- A Sleep at a sanctuary is a long rest (`rest: "long"`, `wake()`, a
  thought, level quest) only when it lasted `LONG_SLEEP_TURNS` = 12 turns,
  half a light period. Every Sleep ends by the next light change, so at most
  one long rest fits in a light period. A shorter Sleep there is a short rest
  that clears defeats with no forced thought.
- Rules 99: a long rest dreams only by the rules, and its wake entry records
  which (`dream: "glimpse"` or `"quest"`). The halfway glimpse and the level
  quest are a level's only dreams, one or two and never more (sleep spec §5);
  an ordinary long rest brings a thought and no dream, and a Wait never
  dreams. The scene context carries the wake's `dream`, and `reflectionDue`
  (mirrored by `reflection_due` in `card_narrative.rs`) makes a dream due only
  then.
- Sleeping on at a dock calls no ship; the Wait before the Sleep already
  called it one lane.
- Solo play runs the world until the sleeper wakes, stopping at a refused play
  and within the 24-turn cap. Shared play checks every sleeper on every
  accepted play; a sleeper woken by another seat's play gets its long rest's
  dream at its own next play.
- The opening: Sleep in the attic wakes Vale at 1 oil after nine turns, a
  short rest; Sleep is then not offered, and the next Wait burns the oil out
  and opens the mirror.

Replay: journals before rules 89 replay on their own bundles. Loading an older
save drops `sleepUntil` (alpha saves may lose a pending sleep).

Rules 100: residents and away avatars sleep too, on schedules scattered by
the seed (`sleeping: {since, place, until}`); see
[world life](rules-100-world-life.md).

The full rules are in [rest and sanctuary](../../v2/docs/card-table/rest-and-sanctuary.md#sleep).
