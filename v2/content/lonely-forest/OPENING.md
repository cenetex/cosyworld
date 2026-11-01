# Tea beneath the oak

The first card chapter has four places: Cosy Cottage, Rain-Soft Garden,
Moonlit Trail and Old Oak Tree. RATi speaks in words. Skull answers through
physical movement. Whiskerwind speaks in two to five emojis. Oak speaks
through Root, Ring, Leaf and Hollow.

The creator premise comes from `docs/art-direction/README.md`. The old oak
is the waking body of the Tree of Dreams. RATi, Skull and Whiskerwind are
its three walking personalities. Each has a distinct manner. This chapter
reveals their link through a familiar detail repeated at the oak.

## The journey

The chapter has no story buttons. Each step follows an ordinary play, and
the model voices it from the committed facts.

1. Talk to RATi in the cottage. That play is her welcome.
2. Wait in the garden. The traveler clears the drain, and the Moonlit Trail
   opens.
3. Go to Skull on the trail. Talking with him shares the pawprint watch.
   Take the Wolfprint Charm.
4. Carry the charm to Oak. Talking with Oak while holding it records the
   account.
5. Home at the cottage, end the visit one of two ways:
   - Give RATi the charm. It stays by the hearth.
   - Wait at the hearth with RATi while holding the charm. The traveler
     keeps it for the next journey.

Either ending closes the visit, and the other can no longer follow. The
keep ending needs the Wait itself: carrying the charm in and giving it to
RATi never keeps it.

While the charm is at Oak, Oak opens the way to the Moonlit Trail. The charm
counts when someone present carries it, when it lies among the roots or
when Oak holds it. Once the charm stays by the hearth, Oak's way closes, and
the garden path to the trail stays open.

The welcome, the watch and the account commit at the traveler's Talk with
the resident (`on: "talk"`). A later visitor meets the completed work.

## A button in your own colour

Each traveler has a button in their own colour. The first time a traveler
shares a room with RATi, their button is hidden. It can be anywhere in the
world, including other worlds behind closed lanes, but never in the room
where they met her. The rules pick the place with a stable hash of the
traveler and the turn, so each world has its own spot and every replay
agrees. Nothing guarantees the button is easy to reach. Finding it is part
of the mystery.

The lost button becomes the traveler's quest (their want). Taking it meets
the quest. It is an ordinary thing: anyone can take, carry, trade or ask
for it, and anyone who values it may come to want it.

RATi's Talk says she would sew the button into a scarf of the complementary
colour. A traveler who brings their own button to the cottage and gives it
to RATi gets their scarf. The Give triggers the sewing choice. The button
leaves the world, and RATi wraps the scarf around them. She refuses
someone else's button.

| Traveler | Button | Scarf |
| --- | --- | --- |
| Vale | black | white |
| Mara | red | green |
| Ash | orange | blue |
| Nell | yellow | violet |
| Tavi | green | red |
| Rue | blue | orange |
| Orin | indigo | amber |
| Ada | violet | yellow |

Buttons open no ports or lanes. Revision 2 removed the shared Story Button
and its scarf repair, along with the Dewbright Button and the Watch Bell.
The save upgrade drops them and their choices. A Watch Bell set beside
Skull becomes the pawprint watch.

Revision 3 retired the story buttons. A save that had set the stones moves
that deed to clearing the drain, and one that told Oak of the path moves it
to telling of the hearth: each pair shares a place, a subject and a flag.

## The three walkers

After the homecoming, RATi at the cottage or Root at the oak can tell who
the three walkers are through Talk. Anyone who knows it can then Wait on
the trail to keep the evening watch with Skull.

## Attic stairs

The Black cloth physically in the attic and a lit, fueled, uncovered lamp
there reveal stairs down to the cottage. The cloth may lie on the attic floor,
be carried by someone in the attic, or cover an object physically there.
The `item_present` descriptor follows nested custody; covering the lamp
blocks its light and closes the stairs. Light alone opens the attic mirror
onto Black pond. A dark attic has an empty mirror and no cottage stairs.

The cottage keeps an unconditional stair back to the attic. Taking the cloth
or lamp away closes entry from the attic until both requirements return.
The cottage's return remains available through that change and after the lamp
runs dry. The existing narrow rescue paths remain available when reachable
lamp remedies are exhausted; they are separate from the ordinary gates.

## Source and art

`classic-to-card.json` records every adapted place, resident and item ID.
The source actors, locations, objects and room features live in
`v2/content/core/`. The garden work adapts the source garden job. The card
chapter owns its outcomes.

The Wolfprint Charm illustration is an unchanged copy of the core
`cosy-wolfprint-charm.webp`. The buttons use
`button-<character>.png` and the scarves use `scarf-<colour>.png` in
`v2/card-game/assets/lonely-forest/` (#1441). Character and place art joins
those files in the same pack asset folder.

The existing forest art guide records later dream proposals. A later
chapter can choose a first dream and a clear route home.
