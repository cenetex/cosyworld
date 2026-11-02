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

Rules 78 close the gaps that still left rules-67 worlds asking for a fresh
start under rules 76 and 77, found by upgrading generated rules-67 worlds
that walked every pack:

- A thing that leaves also leaves keepsakes, experiences, standoffs and
  wishes (the storybook map, #1782).
- A told topic takes its current words and choice; a topic that was retired
  or given another teller is forgotten (Oak's night watch, #1747). A told
  lane the ship no longer sails is forgotten (Greek revision 16).
- `reconcilePackProgress` replays each pack's receipts as validation reads
  them. A step whose prerequisites the content no longer meets leaves with
  its log line and recital, and the flags and choices are counted again.
  Residents and things those flags hold back go home; anyone in a place they
  close goes to the pack's entry. Greek revision 11 retired the Theban
  refusal, which had opened the Open Door, so a refusal world that went on
  to Athens loses its Open Door steps there instead of its whole world.

Rules 85 let go of the wishes, lessons and standoffs over the things Lonely
Forest revision 2 retired (the story button, the dewbright button and the
watch bell). RATi's first want was the story button, so a world started
before revision 2 asked for a fresh start on its next load, at
`validateWorld < decodeSave < load` (2026-11-01). It now opens and RATi
draws another want at the next play.

A refused shared world logs its ID, the error and where the rules refused it
(function names and bundle lines), so the next 409 is diagnosable from the
host log.

`decodeSave` turns any script error from upgrading or validating a save into
the existing "needs a fresh start" message, so a stale save shows New game
instead of a raw `TypeError` toast. A shared world never shows that
message: the shared client says the world is waiting for an update and that
everything in it is kept, because no single player can start it over.
The server's reply names where the rules refused the save; the browser
writes that trace to the console and shows only the sentence
(`playerText` in `shared-auth.mjs`).

Released bundles 2–62 keep their bytes; a shared world loaded at an earlier
version records an upgrade to 63 through the new bundle.
