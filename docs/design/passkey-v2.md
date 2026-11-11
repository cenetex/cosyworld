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
- **Seek.** Removed in rules 133 ([wants and arcs](wants-and-arcs.md)): the
  menu has no "+ Find _Mara_" and the `seek` command is refused.

The same mint latches gates (owner, 2026-11-01): a pack route opens for good
the first time its condition holds, recorded in `world.openedRoutes`, unless
it is marked `live`. An earlier save records the gates already open as it
loads ([pack guide](../../v2/docs/card-packs.md)).

Rules 85 and earlier replay unchanged; worlds created before rules 86 hide
nobody.

## Rules 87: homes away from the pond, and the homecoming (#1936)

The owner settled this on 2026-11-02.

- **Only Vale's way is at the pond.** Each visitor's home lists its door
  places in `shared-cast.json` (`home.doors`). Every world picks one per home
  from its seed and records `world.doors`; the door opens there, as before,
  only while the home's own belonging is near (`home_door` condition).
  `homecoming.mjs` gives a place at most three links in any one world (the
  map rule) and lets a ship take any number. An avatar stranded at home
  rescues to the station.
- **`create` carries the homecoming.** A fresh world for an unlocked avatar
  passes `homecoming: <avatar>`. That avatar starts at the pond, its
  belonging lies at a seeded spot from the hiding pools and hub places, and
  its home's door is one of its doors. Both are places in `lampless`, the
  places any avatar reaches without Vale's lamp. Its want is a story item
  want with a `bring` step `at` its home and no one `to` bring it to; it is
  met when the avatar holds the belonging at home, for one experience point.
  `full::found` passes it for a fresh non-Vale world, including the world a
  committed unlock opens. Importing a save keeps its position, things and
  quest. The quest card says "Bring".
- **A freed seat can discover again.** Reset removes that seat from
  `hidden.met`, so its next holder can Seek and Talk for their own passkey.
  Other seats keep their meetings. The passkey's unlock table still records
  each avatar once, so returning holders do not open duplicate worlds.
- **No fallbacks.** In other worlds a door may stand behind Vale's lamp (the
  forest, the Willows, the Greek ship). A Vale has to open the way.

An earlier save forgets its pond doors and the ways it knew through them, and
gets its doors from its seed as it loads.

## Proposed rules 102: finding a home earns a world slot (#2282)

**Not built.** It waits for the owner's go-ahead. Owner (2026-11-04):
"When Cass enters the Games pavilion you get a New World slot, and in that
new world Mara (or whomever) is lost." Lost characters are lost in the four
core world packs. They are not moved when their pack is off: the player
turns that pack on and goes there.

- **The quest is the homecoming.** "Find Cass's home" means the item (Game
  board), the avatar (Cass) and the location (Games pavilion). The rules 87
  homecoming already meets at exactly that moment. The card may say "Find
  Cass's home" as a client caption.
- **The reward is a world slot.** On a committed `want_met` for a world's
  homecoming avatar and its own item, the host grants that passkey one world
  slot (Rust, `full_store.rs`). Earned slots replace the fixed eight
  (`store.rs`). An unlock no longer opens a world by itself. "+ New world"
  stays a carved box until a slot is earned.
- **The new world's story is the next character, lost.** The host picks the
  next locked avatar as in rules 86. That avatar stands at its own authored
  `lost` place in `shared-cast.json`, a place in one of the four switchable
  groups (shore, cottage, sea, hoppy). This place replaces the seeded
  `hiding.pool` draw in `hideAvatar`, which is a rules change. Its first Talk
  still unlocks it.
- **Lost stays lost.** Today `scatter` (`pack-toggle.mjs`) moves every actor
  from elsewhere out of a pack that goes quiet. A hidden avatar is from
  elsewhere, so it would be moved. It is not live yet: toggles are local-only
  and hiding is shared-only. Rules 102 skips the unmet hidden avatar in
  `scatter`, so it sleeps with the pack. It also keeps the avatar from
  walking home under rules 100 before it is found. There is no fallback
  relocation, and an unreachable lost character is not a bug.
- **Cost.** Data: `lost` per avatar and its schema check. Rules 102:
  `hideAvatar`, `scatter`, walking home. Rust: slot grant and earned cap.
  Client: caption, the box on "+ New world", and the new-world beat through
  the unlock beat. Released rules stay byte-identical.
- **Open.** Who plays the new world; whether the next-avatar order stays
  hashed; which `lost` place each avatar gets; whether signed-out play
  earns slots.

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
