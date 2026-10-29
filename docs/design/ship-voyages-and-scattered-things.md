# Ship voyages and scattered things

Status: design, 2026-10-29. Not built yet.

## Outcome

The Greek ship becomes a real vessel that carries people between worlds. A
world joins the table by scattering some of its things into other worlds. One
of those things aboard the ship opens the way to its home port. Carrying the
things home is the quest. Everything the player learns arrives through Talk;
no new button, menu or panel is added.

## The ship actually travels

The ship is always in one place: docked at a port, or at sea on one course.
It never teleports a passenger.

1. **Docked.** The ship waits at a port. Anyone at the port can board. While
   it is docked, the ship's location cards on board are its open courses
   (see "Courses" below). The port it is docked at is never a course, so a
   person who has just boarded cannot step straight back to where they came
   from.
2. **Course set.** The first person aboard who plays a course card sets the
   course for everyone aboard. The other course cards leave the hand. The
   ship stays at the dock until that play resolves. Then it casts off.
3. **At sea.** The voyage takes one world round per leg. A leg is the hop
   between neighbouring ports in the ship's chart order, so a long crossing
   takes longer than a short one. Aboard, the only location card is the deck
   itself; people can Talk, Wait, give and trade. Nobody can disembark at sea.
   The deck is a good place for conversation: the shipmaster, the Bard and
   passengers from several worlds share one room for a few turns.
4. **Arrived.** The ship docks at its destination. The only Disembark card is
   that port. When anyone steps ashore, the ship stays there. Everyone still
   aboard can only get off at that same port, or stay aboard for the next
   course.
5. **Next course.** A person who boards at the new port, or anyone still
   aboard, can set the next course. The new course never includes the port
   the ship is docked at.

Residents follow the same rules through their legal plays. A resident already
aboard when a human sets a course rides along, as today's companion rules
allow.

An empty ship stays where it was last left. Today a human waiting at a port
moves an empty ship around its circuit. That stays: **Wait at a port with no
ship** sends the empty ship one leg toward that port, so the wait is a real
crossing, not a jump.

## Courses: at most four

The ship's chart lists every port it can serve: Black Pond, the Wine-Dark
Harbor, Athens Harbor, Piraeus Quays, the Trojan camp landing, the Signal Jetty
(Hoppy Cat) and the Willows landing. That is already more than four.

Aboard a docked ship, a person sees **at most four course cards**:

- only ports this person knows, or a port whose world has a thing aboard (see
  "The way in");
- a port whose thing is aboard comes first, because it is new;
- the rest follow the chart order from the ship's current port.

**Wait aboard a docked ship turns the chart.** The window of four moves to the
next known ports in chart order, wrapping once. Like Location Think, a stable
set of known ports is reachable within one cycle. The cursor is saved per
person aboard and clears when that person disembarks.

## Knowing a port is personal

