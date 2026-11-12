# Night Shift at RatiRadio

The station opens through recovered possessions. The Station Key at Black Pond
opens Empty Station into the Staff Kitchen, for whoever carries it. Each door
after it wants a different thing, so the station is one room of three locks,
not three copies of one:

| Door | Lock | What opens it |
| --- | --- | --- |
| Dispatch Window | a thing held | Carry the Red Beanie to it. Set it down in the Staff Kitchen and the way shuts. |
| Listening Room | a thing placed | Set the Thermos down at the Dispatch Window, on the metal plate beside the door. Carrying it in opens nothing, and carrying it off shuts the way again. |
| Broadcast Booth | something heard | Talk with RATi while holding the Raven Figurine, in the Staff Kitchen, Dispatch Window or Listening Room. Holding it alone opens nothing. |

The entrance, the Dispatch Window and the Listening Room open and close with
their things (audit rows R1 to R3, 2026-11-11): each is a live way that reads
its item as it stands now, with no flag. Only the way in is live; every way
out is plain, so no one is ever shut inside. Because the entrance asks for a
carried key and the Dispatch Window for a held beanie, a key left inside the
kitchen, or a beanie left at home in the Listening Room, leaves later visitors
outside until someone carries it out. The Broadcast Booth (once heard) and the
Raven (once earned) stay latched until the next rules batch; the figurine may
be put down afterward. Every
locked way and the sealed Raven is drawn as a locked box with its reason from
the start ([wants and arcs](wants-and-arcs.md), "Boxes first"). RATi roams, so
the Booth waits for a moment when he stands with the traveler in the station;
he returns home to level, and the Thermos and figurine stay where they were set.

The glass starts in the booth. Put the glass, figurine, beanie directly in the
Listening Room together to reveal Raven once. Carried objects, gifts to RATi,
separate historical deposits do not count. The unlock remains earned after
objects move. The song, RATi's presence, the optional Request Slip add no gate.

RATi's wants are three staged wants (rules 133, unordered): the Red Beanie,
the Raven Figurine and the glass, each wanted at home in the Listening Room.
As each comes home the next is picked; with all three there, Raven wakes and
his wants are drawn.

The Listening Room is RATi's fixed home and a sanctuary. RATi roams normally,
earns experience away, returns home to gain his next level. Raven becomes a
normal roaming resident after the return. The ceramic figurine remains an item.

The locked Raven uses the existing sealed card and descriptor. All actions use
the existing context button. No extra panel, widget or ritual verb is needed.

Entering the booth starts the supplied six-minute remaster for that listener.
The performance follows the return journey. Muting never affects progression.
First-listen state is separate from shared-world gate and resident flags.


## Room rhythm and truthful scenery

Each room has a different purpose: cold uncertainty in the Staff Kitchen;
a staffed-but-empty threshold at Dispatch; genuine shelter in Listening;
a performance that earns its meaning in the Booth. The words follow the
approved place paintings: refrigerator glow, wired glass and clock, RATi's
armchair, studio meters. Movable quest items remain separate cards, never
painted onto a room that might have lost them.

Sealed-route descriptors and item cards still state exact requirements.
A resident may speak about what is missing, but speech does not open a door.
Raven's appearance follows three direct placements, not the quality of an
AI's narration. This treatment follows the short taste review in
[the jagged-AGI design proposal](https://github.com/cenetex/cosyworld/pull/2574).

## Authority and compatibility

The rules own possession, passage, activation, levels. The entrance must
check the actual traveler's inventory. The Dispatch Window and Listening Room
read their items live; the Booth latches through a saved flag. Completion checks direct item holders, then saves one permanent flag.
No automatic recovery may deliver a return item to the Listening Room.
The new pack uses stable `ratiradio-*` entity IDs; the existing RATi is preserved.
Source packs, generated catalog, current shared rules must ship together.
Released engines stay immutable for journal replay.

## Evidence

Verify the full route using legal actions, save/reload, shared replay, a second
traveler's key ownership, early returns, the exact third placement, permanent
unlock, RATi's absence, level return, muted playback, lost-property recovery.
Check desktop and phone card layouts with the normal sealed-card presentation.
The implementation PR records commands, server CI, remaining release evidence.
