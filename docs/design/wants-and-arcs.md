# Wants and arcs

Status: design agreed with the owner, 2026-11-10. Nothing here is built.
No question is open. Issue:
[#2605](https://github.com/cenetex/cosyworld/issues/2605), under
[#2576](https://github.com/cenetex/cosyworld/issues/2576).

Line numbers are for main at `c3bfac77a` (rules `full-card-world/131`). Pack
counts are computed from `v2/card-game/packs.json` with a short Node script
over the six mounted packs in `v2/worlds/card-table.json`.

## Owner decisions, 2026-11-10

1. Buttons: "Only the 9 buttons." The `choose` play goes. The 179 authored
   choices that fire from fixed verbs stay.
2. The player's want: "Players should earn xp by unlocking boxes primarily.
   They should have one 'quest/want' at a time too but they should get them
   from locked boxes or conversations."
3. A helper earns XP when their play meets someone else's want: "sure".
4. Home: "Vale's home is the attic, each avatar has their home."
5. Discarding Sleep at home: "costing xp is what prevents it coming back
   immediately, so keep it."
6. Arcs, option A with the cap of three: "sure", and a question: "does it
   follow the principles of deleuze and jodorowsky?"
7. Dreams: "Keep long rest dreams its charming."
8. Shared worlds on Lonely Forest at the rules bump: "we can reset."
9. Boxes first: "I mean almost every box should be locked, unlocking a box
   should 'feel' like the primary way until they're all unlocked then you
   find out about desire (we ahve 9 locked boxes now but perhaps we should
   have many more) also the world generator provides an opportunity for
   procedural expansion"
10. Re-locking and visibility: "yes, boxes can re-lock and so on as well -
    think of it as a maze of escape rooms but the locked boxes should be
    visibile right..."
11. RatiRadio's three doors sharing one lock kind: "Vary 2".
12. Whether a box hands over a want: "A locked box tells you its want."
13. Unordered staged wants: "(?)" (settled in 16). The halfway dream: "dreams".
    Homecoming and Pip's lamp as starter wants: "sure".
14. "yes to all four", to these four recommendations: desire is per box,
    and a resident's own desire is a second want learned by Talk after
    their box opens; a box that locks again does not pay XP again (one XP
    per box, once per avatar per world); items are boxes too, as a later
    slice; the start is Vale, the Lamp and the Mirror attic open, with the
    Black pond the first box, opened by putting the lamp out.
15. Taken by a tap: "the wants that a player avatar could have - where do
    they come from? click a locked box 'take quest' and when you earn xp
    after reaching enough u get 'take level up quest'? so its always a tap
    whereas currently its random"; "after 'talk' with a resident the first
    time in a room we could have 'accept quest' option"; "and so on".
16. "go with your picks", to these seven: while a quest is held, the three
    buttons are unavailable with the reason as their label, and nothing is
    replaced; Accept quest is offered after the first Talk since arriving
    in that place, until either leaves or the want changes; Take level up
    quest is on the player's own avatar card; homecoming is Take quest on
    the avatar's home, shown as a locked box; staged wants are unordered,
    with authored order only breaking ties; yes to the two varied RatiRadio
    doors; every lock visible applies to the hub's home doors.
17. Whether the hub's other ways (the mirror back to the attic, the lit
    arch to the Empty station) should become visible locked boxes too:
    "yep".

## Already decided earlier

This draft does not reopen these.

- One want per avatar, XP is wants met, no authored quest chains (owner,
  2026-10-30; PRs #1449, #1451, #1700). The stack came back with #1831
  ([quest stack](quest-stack.md)), [two active quests](two-active-player-quests.md),
  Talk gives a quest (#2196) and sealed ways
  ([rules 95](rules-95-item-cycle-and-sealed-gates.md)).
- Fixed verbs; Talk is the path to desires (#1581, open;
  [Talk-triggered choices](talk-triggered-choices.md)).
- [Level curve](level-curve.md), [sleep](sleep.md) (#2028),
  [rest and sanctuary](../../v2/docs/card-table/rest-and-sanctuary.md)
  (#1648), [residents level at home](resident-level-home.md).
- Crafting is a locked thing and its unlock quest
  ([items and crafting](items-and-crafting.md), rules 102).
- "Find <avatar>'s home" earns a world slot (#2282, proposal); the hidden
  avatar and homecoming are built (#1936).
- [Polynices' funeral](polynices-funeral.md) is an owner exception to "no
  quest chains" (#2301). [RatiRadio](ratiradio.md) opens through recovered
  possessions.
- Remembered help belongs to #1871, grounded refusals to #2539, the truth
  boundary for speech to #1537, talk-to-reveal to #1848.
- The arc is relationships deepening. AI characters act only by talking. UI
  goes through the bar, the context button, cards and stacks.

## What exists today

### Quest sources

`actor.want` is the top quest and `actor.under` the rest. Players hold two
active quests and more waiting (`QUEST_LIMIT`, `want.mjs:49`); residents hold
three (`want.mjs:50`). Nine places add a quest:

| # | Source | Where | Count in data |
| --- | --- | --- | --- |
| 1 | Authored starter `want` | `installWants`, `want.mjs:510` | 11 of 58 pack residents; Vale, Pip and the keeper (`forest.json:75,86,100`); BoardyAI |
| 2 | Drawn from the world | `nextWant`, `want.mjs:628` | every empty stack |
| 3 | Level quest, on waking | `offerLevelQuest`, `want.mjs:312`, from `wake`, `want.mjs:427` | players only |
| 4 | Talk gives a quest | `talkQuest`, `talk-quest.mjs:74` | any revealed want |
| 5 | Sealed way gives a quest (`gate` play) | offered `world.mjs:1615`, pushed `world.mjs:3001` | 4 routes: the Hollow, and three in RatiRadio |
| 6 | Pack effect `hide_item` | `pack-registry.mjs:830` | 8 choices, RATi's buttons in `lonely-forest` |
| 7 | Homecoming, "Bring <item> home" | `homecoming.mjs:72-91` | one per non-Vale world |
| 8 | Seek, "+ Find <name>" | `seekHidden`, `hidden-avatar.mjs:70-79` | one hidden avatar per world |
| 9 | Pip's landing page | `beginPipJourney`, `pip-landing.mjs:31-36` | `/pip` only |

A quest is offered by being pushed (`pushQuest`, `want.mjs:193`), chosen with
the `focus` play (`world.mjs:2983`), met by a world fact after a play
(`settleWants`, `want.mjs:779`), and paid as one XP and a reward receipt the
player claims (`commitMet`, `want.mjs:808`; `claim`, `world.mjs:2967`).

### Story choices

A story choice is an entry in a pack's `choices`: a subject, a place,
`requires`, `effects` and a World line. The six packs hold **188**: Greek 86,
Hoppy Cat 52, Lonely Forest 33, Willows 11, RatiRadio 6, Badger 0.

Only **9** are buttons. A choice with no `on` is offered as a `choose` play
on its subject's card (`packChoices`, `pack-registry.mjs:587`, added to the
legal plays at `world.mjs:1592`): seven Ajax choices in Greek and two
"Hear … on the three walkers" in Lonely Forest. All nine also have a Talk
topic that commits them.

The other **179** already fire from a fixed verb and are never offered as
cards: give 66, meet 40, wait 34, talk 30, hold 8, depart 1
(`choiceFeasible`, `pack-registry.mjs:541`; `packGiveChoice` `:660`;
`packTalkChoice` `:756`). Five Greek choices are `archived` and never fire.

### Locked boxes

A locked box is a card the rules keep shut, drawn face down on the locked
carved back with the label "Locked". It is presentation over rules facts:
`isLockedBox` is "this card has a sealed reason" (`locked-box.mjs:130`,
`sealedReason`, `cards.mjs:176`). Five kinds of fact make one:

| Kind | Where | Today |
| --- | --- | --- |
| Sealed way: a route with `sealed` | `sealedWays`, `world/geography.mjs:216` | 4: the Hollow (Greek); Dispatch Window, Listening Room, Broadcast Booth (RatiRadio) |
| Guarded way | same; `world-life.json:23` | 1: Theban gate to the battlefield |
| Locked made thing: `locked: { by, consumes }` | `lockedAt`, `pack-items.mjs:91` | 2: Dione's bread, Myrto's Travel Provisions (Greek) |
| Sealed resident: `sealed: { at, reason }` | `sealedAvatar`, `cards.mjs:31` | 1: Raven (RatiRadio) |
| Shut ship lane with a `reason` | `shutLanes`, `pack-transport.mjs:150` | 1: Wine-Dark Harbor to Piraeus |

That is **9** in the mounted packs: Greek 5, RatiRadio 4, the other four
packs 0. The hub's own gates (home doors, the mirror) are not counted: they
are not drawn as locked boxes.

- **Selecting one** shows what opens it: its authored reason, or a caption
  built from its conditions (`lockedQuest`, `locked-box.mjs:21`). The
  context button reads "Locked" and is disabled (`app.mjs:2636`).
- **Opening one** happens when its facts hold: the guard has the Writ, a
  flag is set, the maker holds the set (`settleCrafting`,
  `pack-items.mjs:102`). The box turns over once, in this browser.
- **No XP is paid for opening.** XP comes only if the box's quest was taken
  (source 5, four of the nine) and met. Made things lock again when used up.

A *closed* box is only a card this browser has not turned over: "Tap to
open", no rule, no XP (`app.mjs:479-482`).

**What can be a box.** Counts are entries in `packs.json` for the six
mounted packs, plus `forest.json` and `shared-cast.json` for the hub.

| Card kind | Cards | Locked today | Lock it can carry with no rules change |
| --- | --- | --- | --- |
| Place | 93 in packs; 3 hub; 8 homes | 6 (4 sealed ways, 1 guarded, 1 lane) | A route's `requires` plus `sealed` (`pack-schema.mjs:1290-1297`); a guard on the way; a ship lane's `opensWith` and `reason`. Pack crossings (15, 8 gated) and hub routes cannot carry `sealed` |
| Resident | 58 in packs; 3 hub; 8 human | 1 (Raven) | `requires` plus `sealed: { at, reason }` (`pack-schema.mjs:696-703`) |
| Item | 83 in packs; 4 hub | 2 (bread, provisions) | Only `locked: { by, consumes }`: a maker and what she uses. No general item lock exists |

Conditions a lock may use today (`CONDITION_KINDS`, `pack-schema.mjs:63`):
a thing held (`holding`, `held`, `in_hand`); a thing placed (`item_at`,
`item_near`, `grounded`); a person met, talked with or a fact known (`met`,
`talked`, `knows`); trust (`trusted`, used 0 times); a flag or a fork set by
an effect on Give, Meet, Wait, Talk or Hold; time and weather (`daylight`,
`clock`, `weather`); light and sound; a guard, who keeps a schedule and can
be fought or given what he wants (rules 100).

**What is drawn.** A locked card is on the table only where its lock was
written to show (`availableCards`, `cards.mjs:73-89`):

- *Places.* A shut way is drawn only if its route has `sealed` or a guard
  (`sealedWays`, `world/geography.mjs:216-240`), and a shut lane only if it
  has a `reason`. 16 of 23 pack routes are gated; 4 carry `sealed` and 1 is
  guarded. The other 11 gated routes, all 8 gated crossings and the hub's
  mirror are left out of the hand until they open.
- *Residents.* A resident whose `requires` does not hold is drawn only if it
  has `sealed`, and only at its `at` place (`sealedAvatar`, `cards.mjs:31`).
  30 pack residents have `requires`; 1 has `sealed`. The other 29 are left
  out until they appear.
- *Items.* A made thing is drawn locked at its home while used up and its
  maker is active (`lockedAt`, `pack-items.mjs:91`). No other item can be
  drawn locked.

So today most shut things are hidden, not shown locked.

**Locking again.** Three things do it today. A made thing locks when used
up (`pack-items.mjs:82`). A guard bars his way again when he is back at his
post. A route marked `live: true` is open only while its condition holds;
any other gated route latches: once open it stays open for everyone
(`pack-registry.mjs:432-446`). 2 of the 16 gated routes are `live` (the
Theban gate and the Oak's trail). RatiRadio's doors latch, by its contract.

**The hub.** A new world opens with Vale in the Mirror attic holding the
lit Lamp (`forest.json` `opening`). The mirror to the Black pond opens when
the lamp is there and not lit (`reflectionRoutes`); the way back needs it
lit at the pond; the attic as home needs lamp and oil (`homeGates`). Human
homes open with their belonging near (`human-cast.mjs:51`). None of these
is drawn as a locked box.

**The world generator.** `/make` asks the model for text only: a place, an
avatar and an item, each `kind`, `name`, `text`
(`card_authoring_seed.rs:5-22`). Code builds the rest
(`authoring-seed-world.mjs:183-212`): a new place gets plain `exits` both
ways to the entry place, an avatar stands at the entry, an item lies there,
and the first avatar wants the first item. It emits no `routes`, `requires`,
`sealed` or `locked`, so every generated card is open. The prompt tells the
model to prefer "a different relationship or practical use over another
version of a locked door" and not to claim "opened routes"
(`card_authoring_seed.rs:17-20`).

### Level up, Sleep and home

- A player's level rises only through a level quest. With XP at `questXp`
  (3 for level 2, 15 for level 5, 44 for level 10, 636 for level 50), a long
  rest brings the quest (`want.mjs:447-452`). It has `ceil(n / 5)` drawn
  steps, then a rest step at a sanctuary (`restStep`, `want.mjs:384`).
  Dropping it costs XP (`dropCost`, `want.mjs:473`). Halfway there, a long
  rest brings a glimpse (`glimpse.mjs`).
- Residents level on XP alone (`want.mjs:832-837`), except `levelAtHome`
  residents, who level on arriving home (`want.mjs:90`). RATi is the only one.
- Sleep is `wait` with `sleep: true`, offered after a Wait, never aboard, in
  a standoff or beside a guttering lamp (`world.mjs:1203-1236`). A long rest
  is a Sleep of 12 turns or more (`LONG_SLEEP_TURNS`, `world.mjs:1795`) in
  the sanctuary where it began (`wakeUp`, `world.mjs:1799`).
- There are five sanctuaries: Mirror attic (`forest.json:36`), The Hillside
  Sanctuary, Halfway Tea Garden, Cosy Cottage and the Listening Room.
- Home is `homeOf` (`world.mjs:633`). A human avatar's home comes from
  `shared-cast.json`; Vale's is set to the Empty station there. The seven
  other homes are ordinary places behind a door that needs the avatar's
  belonging, so a long rest there does nothing today. 36 of 58 pack
  residents set `home`.
- Trust is 0–3 per pair. Its one source is giving someone the item they want
  (`trustGiver`, `world.mjs:1737`). It eases trades and gifts
  (`motives.mjs:95,108`), invitations and shared meals (`world.mjs:1192`,
  `:590`), and stepping in for a struck friend (`world.mjs:2766`). No pack
  gate reads it: `trusted` (`pack-rules.mjs:138`) is used 0 times.
- 25 routes and crossings carry `requires` (one is retired): flags 15, an
  item somewhere or held 15, a `choice` 6.

### What the reference content leans on

- **Greek burial.** Already wants and facts. Antigone and the shade hold a
  starter want to have the oil, cloth and shovel laid in the Hollow; three
  `on: "give"` choices anoint, shroud and bury. Three locked boxes: the
  Hollow, the guarded battlefield, the bread.
- **RatiRadio.** Six `on: "meet"` choices set flags. Three doors and Raven
  are its four locked boxes. RATi levels at home.
- **Lonely Forest opening.** The first quest waits for the pond
  (`forest.json:2`). "Stay for tea" is an `on: "talk"` choice. RATi hides a
  button and its finder gets a story quest (source 6). No locked box.
- **Find home.** Homecoming is source 7. The world slot is #2282, not built.

## The design

### One want per card

A want is one record: a thing to hold, a place to be, or a person to see,
with at most one of today's shapes (give it to someone, bring it somewhere,
eat it, lay things in a place). Every card holds at most one. `actor.under`,
the limits, the `focus` play and the `story` and `quest` marks go.

**Residents.** A resident starts with its pack `want` when it has one.
Every other want is drawn by the rules, seeded by avatar and turn as today,
from committed facts only: a thing it values, held nearby or lying loose; a
thing an open grievance names; a thing, place or person it has seen or been
told of (#1506); a person it trusts who is elsewhere; somewhere it has not
been; home, after a few wants met away. In Talk it says its want in one
first-person line, with the reason when there is one, as `wantFact` does
now (`want-talk.mjs:61`). It sets a want aside after three refusals.

**A lock is a want.** "A locked box tells you its want." What shuts a card
is what that card wants, and meeting it opens the card: a shut way wants
the beanie carried to it, the bread wants Dione to have water and wheat,
Raven wants three keepsakes laid in the Listening Room. Locks and wants
are one idea, so the separate `reason` and `quest` on a seal, the disabled
"Locked" button and any second XP rule for boxes go.

**XP is wants met.** Whoever's play meets a card's want gains one XP: a box
opened, or a person helped, whose trust in the helper also rises by one
(this widens `trustGiver`; #1871 owns what they remember). The player need
not have taken the want. A box pays each avatar once per world, so a box
that locks again does not pay again.

### Boxes first

**Almost every card arrives locked, and every locked card is visible.** A
box is a card: a place, a resident or an item. It lies on the table face
down with "Locked", never left out until it can be opened. Visible does not
mean openable yet: a box may wait on something far away or not yet in the
world, and nothing falls back (mystery over reachability). Selecting it
tells its want on the context button and descriptor, never on the card.

- *Places* lock through the way to them: a route's `requires` and `sealed`.
  The 11 hidden gated routes become visible boxes. Pack data.
- *Residents* lock with `requires` and `sealed`. The 29 conditional
  residents that show nothing today become visible boxes. Pack data.
- *Crossings and the hub's ways* (home doors, the mirror back to the attic,
  the lit arch to the Empty station) need a seal read there too: rules.
- *Items* are boxes too, as the last rules slice: a `sealed` item lies where
  it is but shut until its conditions hold.
- *Open at the start:* Vale, the Lamp he holds, and the Mirror attic, his
  home. The first box is the Black pond behind the mirror, opened by putting
  the lamp out, which is already the opening's first play.

**A maze of escape rooms.** A place is a room whose boxes interlock:
opening one supplies what another needs. Rooms join through boxes too.

- A room is a place with three to five boxes among its residents, items and
  ways on, and at least one open card to start from.
- Each lock names another card of that room or of a room already passed.
- A way on is a box like the others, so leaving a room is one of its
  puzzles, and a later room may need something left behind.
- Thebes is one today: the bread (made) feeds the guard, whose way (guard)
  leads to the shade (time), who opens the Hollow (talk), where the rites
  need three things laid (placed).

**Locking again is normal.** A pack chooses per box whether it latches open
or follows its facts (`live`, which exists for routes):

| Box | Locks again when | Today |
| --- | --- | --- |
| Made thing | it is used up | yes |
| Way with a held or placed key | the key is carried away | yes, if the route is `live` |
| Guarded way | the guard is back at his post | yes |
| Way or resident on a time | the hour passes | yes, if `live` |
| Trust lock | trust is lost to a grievance | `trusted` already reads grievances |
| Latching way (RatiRadio's doors) | never | yes |

A `live` way the player already passed may shut behind them. That is the
maze, not a fault: a fight, the guard's want or another way round remains.

**Lock kinds and the variety rule.** Many boxes must not become many copies
of key and door ([jagged edge](jagged-agi-level-design.md): "three copies
of a key-and-door puzzle").

- Seven lock kinds, each from conditions that exist: a thing held; a thing
  placed; a thing made; a person's trust; something met, heard or seen; a
  guard; a time.
- The validator: boxes shown in one place do not share a lock kind, and a
  way's lock kind differs from the lock on the way that led to it.
- A lock names things that exist in its world. It need not be reachable.
- No lock is opened by what a model says. A Talk play may open one: the
  rules commit it at the play. A fight is always a way past a guard.

**RatiRadio as the first room.** Two doors are varied (owner: "Vary 2").
The rest of [the contract](ratiradio.md) is kept: the same three objects,
nothing consumed, opened ways latch, Raven wakes when the glass, figurine
and beanie lie in the Listening Room, the Request Slip is optional.

| Door | Today | Its want | Lock kind |
| --- | --- | --- | --- |
| Dispatch Window | carry the Red Beanie to it | unchanged | a thing held |
| Listening Room | carry the Thermos to it | the Thermos set down at the Dispatch Window, on the metal plate its line already names | a thing placed |
| Broadcast Booth | carry the Raven Figurine to it | Talk with RATi while holding the figurine | something heard |

Slice 2 built this as pack data. RATi roams, so the Talk is authored once in
each station room he can stand in with the traveler. A sealed way's quest takes
only a kind and a target (`pack-schema.mjs:1304`, `gateQuest` `world.mjs:417`),
so the descriptor of the Thermos door reads "hold the Thermos" while the
button gives the full reason; a placement step needs a rules slice.

**Generated worlds.** The entry place and the first avatar stay open; every
card drawn after arrives locked and visible. Code, not the model, writes
the lock, as it writes the links today: a new place joins by a `routes`
entry with `requires` and `sealed` in place of plain `exits`; a new
resident gets `requires` and `sealed`. Each draw extends a room: its lock
names a card already in that world and its kind rotates by seed. A room
that reaches five boxes sends the next place on as a new room. The prompt
stays as it is: the model writes no locks.

**XP against today's thresholds.** Level 5 takes 15 XP, level 10 takes 44,
level 20 takes 132 (`questXp`).

| Boxes | Count | Reaches |
| --- | --- | --- |
| Locked today | 9 | level 3 |
| Every existing gate shown: 16 routes, 8 crossings, 2 lanes, 1 guard, 30 residents, 2 made things | up to 59 | level 12 |
| Almost every pack card (93 places, 58 residents, 83 items) | about 230 | level 27 |
| A generated world | 2 for the first draw, then 1 a draw | 7 draws for level 10 to 11 |

### Desire after

Desire is per box. A resident's card tells two wants, in order. Shut, the
box tells its want: what opens the way to that person. Open, the person
tells their own desire in Talk. "Finding out about desire" is the second.
A sealed resident cannot be talked with. Early play is nearly all boxes; as
they open, more of what is in front of the player is people and what they
want. ("Until they're all unlocked" is not read per world: a generated
world keeps adding boxes, so that day might never come.)

### A player's want is always taken by a tap

A player holds one want at a time. None is drawn and none is handed over.
Each source is a named button in the existing action row, on a card the
player has selected. No new UI.

| Where the player is | Selected | Button | What taking it does |
| --- | --- | --- | --- |
| Where a locked box lies | the locked box | **Take quest** | The box's want becomes the player's. No turn passes. Today's `gate` play (`world.mjs:1615`, `:3001`), for every box |
| With a resident, after Talk with them there | that resident | **Accept quest**, beside Talk | The want they said becomes the player's: give it to them, bring them there, or bring them to that person (`questFor`, `talk-quest.mjs:33`). No turn passes |
| Anywhere, with XP enough for the next level | the player's own avatar card | **Take level up quest** | The player's want becomes Sleep at home |
| A non-Vale avatar's new world | its home, a locked box | **Take quest** | Homecoming: bring the belonging home |
| `/pip` | Pip, after his Talk | **Accept quest** | Pip's lamp |

- *Talk reveals, the tap takes.* Talk says a resident's desire as dialogue.
  Accept quest makes it the player's want.
- *Accept quest* is offered after the player's first Talk with that
  resident since arriving in that place, until either leaves or that want
  changes. Coming back needs a new Talk.
- *While a want is held* these buttons stay in the row, disabled, and the
  label says why ("Finish or discard your quest first"). Nothing is
  replaced. Discard is free, except Sleep at home.
- *The quest card* sits where the quest fold sits today, one card.

What reaches a player without a tap today, and what becomes of it:

| Today | Becomes |
| --- | --- |
| Source 2, drawn when the stack is empty (`want.mjs:628`), and after Discard (`want.mjs:492`) | Removed for players |
| Source 3, level quest on waking | Take level up quest |
| Source 4, Talk pushes a quest | Accept quest |
| Source 5, `gate`, on 4 boxes | Take quest, on every box |
| Source 6, `hide_item` pushes "find your button" | Removed. RATi wants the button; Talk says so; Accept quest |
| Source 7, homecoming set at world creation | Take quest on the home's box |
| Source 8, Seek in the menu | Removed with the `seek` play |
| Source 9, Pip's landing | Accept quest on Pip |
| Vale's authored `want` for the Lamp (`forest.json:75`) | Removed: a player has no authored want |

Also removed: the `choose` play (the 9 buttons become `on: "talk"` on the
same subject; the 179 triggered choices stay as authored effects), the 5
archived Greek choices, the stack and `focus`.

### Level Up is Sleep at home

- Each avatar has its home. Vale's is the Mirror attic (a data change: his
  `shared-cast.json` home names the Empty station today). The others keep
  theirs: Paper theatre, Sunken belfry, Wild glasshouse, Wind hill,
  Between-hours carriage, Games pavilion, Sail loft.
- Home rests its own avatar as a sanctuary does. A home's door is a visible
  locked box whose want is its avatar's belonging.
- With XP at the next level's threshold (today's `questXp` numbers), the
  player's own avatar card offers **Take level up quest**. Taking it gives
  **Sleep at home**: the place want with the rest step that exists today,
  aimed at `homeOf`. This replaces the level quest arriving on waking
  (`want.mjs:312`, `:427`), its drawn steps and its dream.
- It is met by a long rest at home: a Sleep of 12 turns or more that began
  there. The level rises by one on waking. One level per sleep.
- Discarding it costs XP, as dropping a level quest does now (`dropCost`,
  `want.mjs:473`). That takes the player back under the threshold, which is
  what stops the button returning at once.
- Long-rest dreams stay. The halfway glimpse is drawn as today: by seed,
  one person, item, place or verb the avatar already knows (`glimpse.mjs:46`),
  given to the model as one fact (`narrative.mjs:414-418`). It no longer
  fixes anything, and its fact line drops "of the quest for level N".
- In the existing places only: away from home the quest card reads Go to;
  at home the context button offers Wait, then Sleep; where Sleep cannot be
  offered the button says why. Woken early, the want stays.
- Residents keep today's rule. `levelAtHome` stays an opt-in.

### Story arcs

An arc is a situation spread over the boxes of one or two rooms, told by
what the opened residents want.

A resident may carry a short `wants` list. Each entry has `when` (the
existing conditions) and a `want`. The list is **unordered**: any entry
whose `when` holds may surface, the seeded draw picks among them, and
authored order only breaks ties. Nothing is saved: it is read from the
world each turn, like `homeWhen`.

- *Burial.* Antigone at the gate, once the guard holds the Writ, may say
  she wants to be at the Hollow, or that she wants the oil, the cloth and
  the shovel laid there. Bringing her, or bringing the things, each meets a
  want of hers. After the burial her wants are drawn. The three give
  effects stay as they are.
- *RatiRadio.* RATi's wants name the keepsakes still to come home, then
  Raven.

Three limits, checked by the pack validator:

1. At most three staged wants per resident (the size of the funeral).
2. An arc never puts a want in the player's hand. The player learns it by
   Talk once that resident's box is open, and takes it by a tap.
3. Every `when` reads a fact that a fixed verb can make true.

Not chosen: stages of a bond (trust tiers pick the want; trust is per
traveler but a want is one per resident), and chapters of the world (facts
set at world levels; sleeping, not doing, would open the story).

**Deleuze and Jodorowsky.** An interpretation for the owner to correct. The
repo's one statement is in
[dynamic characters](dynamic-characters.md#deleuze-guattari-and-barthes-as-design-prompts):
"connections among different kinds of things and many possible points of
entry", so that "Meeting any of them can lead into the situation". It has no
text on Jodorowsky. This design fits in that no plot stands outside the
world (wants are read fresh from present facts), any box of a situation
leads in, a want is met by a concrete act and never by speech, and Talk
reads what a person wants now, as a tarot reading describes the present.
It falls short in that a cap of three keeps a situation small. Per the
Pact, a symbolic act is a fictional world action, never treatment or
diagnosis.

### The three ethos questions

1. **What can the player do differently?** Open what is shut in front of
   them, by carrying, placing, making, waiting, earning trust or fighting.
   Then learn what the person behind it wants and choose whether to help.
2. **What will the world remember?** Who opened which box; who met whose
   want and the trust that came of it; the public facts a situation turned
   on (a burial, an opened door); a level earned at home.
3. **Why is it more interesting?** Today the hand fills with quests from
   nine sources and the player works the list. With boxes first, the world
   is shut things in plain sight that say what they want, and people are
   met by opening the way to them. Desire comes as a discovery, not a to-do.

## Migration slices

In order. Slices 5–10 are rules changes and mint **one** rules version
together. Alpha saves may be dropped, and the shared worlds on Lonely
Forest may be reset at that bump (owner: "we can reset"). Released journals
replay on their frozen bundles. Slices that delete `want.mjs` code will
pass the 400-line budget and need `Large-Change`.

| # | Slice | Kind | Saves | Acceptance |
| --- | --- | --- | --- | --- |
| 1 | Nine buttons become `on: "talk"`; drop five archived choices | pack data | keep | No pack choice lacks `on`; Talk with Teucer commits `greek-ajax-hear-plea`; no `choose` play is offered |
| 2 | RatiRadio as one room: three lock kinds, every box visible | pack data | keep | One human new to it plays kitchen to booth and back, names the most memorable moment and the part to cut (#2577) |
| 3 | Vale's home is the attic | data | keep | Vale's home reads Mirror attic in the catalog and the avatar menu |
| 4 | Show every lock: `sealed` on the 11 hidden gated routes and the 29 conditional residents; latch or `live` per box | pack data | keep | Each lies in the hand as a locked box and tells its want when selected |
| 5 | One want: remove the stack and `focus`; no drawn or authored want for players; remove sources 6 and 8 | rules | reset | After 200 turns no avatar has `under`; a player who has taken nothing has no quest card |
| 6 | A lock is a want; meeting any want pays one XP, once per box per avatar; helper trust | rules | reset | Vale brings the guard the Writ: the battlefield opens, +1 XP; shut and reopened, +0. Vale gives the keeper the Bell: +1 XP, trust +1 |
| 7 | Tap-only: Take quest on every box, Accept quest after Talk, the buttons disabled while a want is held | rules | reset | Talk with the keeper adds nothing; Accept quest then gives "give the Bell"; a second box's Take quest is disabled with its reason |
| 8 | Level Up: Take level up quest on the own card, Sleep at home, homes rest their owners; remove the level quest | rules | reset | At threshold Vale's card offers it; a 12-turn Sleep in the attic raises the level; discarding costs XP and the button is gone |
| 9 | Seals on crossings and the hub's ways (home doors, the mirror back to the attic, the lit arch to the Empty station); the Black pond as the first box; homecoming as Take quest; the lock-kind validator | rules | reset | A new world shows Vale, the Lamp and the attic open and the Black pond locked; putting the lamp out opens it for 1 XP |
| 10 | Unordered staged `wants`; `sealed` items; remove `choose` from offered plays | rules | reset | No arc field in the save; the same facts and seed give the same want after reload; a sealed item lies locked and opens on its facts |
| 11 | Packs as rooms: lock the hub and packs by kind; burial and RatiRadio as staged wants | pack data | keep | The validator passes; carrying a `live` way's key off shuts it; Antigone says either staged want at the gate |
| 12 | Generated cards arrive locked and visible | authoring code | keep | A second place drawn in `/make` is a locked box whose want names a card already in that world |
| 13 | One quest card; the three buttons; remove the fan and Focus | client | keep | `npm run check:ui` passes with no new entry; phone and desktop |

Later: resident draws from grievances, knowledge and trust (#1506, #1871);
then the README quest section is rewritten.

## Check before building

1. That the action row can show Accept quest beside Talk with no new entry
   in `ui-inventory.json`. The row holds several named buttons today
   (`ACTIONS.md`); this was not tried.
2. That the player's own avatar card offers only Wait outside a standoff.
   This is from `ACTIONS.md`, not traced in `legalActions`.
3. Whether a pack-data-only slice needs a rules mint. `packs.json` is
   imported by `pack-registry.mjs`, so it may be part of the shared bundle.
4. Whether an `on: "meet"` effect fires when a thing is put down, or only
   on arrival. The Thermos door may need a different existing trigger.
5. Whether `authoring-seed-world.mjs` is in the shared bundle.
6. That a guard bars his way again on returning to his post. This is from
   comments and [items and crafting](items-and-crafting.md), not a trace.
7. That every lock's XP can be credited to one player's play, for flags
   set on arrival and for a guard who leaves on his own schedule.
8. Client behaviour of the quest fan, Focus and Claim was read from the
   README, not from `quest-card.mjs` or `app.mjs`.
