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
  goes to its root holder, so a player never loses what they carry.

`decodeSave` turns any script error from upgrading or validating a save into
the existing "needs a fresh start" message, so a stale save shows New game
instead of a raw `TypeError` toast.

Released bundles 2–62 keep their bytes; a shared world loaded at an earlier
version records an upgrade to 63 through the new bundle.
