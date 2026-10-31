# Ship voyages and scattered things

Status: design, 2026-10-29. Owner decisions applied. Built in five steps
(see "Build order").

## Outcome

The Greek ship becomes a real vessel that carries people between worlds
along fixed sea lanes. A world joins the table by scattering some of its
things into other worlds. One of those things aboard the ship opens the lane
to its home port. Carrying the things home is the quest. Everything the
player learns arrives through Talk and the existing noun cards; no new
button, menu or panel is added.

## The ship really travels

The ship is always in one place: docked at a port, or at sea on one lane.
It never teleports a passenger. Its saved state has four phases.

1. **Docked.** The ship waits at a port. Anyone at the port can board.
   Boarding keeps the ship at its harbour with its course options open. Aboard
   a docked ship, the location cards are its course cards (see "Course
   cards"). The port it is docked at is never a course, so a person who has
   just boarded can never go straight back to the port they boarded from.
2. **Course set.** The first person aboard to play a course card sets the
   course for everyone aboard. The other course cards leave every hand.
3. **At sea.** The voyage takes **one world round**, however far the lane.
   Aboard, the only place card is the deck itself; people can Talk, Wait, give
   and trade. Nobody disembarks at sea. The deck is a good place for
   conversation: the shipmaster, the Bard and passengers from several worlds
   share one room.
4. **Arrived.** The ship docks at its destination. The only Disembark card is
   that port. When anyone steps ashore, the ship stays there. Everyone still
   aboard can only get off at that port, or stay aboard for the next course.

After an arrival the ship is docked again. A person who boards at the new
port, or anyone still aboard, can set the next course from that port's lanes.

Residents follow the same rules through their legal plays. A resident aboard
when someone sets a course rides along.

### Idle ship

A docked ship with passengers and no course for **three world rounds** sails
its port's first authored lane by itself. An idle passenger cannot hold the
ship at a port.

An empty ship stays where it was last left. A human who waits at a port with
no ship brings the empty ship **one lane closer** along the graph (the first
step of the shortest lane path). The wait is a real crossing, not a jump. The
lamp signal at Black Pond still calls the ship; while people are aboard, the
call waits until the ship is empty.

## Sea lanes

The sea is an authored graph. Each dock lists **at most four lanes**. The
pack validator rejects a dock with more. A lane is two-way unless it is
marked one-way.

| Port | Dock id | Lanes |
| --- | --- | --- |
| Black Pond | `pond` | Wine-Dark Harbor |
| Wine-Dark Harbor | `greek-harbor` | Black Pond, Piraeus (Travel Provisions aboard), Trojan camp landing, Willows landing |
| Athens Harbor | `greek-athens-harbor` | Piraeus |
| Piraeus Quays | `greek-piraeus` | Wine-Dark Harbor (Travel Provisions aboard), Athens Harbor, Signal Jetty (Hoppy Cat thing aboard) |
| Signal Jetty (Hoppy Cat) | `hoppycat-signal-jetty` | Piraeus |
| Trojan camp landing | `greek-ajax-landing` | Wine-Dark Harbor |
| Willows landing | `willows-landing` | Wine-Dark Harbor |

```text
                     Black Pond
                         |
                  Wine-Dark Harbor
                 /       |        \
           Trojan    Willows    Piraeus Quays
           camp      landing     /         \
           landing        Athens Harbor  Signal Jetty
```

From Black Pond the only lane is the Wine-Dark Harbor (owner decision,
2026-10-30, #1483). A traveller from the shore knows that lane alone.

The Wine-Dark Harbor to Piraeus lane opens while the Travel Provisions
(`greek-provisions`, first held at the harbour) are aboard. It uses the same
`opensWith` gate as the Signal Jetty, here with an `item_present` condition on
the ship. Piraeus Quays is outside the Open Door section, so the lane reaches
it in a default save; the quay's roads inland and its stories still need
Dione's invitation. Athens Harbor and Athens keep their Open Door gate. The
lane on from Piraeus to Athens Harbor is learned by sailing it or through
Talk.

Distant worlds are several lanes away. A player needs the thing **and** must
find which port sails there.

When a new world joins with a dock, its dock attaches to ports that still
have a free lane slot. When every port is full, it attaches beyond another
new port, so the sea grows outward.

Today any dock reaches any other in one voyage, and the Greek chapters assume
that. Each authored Greek trip must still be possible on the graph, perhaps
over more than one voyage. A story invitation that unlocks a dock keeps that
unlock: the Trojan camp landing stays closed until Myrto's invitation.

## Knowing a lane is personal

Each character keeps the sea lanes they know in their saved route knowledge
(`world.routeKnowledge[actor]`, already used by the Bard's journeys). A lane is
an edge between two ports.

A character learns a lane when they:

- start in that lane's home region (residents know their home harbour's
  lanes);
- sail it;
- hear it through Talk as a fact: "Ships for the Signal Jetty leave from
  Piraeus."

The shipmaster Myrto (`greek-shipmaster`) knows every lane.

### Course cards

Course cards aboard a docked ship are that port's lanes that this character
knows, plus any lane pulled open by a thing aboard. Two people on one deck
can therefore see different course cards. Once a course is set, nobody sees
course cards until arrival.

## Gated ports: a thing aboard

In this step the gated ports are the **Signal Jetty** (a new dock) and the
**Willows landing** (today's side crossing at the ship's rail becomes a real
dock). Badger Forest and Lonely Forest do not change.

A gated port's lane appears, from its neighbouring port only, when:

- the character knows the lane, or
- a thing from that world is aboard: carried by anyone on deck, or resting on
  deck. The new condition kind `pack_item_present` checks this with the pack
  id.

When a thing opens the lane, it opens for **everyone** aboard. The first
landing teaches the lane to everyone who disembarks there.

## Scatter when a world joins

When a world first joins a save, it scatters **three** things into other
worlds.

- The pack declares them in its `card-world.json`. A pack never scatters a
  thing its own story needs first. Suggested things: Hoppy Cat's Return-Path
  Checklist, Concordance Compass and Loop Token; the Willows map, paddle and
  pipe.
- Destinations are places, and residents of those places, that can be
  reached **without** this world's gate.
- **At least one** thing always rests on a floor, never in a resident's
  hands. The validator or a test proves that a way in exists.
- Placement is deterministic: a fixed hash of the world identity, the pack id
  and the item id picks each destination. Replay, local saves and shared
  worlds agree. Nothing is random at play time.
- The record is saved in `packs[id].scattered`. Worlds that joined in earlier
  saves never scatter.
- A resident who receives a thing keeps it as an ordinary held item. Their
  existing willingness, trade and gift rules decide whether they hand it
  over.

## Homecoming

Each scattered thing holds an item-held quest: **"Take me home"**. Item-held
quests already use the shared quest ledger.

- A thing describes its home but does not name it ("smells of river water and
  woodsmoke").
- Residents of that world and the shipmaster can name its home and give
  leads, following the three-clue rule (the leads from #1350).
- Delivery records a Return and a witnessed ending-style fact that others can
  retell.
- When every scattered thing of a world is home, that world's lane goes on
  every character's chart permanently. Late joiners are never locked out;
  they still need to reach its neighbouring port. The world's residents share
  a line about it.

## Talk carries everything

Everything the player learns arrives through Talk context (`want-talk.mjs`,
`knowledge.mjs`, narrative context) and the existing noun cards. The AI never
decides legality or rewards; the rules do.

## Earlier saves

- Saves where a world has already joined do not scatter. Their items stay
  where they are.
- Anyone who has already visited Hoppy Cat or Willows learns the lane on
  upgrade, from their visit history.
- Hoppy Cat's red thread from Black Pond stays open only in saves that already
  discovered it. New games reach Hoppy Cat by ship to the Signal Jetty.
- A save with someone at the Willows rail crossing keeps working.
- Transport state version 3 migrates from version 2 and keeps the dock, the
  destination and the riders.

## State and rules

- Transport state version 3: `phase` (docked, course, sea, arrived),
  `dock`, `destination`, `since` (the world round of the last phase change)
  and `recall`.
- `routeKnowledge` gains ship lanes. It already validates as edges.
- `packs[id].scattered` lists item ids and their first destinations.
- Each step changes shared rules, so it ships as the next rules version
  through `npm run v2:card:shared:next`. Earlier rule bundles keep their
  bytes for journal replay.

## Build order

1. **Voyage and lane graph**: transport version 3, the lane schema with its
   four-lane limit, course set, one round at sea, arrival-only disembark,
   first ashore sticks, no straight return, the idle rule, the empty ship
   moving one lane toward a waiting human, residents under the same rules,
   migration from version 2, Greek journeys verified.
2. **Lane knowledge**: per-character lanes, the shipmaster knows every lane,
   lanes told through Talk as facts.
3. **Gate**: `pack_item_present`, the Signal Jetty dock, the Willows landing
   dock, earlier saves (earlier visitors learn the lane; the red thread stays
   only where discovered).
4. **Scatter**.
5. **Homecoming**.

Each step is its own PR with unit tests and a smoke journey at desktop and
phone widths.
