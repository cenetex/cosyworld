# Saves follow the current content

Shared rules 63 reconcile every loaded save with the current content, in
`reconcileContent` (`v2/card-game/legacy-saves.mjs`), after packs are
installed and before validation:

- A retired crossing closes, even where the save had found it. Earlier saves
  kept Hoppy Cat's retired pond-to-garden thread, so Black pond still led to
  the Halfway Tea Garden.
- A thing the hub or a mounted pack authors but the save lacks joins at its
  authored holder.
- A thing the content no longer defines leaves the world. Whatever it held
  goes to its root holder, so a player never loses what they carry. Rules 76
  also clear it from the journal and from what avatars learned: a deed done
  with it, and a lesson about it, leave; a moment it only witnessed keeps the
  others. Rules 75 missed this, so every world that had seen the retired
  storybook map at the station asked for a fresh start (2026-11-01).

`decodeSave` turns any script error from upgrading or validating a save into
the existing "needs a fresh start" message, so a stale save shows New game
instead of a raw `TypeError` toast. A shared world never shows that
message: the shared client says the world is waiting for an update and that
everything in it is kept, because no single player can start it over.

Released bundles 2–62 keep their bytes; a shared world loaded at an earlier
version records an upgrade to 63 through the new bundle.
