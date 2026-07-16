# Played-Time World Simulation

CosyWorld's wider world changes through committed play, never through elapsed wall time. The Rust orchestrator owns a deterministic projection reducer in `orchestrator-rust/src/world_simulation.rs`; the action journal remains the source of truth and snapshots remain disposable accelerators.

## Pulse contract

- One world pulse is due on every sixth committed player world tick.
- Replaying the same journal records and seeds produces the same pulse state and public history.
- Reads, speech, resident-only actions, process uptime, and time spent offline never advance the simulation.
- A pulse prefers routes that do not touch the acting player's room, so play in one room produces news elsewhere.
- Automatic pulses mutate frontier rooms only. Sanctuary stock, weather, pressure, and influence are not changed by the reducer.

Every effect has an explicit code-level class:

- **Ambient:** weather and other harmless atmosphere. It changes a visible room property and can never advance danger, remove resources, injure an actor, or close a path.
- **Opportunity:** trade stock/pressure, imports, faction influence/momentum, and sub-threshold conflict pressure. It changes visible state and creates a reason to visit, but declining it or staying offline carries no player-owned loss.
- **Stakes:** a conflict escalation and its danger-clock consequence. It is available only when the same committed turn contains a successful, same-location frontier action tied to an active job: entering that frontier, advancing its progress clock, attacking, dodging, or defending there.

The public event copy names its class and says what a traveler can do next. A stakes event and every resulting clock/job event retain the exact causal frontier event sequence, source world tick, and source location.

## Coupled reducer

Each pulse resolves in a fixed order:

1. Weather changes at the origin of a frontier route. The palette and intensity come from the room biome.
2. Trade attempts to move one unit of an authored room resource along that route. Severe weather or exhausted stock disrupts the route and raises scarcity pressure; a successful route moves stock, records an import, and eases pressure.
3. A content-authored faction with influence on a connected route can spread into a frontier room. Successful trade adds faction momentum; disruption removes it.
4. Conflict pressure is derived from faction opposition, active authored Fronts, room danger, weather, and trade. Open trade can ease pressure. Scarcity, severe weather, or opposing factions can raise it, but an opportunity-only pulse is capped below the stakes threshold.
5. When a relevant frontier action is recorded on the due turn and local pressure reaches its threshold, the pulse emits a stakes event and advances that location's active authored danger clock. Pressure then falls back so the same consequence cannot fire on every later pulse.

This makes the systems causal rather than four independent random feeds: weather changes trade, trade changes faction momentum and scarcity, faction collisions and scarcity change conflict, and a player's local frontier commitment is the only bridge from visible pressure to a real project clock.

## Persistent state and events

The snapshot stores, per location, current weather, weather intensity, trade stock, trade pressure, accumulated imports, conflict pressure, faction influence, and the last pulse tick. Per-faction momentum and last action tick are stored alongside it. Loading an older snapshot seeds missing simulation state from the compiled worldpack.

Public consequences use replayable world events:

- `world.weather.shifted`
- `world.trade.flowed` / `world.trade.disrupted`
- `world.faction.influence_shifted`
- `world.conflict.pressure_grew` / `world.conflict.pressure_eased` / `world.conflict.escalated`

Each event carries the source world tick, the room whose committed action powered the pulse, and the causing event sequence when available. `/state` exposes the current room's simulation state. `/world` exposes faction momentum and the latest 48 history events. The browser's World Library renders the latest distant news, while room arrival copy turns local values into fiction such as weather, thin supplies, faction signs, and unease.

## Safety and scope

The reducer is bounded to one weather shift, one trade attempt, at most one faction move, and one conflict update per pulse. Stock remains in `0..=24`, trade pressure in `-6..=6`, influence in `0..=4`, faction momentum in `-12..=12`, and automatic conflict below the stakes threshold. Route selection is restricted to authored frontier-to-frontier exits. It uses no AI and performs no IO. Sanctuary conflict cannot escalate, sanctuary state does not decay or change automatically, unrelated actions cannot authorize stakes elsewhere, and a quiet shard is perfectly still.

The trade model is currently an abstract regional stock projection, not physical item transfer or player pricing. Pulses can advance existing danger clocks but do not yet generate new Jobs, move residents, or create items. Those remain separate, authoritative gameplay actions.