Each character keeps the sea lanes they know in their saved route knowledge
(`world.routeKnowledge[actor]`, already used by the Bard's journeys). A lane is
an edge from the ship to a port.

A character learns a lane when they:

- start in that port's region (residents know their home harbour);
- disembark at that port for the first time (this **anchors** it; it stays
  known after the thing that opened it goes home);
- are told it through Talk by someone who knows it. A lane is a fact like any
  other: "Myrto knows the way to the Signal Jetty."

Two people on one deck can therefore see different course cards. The
shipmaster, who knows every port the ship has served, is the person to ask.

## The way in: a thing aboard

A gated port (in this first step, the **Signal Jetty** for Hoppy Cat and the
**Willows landing**) appears as a course only for a person who:

- already knows its lane, or
- is aboard while a thing from that world is aboard: carried by anyone on the
  deck, or resting on the deck.

The thing "pulls" toward home. Talk can say so: the thing has its own voice,
and a scattered thing knows where it belongs.

The rule uses the existing crossing condition `item_present` (the item is held
by someone at the ship or rests there) for "any item of pack P", added as a
small new condition kind `pack_item_present` with the pack id.

## Scatter when a world joins

When a world first joins a save, it scatters a few of its things into other
worlds.

- A pack names its scatterable things and how many to scatter in
  `card-world.json` (for example `"scatter": { "items": [...], "count": 3 }`).
  Hoppy Cat's Return-Path Checklist, Concordance Compass and Loop Token, and
  Willows' River Map, Paddle and Pipe are natural choices. A pack never
  scatters a thing its own story needs before the player can arrive.
- Destinations are places in the hub and in other worlds that can be reached
  **without** this world's gate, plus some residents of those places. At
  least one thing always lands somewhere reachable from the first scene, so
  the way in can always be found.
- The draw is deterministic: a fixed hash of the world identity, the pack id
  and the item id picks each destination. Replay, local saves and shared
  worlds agree. Nothing is random at play time.
- A resident who receives a thing keeps it as an ordinary held item. Their
  existing willingness, trade and gift rules decide whether they hand it over.
  Their Talk context says how it came to them ("This compass washed up at the
  harbor the day the jetty appeared.").

### Taking things home is the quest

Each scattered thing holds an item-held quest: **"Take me home"**, one step,
the thing at its home place. Item-held quests already use the shared quest
ledger.

- The thing's own voice says where home is. Residents of its home world know
  it is missing and where they last heard of it (the leads from #1350).
- Delivering it completes the quest, records a Return, and becomes a
  witnessed ending fact. Residents and the Bard can retell it.
- A resident's hope can lean toward bringing a thing home (pack situations
  already support delivery templates).
- When every scattered thing of a world is home, that world's residents
  share an authored line about it. A pack can attach a small closing scene.

The route stays known to everyone who has landed there, so returning the last
thing never strands a player.

## Red thread and earlier saves

- Saves where a world has already joined do not scatter. Their items stay
  where they are.
- Anyone who has already visited Hoppy Cat or Willows learns the lane on
  upgrade, from their visit history.
- Hoppy Cat's red thread from Black Pond stays open in saves that already
  discovered it. New games reach Hoppy Cat by ship to the Signal Jetty.
- Willows changes from a side crossing at the ship's rail to a real port on
  the chart. A save with someone at the rail crossing keeps working.

## State and rules

- Transport state version 3 adds per-person voyage fields: the course
  (`destination`), `atSea` legs remaining, and a per-person chart cursor. The
  migration from version 2 keeps the dock, the destination and the riders.
- `routeKnowledge` gains ship lanes. It already validates as edges.
- The scatter record is saved once per pack: `packs[id].scattered`, a list
  of item ids and their first destinations. It decides whether a pack has
  already scattered.
- This changes shared rules, so it ships as the next rules version through
  `npm run v2:card:shared:next`.

## Build order

1. **Voyage**: transport version 3, course set, legs at sea, arrival-only
   disembark, Wait at a port moves the empty ship one leg. Tests: no instant
   return, first ashore fixes the port, riders can only leave there, replay.
2. **Chart**: the four-course window, per-person lanes, Wait aboard turns the
   chart, shipmaster knows every lane, lanes told through Talk.
3. **Gate**: `pack_item_present`, Signal Jetty dock, Willows landing dock.
4. **Scatter**: pack `scatter` schema, deterministic draw, reachability
   guarantee, resident holders.
5. **Homecoming**: item-held "Take me home" quests, item voices, residents'
   leads, return facts, world-whole line.
6. **Upgrade**: earlier saves, red thread, Willows rail.

Each step is its own PR with tests and a smoke journey at desktop and phone
widths.

## Open questions

- Should a voyage leg be one world round (the default here), or should
  longer crossings take more?
- Should a thing aboard open its port for everyone aboard, or only for the
  person carrying it? This design says everyone aboard, because the ship
  carries it.
- How many things should each world scatter? This design suggests three.
