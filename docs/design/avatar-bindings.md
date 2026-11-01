# Avatar bindings and the owner's delete

Owner rules, 2026-11-01 (#1825): no takeover.

- A person's passkey binds them to the avatar they take in a shared world,
  for good. They always return there as that avatar, and nobody else can
  claim it, released or not.
- When every avatar in a world is bound, the world is full. A newcomer sees
  "This world is full."
- The world's owner can delete an avatar. It starts over as a fresh level-1
  starter, drops what it held where it stood, and its place is free.
- Release becomes Leave. Move keeps the old world's binding, so an avatar is
  played in one world at a time rather than kept in one world.
- Bindings are back-filled from the current members only. An avatar released
  before then was never recorded and can be claimed once by a newcomer
  (accepted for alpha).

## Where it lives

The binding is server state, not a rule: `card_bindings(world, actor, user)`
in `v2/orchestrator-rust/src/card_shared/bindings.rs`, checked before a claim
is journaled. Journals replay unchanged because the binding never enters them.
The snapshot adds `bound` (eight 0/1 seats), `owner`, and for a non-member
`mine`. The world list adds `bound` and `full`.

The delete is a rules change (`engine` label). It is the journaled command
`{"op":"reset","actor":id}`, reduced by `resetAvatar` in
`v2/card-game/avatar-reset.mjs` through the shared rules, with C guard kind 13
(`CT_SHARED_RESET`: the avatar ends unclaimed and absent; nobody else
changes). The fresh avatar is the actor record of a new shared world, so its
starting place, starter quest and empty memory match a new world's. Its
learning, route knowledge, grievances, defeats and invited places go;
everyone's trust in it returns to nothing; a standoff it was in ends. Released
bundles have no `reset` op and refuse it, so it is never journaled for them.
The batch lander mints the next shared rules version with the other rules
PRs.
