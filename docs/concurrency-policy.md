# Scene concurrency policy

Ordinary co-present play uses one room initiative order when two or more eligible avatars are
present. Directly controlled and inference-controlled avatars share that order and the same finite
Story Hand. Inspection and local configuration remain available while another avatar acts.

Every operation belongs to one concurrency policy:

- **concurrent** — inspection, personal reflection, and local configuration do not spend an
  activation;
- **target-serialized** — writes to the same item, slot, offer, or decision commit under the world
  lock. One write wins deterministically and the losing client receives an `action.conflict`
  explanation without a duplicate effect;
- **scene-turn** — ordinary room play, combat, and another explicitly authored ordered procedure
  name the current participant and reject out-of-order mechanics with a causal explanation;
- **governed-choice** — scarce communal choices use a versioned chooser, covenant, competing-project,
  explicit-delegation, or authored-automatic policy rather than turn ownership.

Serialization of the journal remains authoritative for every policy. Each turn-consuming ordinary
room record carries a replayable activation certificate. A stale player request or resident worker
cannot act after the room has handed initiative onward.

## Governed choices

`choice` shows the open alternatives, named authority or quorum, incompatibilities, consequence,
closure treatment, permanence, and timeout behavior in one sentence. `support <project>`,
`choose <project>`, and `delegate choice to <avatar>` commit through the canonical journal without
taking a room-wide turn. Inference-controlled avatars may support an authored policy, but a lasting
named choice requires explicit delegation; controller mode, legacy actor kind, title, Calling, and
practice never create authority.

Generated settlements name the earliest directly controlled credited settler as chooser, or wait
for the first directly controlled arrival when none participated. Selection closes incompatible
alternatives while retaining their public support history, and the founding footprint remains a
construction opportunity rather than becoming a sanctuary automatically.

## Ordered scenes

An ordinary multi-avatar room projects `policy: "scene-turn"` and `scene_kind: "room"` in
`state.turn`. Combat projects the same policy in both `state.turn` and `state.combat`. The current
Story Hand can be played only by the named avatar; inspection remains available.

The first active directly controlled avatar opens a fresh room. The server rolls the remaining
stable order from initiative and Dexterity, persists every handoff, and removes unavailable avatars
without allowing one avatar to take another avatar's activation. A resident worker may choose only
from the current inference-controlled avatar's legal Story Hand. If the next avatar is directly
controlled, automation stops and waits for that player for one seat window. When a connected player
holds that seat without a committed action, the server commits one certified Pass on the seated
avatar's behalf and hands initiative onward. Unavailable avatars leave the active order through the
normal reconciliation path rather than being acted for. The server re-checks the exact seat
certificate under the world lock, so a player who acted, left, or was already passed is never
double-passed, and replaying the journal reproduces every timed handoff exactly.

Reactive, local, roaming, and delegated AI modes may rank or describe choices differently, but they
do not reduce the legal mechanical cards available on that avatar's initiative seat.

The authored base grace is 45 seconds. Numeric time is visual-only and hidden from assistive
technology; the polite live-region announcement changes once per handoff rather than on a timer.
There is no automatic punitive skip.

The current participant may use:

```text
pass
need time
```

`Pass` is a kernel action that advances the combat floor without adding Dodge. `Need time` records
a replayable kernel event, adds 60 seconds of nonpunitive grace, does not advance world time, and
does not surrender the turn. Browser buttons and MUD commands call the same authoritative path.

## Replay and conflicts

Pass, Need time, ordinary-room activations, and target races are action-journal records. Replaying
from the same checkpoint reproduces the same winner, losing status, room or combat handoff, and
world tick. Reconnects and reclaimed workers therefore cannot duplicate or steal an activation.
