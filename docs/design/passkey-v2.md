# Passkey v2: eight avatars, eight world slots, eight seats

The owner approved this model on 2026-11-01
([#1846](https://github.com/cenetex/cosyworld/issues/1846)). It builds on
[avatar bindings](avatar-bindings.md) and the
[avatar menu](../../v2/docs/card-table/avatar-menu.md).

## The model

- **Eight avatars per passkey**, by initial R·A·T·V·M·I·C·S: Rue, Ash,
  Tavi, Vale, Mara, Iris, Cass and Sage. A passkey starts with Vale. Each
  new world hides one of its passkey's locked avatars; talking to that one
  unlocks it ([#1936](https://github.com/cenetex/cosyworld/issues/1936),
  below).
- **One place each.** An avatar is in one world at a time. A person plays one
  avatar at a time, and their others live as residents where they are.
- **One avatar per person per world** (#1737 stays).
- **Eight world slots** per passkey. They are not tied to avatars. Worlds are
  randomized, so their maps can differ a little.
- **Eight seats per world**, one per letter. A seat with no one steering it
  is that character living as a resident. The owner can Free a seat.
- **Levels travel.** Sending Mara from A to B carries her level and
  experience. Her quests and things in A stay in A, and her seat in A frees
  and resets for whoever takes Mara there next. This replaces #1825's
  "starts over in each world".
- **A reactive world.** There is no server tick. Residents, away avatars
  among them, act only inside someone's play in that world. Everything they
  do is in that play's journal entry, so it replays.
- **Local play is a passkey too.** The browser's local identity unlocks
  avatars and holds world slots, and is lost with the browser's data.
- **Owner reset or delete** of a shared world frees the other holders'
  seats. Each holder sees "The owner reset this world" next time, and their
  avatar returns to no world, keeping its level.

## Rules 80

These are the rules changes; everything else is server or client work.

- `seatActors(world, claimed, present)` in `human-cast.mjs` sets a shared
  request's actors. `heldActors` keeps the claims. `controlledActors` and
  `presentActors` are the present avatars, so a human steers an avatar only
  while present. The browser's `sharedWorld` uses the same function, so its
  cards match the server's.
- `residentAvatar(world, id)` is any of the eight that nobody steers in a
  shared world. `entityActive` keeps residents and what they hold in the
  world, and `play` adds the residents in the actor's room to its resident
  pass, which plans with the same `plan` and wants as other residents. The
  want API still treats a held avatar as a player, so an away avatar keeps
  its quest stack.
- A fresh shared world gives its resident avatars a want at once, and the
  reset avatar's record is a fresh shared world's, want included. Imported and
  upgraded worlds give residents wants at their next play.
- Speech accepts lines from resident avatars in the room.
- `join` takes an optional `progress: {level, xp}`, which the server
  journals on the `claim` command. The avatar's `carried` field records the
  least experience that level takes, and it raises the rules' caps on level
  and experience for a young world.

Rules 79 and earlier replay unchanged. A world moves onto rules 80 by its
journaled upgrade.

## Rules 86: one hidden avatar per world (#1936)

The owner settled this on 2026-11-01.

- **Order is per passkey.** There is no fixed R·A·T·V·M·I·C·S chain and no
  rarity weighting. The server picks the hidden avatar from the creating
  passkey's locked avatars by a hash of the passkey and the world id. A
  shared world hides from its owner's locked set.
- **`create` carries the pick.** The server passes `hidden` (the one) and
  `absent` (the passkey's other locked avatars) on the create request. The
  seeded world records both, so replay never reads the unlock table.
- **Placement.** `hideAvatar` in `hidden-avatar.mjs` puts the hidden avatar
  in one of the installed packs' hiding places, hashing `world.run.seed`, and
  records `world.hidden = {actor, place, met}`. It lives there as a resident
  with a want. A pack lists its hiding places as `hiding.pool`, entries
  `{id, depth}` like the specials pool, where depth is `plain`, `door` or
  `night`. A hiding place is the pack's own place and never a drawn special.
- **Absent avatars.** `world.absent` lists the locked avatars a world leaves
  out. They are not residents and take no want. A claim brings one in.
- **Unlock.** A human's first committed Talk with the hidden avatar adds a
  narration line with `unlock: <avatar>` ("Mara remembers Vale.") and
  records the talker in `hidden.met`. Later Talks add nothing.
- **Seek.** The `seek` command gives its avatar the plain person quest to
  talk to the hidden avatar: the menu's "+ Find _Mara_".

The same mint latches gates (owner, 2026-11-01): a pack route opens for good
the first time its condition holds, recorded in `world.openedRoutes`, unless
it is marked `live`. An earlier save records the gates already open as it
loads ([pack guide](../../v2/docs/card-packs.md)).

Rules 85 and earlier replay unchanged; worlds created before rules 86 hide
nobody.

## Phases

0. Holder names, Free and Release, the Table (#1844, #1845).
1. Iris, Cass and Sage, and initial order (#1847).
2. Rules 80 above, then the server: Send frees and resets the old seat, and
   claims carry the level.
3. Unlocks by talk (#1936): rules 86 above, then the server's unlock table,
   the hidden pick at create, the grandfather pass (every avatar a passkey
   already claimed counts as unlocked) and the world that opens on unlock.
4. World slots: eight per passkey, with world reset and delete.
5. The passkey screen.
