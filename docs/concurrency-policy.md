# Scene concurrency policy

Ordinary co-present play is asynchronous. No avatar owns a room-wide turn merely because two or
more controllers are present. Controller mode and legacy actor kind do not change action legality.

Every operation belongs to one concurrency policy:

- **concurrent** — chat, emote, inspection, personal reflection, independent movement,
  exploration, and compatible contributions commit in canonical journal order without waiting for
  another avatar;
- **target-serialized** — writes to the same item, slot, offer, or decision commit under the world
  lock. One write wins deterministically and the losing client receives an `action.conflict`
  explanation without a duplicate effect;
- **scene-turn** — combat and another explicitly authored ordered procedure name the current
  participant and reject out-of-order mechanics with a causal explanation;
- **governed-choice** — scarce communal choices use a versioned chooser, covenant, competing-project,
  explicit-delegation, or authored-automatic policy rather than turn ownership.

Serialization of the journal remains authoritative for every policy. “Concurrent” describes what
players may attempt without an artificial room gate; it does not permit races to bypass ownership,
authorization, capacity, governance, or compare-and-set checks.

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

Combat projects `policy: "scene-turn"` in both `state.turn` and `state.combat`. It explains the
ordered rule before an action, while chat and inspection remain available.

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

Pass, Need time, and target races are action-journal records. Replaying from the same checkpoint
reproduces the same winner, losing status, combat handoff, and world tick. Reconnects therefore
cannot duplicate or steal a committed action.
