# Avatar bindings, Free and Release

Owner rules, 2026-11-01 (#1825): no takeover.

- A person's passkey binds them to the avatar they take in a shared world,
  for good. They always return there as that avatar, and nobody else can
  claim it, released or not.
- When every avatar in a world is bound, the world is full. A newcomer sees
  "This world is full."
- The world's owner can **Free** an avatar (2026-11-01: it removes that
  passkey's hold). It starts over as a fresh level-1 starter, drops what it
  held where it stood, and its place is free.
- The holder can **Release** their own avatar the same way: they give the
  seat back, and its quests and things stay there.
- Release became Leave, now **Step away**, which keeps the binding. Move is
  now **Send to…**.
- Since #1846 an avatar is in one world at a time. Any claim of an avatar
  empties its seats elsewhere: each starts over through the same `reset`.
  The avatar's level and experience go with it. Between seats they are kept
  in `card_avatar_progress(user, actor)`, written whenever a seat empties
  (Send, Release, Free), and the next claim journals them as `progress`
  (rules 80 and later).
- Each holder shows under a holder name ("Amber Heron"), a hash of their
  account id over frozen word lists, the same in every world. Ban is not
  built: a person can make many passkeys.
- Bindings are back-filled from the current members only. An avatar released
  before then was never recorded and can be claimed once by a newcomer
  (accepted for alpha).

## Where it lives

The binding is server state, not a rule: `card_bindings(world, actor, user)`
in `v2/orchestrator-rust/src/card_shared/bindings.rs`, checked before a claim
is journaled. Journals replay unchanged because the binding never enters them.
The snapshot adds `bound` (eight 0/1 seats), `holders` (each bound seat's
holder name), `owner`, and for a non-member `mine`. The world list adds `bound` and `full`.

Free and Release are one rules change (`engine` label, rules 77). Each is the
journaled command
`{"op":"reset","actor":id}`; the server accepts it from the owner or
the avatar's holder. It is reduced by `resetAvatar` in
`v2/card-game/avatar-reset.mjs` through the shared rules, with C guard kind 13
(`CT_SHARED_RESET`: the avatar ends unclaimed and absent; nobody else
changes). The fresh avatar is the actor record of a new shared world, so its
starting place, starter quest and empty memory match a new world's. Its
learning, route knowledge, grievances, defeats and invited places go;
everyone's trust in it returns to nothing; a standoff it was in ends. Released
bundles have no `reset` op and refuse it, so it is never journaled for them.
The batch lander mints the next shared rules version with the other rules
PRs.
