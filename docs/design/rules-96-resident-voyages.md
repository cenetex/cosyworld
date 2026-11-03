# Rules 96: residents embark to their own destination

Owner decision (2026-11-03): "just let him board and take the ship -
residents should embark to their location".

Under rules 95 a resident aboard the Charybdis with no cargo aboard, such
as the roaming Bard bound for Piraeus or the Hoppy Cat jetty, waited for a
course it could not set. The stuck-ship rule then set it ashore at the
harbor, and it boarded again the next round, before any human's call, so a
traveler at Piraeus never got the ship.

## The rule

- **A resident's course is the ship's.** With no human aboard, a resident
  aboard plans and sets the course toward its own destination (the dock on
  the route its want or its wandering names), exactly as a player's course
  card does. On arrival it goes ashore as a rider; the empty ship then
  answers the next call (rules 94).
- **No cargo for resident voyages.** With no human aboard, every lane
  between active docks is open to the resident's course, gated or not. The
  cargo rule binds only a voyage a human rides, so no traveler is carried
  past a cargo gate, and every dock keeps the free way home rules 94 gives
  it, so a resident voyage never strands anyone. Lane knowledge still
  applies to ungated lanes, as before.
- **Players first.** With a human aboard, residents leave the course to
  the human (unchanged), and the cargo rule applies. If a human boards after
  a resident set a cargo course and before it casts off, the course is
  struck and the ship stays docked.
- **Unreachable destinations** fall back to rules 95: a resident with no
  course waits, the idle sail or the stuck-ship rule runs after
  `IDLE_ROUNDS`, and a resident set ashore by it sets that pursuit aside.
- **Unchanged:** a standoff aboard holds the ship; a lamp summon is kept
  while riders are aboard and answered once the ship is empty; the empty
  ship's call (rules 94).

No save field changes, so there is no save upgrade. Rules 93 to 95 are
byte-identical and hash-pinned.

Tests: `test/card-resident-voyage.test.mjs` (the Bard sails to Piraeus,
lands, and Mara boards; the same scenario under the released rules 95
bundle keeps him short of Piraeus; two runs are identical; players first;
a struck cargo course).
