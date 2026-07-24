# Sparse, Actor-Causal World Simulation

World maintenance is driven by committed played time. Every sixth qualifying
world tick is a deterministic scheduling opportunity, not a promise to produce
news. A due interval may update bounded frontier state and publish no event.
The same journal prefix, content bundle, and seed always produce the same
maintenance and public-beat decision.

## Public beat budget

A due interval publishes at most one material `world.*` beat. Stakes outrank a
new opportunity; otherwise a deterministic gate and candidate selection choose
between a notable weather transition, a concrete delivery need, a new faction
claim, or a threshold conflict change. Non-notable weather, small pressure
changes, and repeated active needs remain silent.

Sanctuary state is never changed by automatic maintenance. Background
opportunity state cannot become stakes. A stakes transition requires a
journaled, causally relevant action in that same frontier and retains the
source action sequence when it advances the local danger clock.

## Logistics

`trade_stock`, local use, and supply pressure are aggregate regional state.
They never represent cargo and never emit a delivery-completed event. When
scarcity becomes playable, the projection creates or updates a delivery job
that names an origin, destination, and needed resource. Generic Work/Help
cannot complete that job: the visible instructions require picking up a
physical item, traveling with it, and giving, dropping, or using it at the
destination.

`world.logistics.completed` is derived only when the journal proves:

1. a named active avatar acquired a physical item;
2. one or more continuous `actor.moved` events carried that avatar from the
   acquisition room to a different destination; and
3. the same avatar completed `item.given`, `item.dropped`, or `item.used` there
   without an intervening transfer that broke possession.

The completion event stores actor id, item id, origin, destination, acquisition
sequence, every movement sequence, the delivery sequence, source world tick,
and a combined causal sequence list. Remove any required action from replay
and the completion cannot be derived. Human-driven and inferred avatars use
the identical evidence shape.

Older `world.trade.flowed` and `world.trade.disrupted` records remain readable
for journal compatibility, but new play never emits them and the player UI
does not repeat their fictional transport prose.
