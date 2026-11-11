# Companions and quests

Status: design draft for owner mark-up, 2026-11-11. Nothing is built. The
owner decisions below are settled; everything marked PROPOSED is a
suggestion, not a decision. Companion to [wants and arcs](wants-and-arcs.md),
under [#2605](https://github.com/cenetex/cosyworld/issues/2605). Patroclus is
[#2620](https://github.com/cenetex/cosyworld/issues/2620).

This page does not reopen anything in wants and arcs. It adds three things
that page leaves open: a companion who stays with you, a quest as one idea
that avatars, places and items all hold, and items and gates that matter more
than once. It follows the [ethos](../cosyworld-ethos.md): the world does not
lie, a door opens for a reason, and a kindness leaves a trace.

Facts below were read from the code on `rules/133-boxes` at commit
`cf9b895fb`, by reading and by short scripts on a throwaway copy. Terms:

- **Resident**: an avatar the rules run when no player steers it.
- **Companion**: a resident who is with a traveler. There is no companion
  class; it is a state any resident can be in.
- **Trust**: 0 to 3 per pair of avatars.
- **Box**: a card the rules keep shut, drawn face down with "Locked".
- **Live gate**: a way that is open only while its condition holds, and shuts
  again when it stops holding. A latched gate stays open once opened.

## Why

The owner asked for companions. The code has none. The numbers below are why
the design needs a saved fact and not a tweak.

- **Accompany is one joint move, not a state.** The player plays Invite on a
  resident and a destination; the resident answers once; on yes both avatars
  move in the same play. Nothing records that the resident is with anyone, so
  on the next round the resident's own planner walks it off. The README says
  this on purpose.
- **It lasts the trip plus at most one turn, one place per invitation.**
  Whiskerwind went home on the first Wait after arriving; the baker left one
  turn after each hop; aboard the Charybdis three residents stepped ashore the
  round after docking, before the traveler. Ten paths pull a resident away.
- **42 of 68 residents can be asked; 26 cannot.** 18 are `travels: false` (13
  Hoppy Cat, which is paused, plus Badger, the Oak, the Skull, the Swede and
  Polynices' Shade), 4 are `journey` residents limited to their next authored
  stop, 2 have range 0 (Antigone, the Gate guard), 1 has no open way yet (the
  Quay host) and 1 is inactive (BoardyAI). Only the Oak and Badger are
  stay-puts by intent; the other 24 are accidents of pack data. Of the 42,
  only 13 are present in a fresh single-player world, and a sleeper (a third
  of every day) cannot be invited.
- **About 82% of what residents ask is an escort.** Over ten simulated days
  there were 56 distinct (resident, want) pairs: 33 a place and 13 a person,
  so the quest reads "bring them to P" or "to Q". Only about 11% were plain
  item errands. Bring x to y is the minority of resident quests and the
  majority of box quests (13 of 25 locked cards).
- **A quarter of those escorts are impossible.** 12 of 48 place and person
  wants came from residents who cannot be invited or moved. For the Oak,
  whose want is Pip, the card says to bring the Oak to Pip, which is
  backwards; Pip walking over meets it with no player at all.
- **Trust only rises.** Its sources are giving a resident the item they want
  and authored meetings. No code lowers it.
- **Residents level at once, except RATi**, who walks home (`levelAtHome`).
  Players level only through the quest Sleep at home.
- **2 of 23 pack routes can close again.** Every other gate that is not a ship
  lane or a crossing is a flag, and flags never clear. RatiRadio latches.
- **17 of 95 items pass a simple reuse test** (a clear name and at least two
  recurring uses). Nine have no reader at all; 26 can never matter twice.

## Owner decisions, 2026-11-11

Quoted as given. These bind this document.

1. Quests on everything: "the design is that items and locations should ALSO
   have quests and level up via them or so on."
2. Accompany and quests: "most quests are bring x to y but many residents
   don't 'accompany' or will immediately abandon their travelling
   companion... I suspect 'accompany' should hold while the avatar has a
   quest to meet someone that they have 'shared' with the player."
3. The resident's loop: "presumably they should ONLY pull home when they
   need level up, then roam around on their 'daily schedule' until they get a
   new quest etc following the heroes journey".
4. Sleep: "they try to go to a sanctuary / inn. For now I propose we let them
   only sleep when they are home for their level ups. Otherwise they can walk
   around at night in general?"
5. Sticky accompany: "once patroclus is unlocked he becomes a normal resident
   at trust 3 with 'accompany' but ... 'accompany' should be sticky; eg the
   avatar follows you until trust breaks down or a sleep. For the player they
   should feel like 'Oh! A companion system! I wonder if there are any other
   companions' but then later they find out anyone can become a companion".
6. Earlier the same week: "almost all residents should roam and have
   accompany threaten etc - even the ones who can't move like oak; he and
   badger should probably be the only two who are in one place... they should
   have their 'home' location that they go to but be able to go out on
   quests".
7. Patroclus starts at trust 3. "Patroclus card unlocks on the Charybdis when
   you are docked at piraeus with the supplies aboard." Polynices must also
   be buried.
8. Quest cards: an offered quest is a closed box first ("A closed box" /
   open), then "Accept quest" (one label everywhere). A held quest's one
   button is always "Discard". "Quests should act a lot more like items."
   And a musing, not a decision: "perhaps quests are just tradeable".
9. Items and gates: "our goal should be that every item is re-usable... I
   intend to use the burial set of items twice, the theban travel provisions
   are another good example". "Gates should open and close based on item and
   avatar presence not stay permanently open. the road to piraeus and the
   gate are good examples". "once the game 'opens' eg RATiRadio it feels
   boring."
10. Later the same day, on what an avatar, item or location is: "Avatars
    items and locations ARE ALL PERSONS. There is no distinction besides the
    category. Items and Locations can speak, dream, remember and level up".
11. Later the same day, on where text lives: "authored text should only be in
    location, item, and avatar descriptions. eg if i want to learn something
    either an avatar tells me or an item describes it etc".
12. Later the same day, on lock and quest text: it shows only the want, built
    from names and rule verbs, and never names or pictures what the traveler
    has not discovered. In the owner's words: "'find something you haven't
    discovered yet' is perfectly valid as an objective".

13. On whether places and items hold quests and level up: "Yes. places and
    items should get quests and level up why not? Then avatars can get quests
    like 'bring the chalice to the fountain' because the chalice wants it or
    wahtever".

14. On how an item's or place's want is made: "render them from data and let
    them be drawn over time".

Decisions 10 to 14 were made after the sections below were first written.
Where a PROPOSED item contradicts them it is marked SUPERSEDED or rejected in place and
kept for the record.

Standing rules that bind everything here: one want per avatar; the world is
deterministic except player choices; AI characters act only by talking; no
new UI (the dialogue bar, one context button, cards and stacks; one
selection gives one button; a blocked play's reason is the button label); no
interim fallbacks; mystery over reachability; combat is a lever; engine
changes are batched and expensive while pack data is cheap; rarity is levels.

Two points where the owner's words are read, and the owner may correct them:

- Decision 6 says the Oak roams and also says the Oak and Badger are the two
  who stay in one place. This page reads it as: every resident has a home and
  goes out on quests, except the Oak and Badger, who stay in their place and
  are visited. The last clause ("be able to go out on quests") may apply to
  all. See the open question on the Shade and the Gate guard.
- Decision 8 says "Accept quest" is one label everywhere. Wants and arcs
  names the box and home button "Take quest" and the level-up button "Take
  level up quest". The owner settled on 2026-11-11 that the level-up offer
  is "Accept quest" too, told apart by its caption in the bar ("Accept quest:
  Sleep at home"; PR #2651). This page uses "Accept quest" for all offers.

## One definition of a quest

**A quest is a want held by something, met by a world fact, and paid as XP to
whoever's play met it.** The record exists already: a kind, a target and
sometimes a step. What changes is who may hold one.

| Holder | What it wants | How it levels | How the player learns and takes it |
| --- | --- | --- | --- |
| Avatar | an item, a place, a person, a laying-out, or home | XP when its want is met; level up by Sleep at home | Talk tells it; the quest card is a closed box, then Accept quest |
| Place | one want at a time, like an avatar's | XP when its want is met; the same level thresholds | the place describes it, or an avatar tells you; closed box, then Accept quest |
| Item | one want at a time, like an avatar's | the same | the same |

Places and items hold a want and earn XP and levels exactly as avatars do
(owner decision 13): one want at a time, XP when the want is met, level by the
same thresholds. A box was already a quest holder (`boxWant` states what opens
it); this makes that the general case. Per decision 14, an item's or place's want is not authored prose. It is a
structured want, rendered by the same single wording path as every other want
(names screened by what the traveler has discovered, plus the fixed rule
verbs), and items and places draw new wants over time as residents do rather
than keeping one authored want. Descriptions stay for what the thing is. The
derived-level proposal (a level
counted from boxes opened) was rejected on 2026-11-11 and is dropped.

The consequence the owner names: a quest an avatar holds can be an item's or a
place's want. "Bring the chalice to the fountain" is a quest because the
chalice wants it. It is offered through the same closed box, Accept quest and
Discard flow, and learned the same way: the item or place describes what it
wants, or an avatar tells you. The mechanics this leaves open are open
questions 16 to 19.

**One card flow, for every holder.**

1. An offered quest first lies on the table as a closed box, labelled "A
   closed box", and the one button is open. Opening it shows the quest.
2. The one button then reads **Accept quest**. The label is the same for a
   resident's quest, a locked box's, a home door's and a place's.
3. Once accepted, the held quest's one button is **Discard**. Discarding an
   ordinary quest is free. Discarding Sleep at home costs XP, as in wants and
   arcs.

"Quests should act a lot more like items" is read as: a quest is a card you
pick up, hold one of, and put down, with no list and no second control.
Tradeable quests stay a musing; see open question 9.

## The resident's loop

Owner decision 3 gives the shape. A resident roams on its drawn wants, meets
one, earns XP, and only when a level is due does the pull home appear. It
sleeps there, wakes a level higher, and roams again. That is the player's
loop too, which is the point of the heroes-journey wording. The owner's
[hearth factions](hearth-factions.md) vision, which has residents pursue
their wants through the same plays players use, is the direction beyond it.

**What is removed.** Four pulls that bring a resident home when no level is
due: the idle drift when it has nothing to pursue; the walk home when away
and idle; the dawn and dusk step home; and the walk home before bedtime. The
range leash (`displaced`) stays, so a resident still cannot be carried
beyond its range except as a companion. Also removed is nightly sleep: every
`sleep` entry in `world-life.json` becomes `null`, which the validator
accepts. Nothing in the rules makes a night-only fact depend on residents
sleeping; the Shade appears by the clock, not by sleep. What changes is that
the label "X is asleep" stops appearing at night and nothing replaces it.
About 55 test files mention sleep and their assertions change in the same
batch.

**What replaces the daily schedule for now.** Drawn wants. They already make
residents roam: 82% are place or person wants. No schedule data exists today
(`world-life.json` holds only range, sails, sleep and guards). PROPOSED:
build none for now. Authored hours can come later as `schedule` data, one
list of (hour, place) per resident, if roaming on wants alone feels random.

**Leveling.** Wants and arcs says residents keep today's instant level. This
page replaces that line, on owner decision 3. When a resident's XP reaches
the next level its want becomes Sleep at home. It walks home, sleeps a long
rest (12 turns or more), and levels on waking. This generalises `levelAtHome`
from RATi to every resident that has a home, and drops the instant level.
The sleeping art already exists for Antigone, the baker, Pip and the keeper.
A resident who is someone's companion when the level falls due does not go
home; see Companions.

**Sanctuaries and inns, later.** Decision 4 points at residents seeking a
sanctuary or inn to sleep. For now they sleep only at home to level, and
otherwise walk at night. A later batch could let a tired resident choose a
sanctuary on the road. The five sanctuaries exist; inns do not.

**The Oak and Badger** stay in one place. They have range 0 and are already
home, so they level the moment XP allows. They offer give, lay and "someone
comes to me" quests, and never escort. Their card answers Invite with the
reason as the button label, for example "The Oak cannot leave its tree"
(*SUPERSEDED in part by decision 12:* that wording is an example only; the
label is built from names and rule verbs, not hand-written). The
quest wording for a person-want asked by an immovable resident is fixed: the
card says to bring the other person to the Oak, not the Oak to them.

## Companions

### Sticky accompany

One new saved fact: `actor.companion = "<resident id>"` on the traveler, absent
when none. Nothing is saved on the resident; "R is somebody's companion" is
read by asking whether any actor names R. Invite and its answer rule do not
change (yes at trust 2 or more, or when the trip serves the resident's own
want). A yes now sets the fact. While R is someone's companion:

- **Follow.** When the traveler moves (a step, boarding, disembarking,
  setting a course, a crossing), R travels in the same party an accepted
  Invite uses today, so joint arrival staging already exists. No Invite per
  hop.
- **Hold.** R skips the idle drift, its own walk toward its want, the dawn
  and dusk step, the range leash, roaming, and stepping ashore alone. Each is
  a one or two line guard at a known call site.
- **Catch up.** If R is not in the traveler's room (a gate it cannot pass, a
  full ship, a fight that knocked it back), it walks toward the traveler each
  round with the planner's existing step-toward. Nothing teleports and the
  traveler's move is never blocked on its account.
- **No stranding.** Follow is attempted only along ways R could also walk back
  (the return-route rule). In the run, Whiskerwind invited into the Mirror
  attic stayed there; she appears to have no way home from it. Such a move
  leaves her behind, and she catches up once a way exists.
- **Its own want.** R keeps its one want and may meet it on the way, since
  meeting is read from facts. A met want pays R one XP and R draws the next;
  neither ends the bond.

**Exactly two things end it automatically.**

1. **Trust breaks**: a grievance against the traveler, or trust below 2.
2. **A sleep**: the traveler's waking from a long rest (12 turns or more). A
   one-turn Sleep that wakes at once dismisses no one (open question 2).

Nothing else ends it: not roaming, a drawn want, docking, dawn or a pack
crossing. Whether a free "part ways" play also exists is open question 1.

**No companion class.** Anyone at trust 2 can be asked; the first companion,
Patroclus, simply arrives at trust 3. He unlocks as a locked card on the
Charybdis when it is docked at Piraeus with the provisions aboard and
Polynices buried, and the authored meeting at that unlock sets trust 3
(PR #2647).

### Who can accompany

All 42 can be asked once the bond holds. A data edit adds four: the Swede and
the Skull (drop `travels: false`), Antigone (range 1 or more; her home flips
to the Hollow after the burial) and the Household witness (drop
`travels: false`; a companion may take any route while the journey step stays
authored). The Oak and Badger stay the two stay-puts and answer Invite with
the reason as the button label. The Shade and the Gate guard are open
question 7. Hoppy Cat is paused and unchanged. The Quay host and BoardyAI
gain the play when their conditions hold. Below trust 2 Invite stays offered
and the resident refuses in a line, spending the turn, as Give and Trade do.
That teaches the threshold.

### What the player sees, with existing UI only

The companion's card is in the room on every arrival and on the stage with
the player's avatar. Invite reads "Travel" for the companion; a variant is a
label on an existing card. A second Accompany while one is held is disabled,
with the reason as its label ("Patroclus is with you"; "Dione is with Rue"
when another traveler has her). A "with you" badge would be a new element, so
there is none without the owner. Following reads as joint arrival.

### Shared worlds

The fact lives on the traveler, so the journal and both rule engines agree on
it. PROPOSED: one companion per traveler, one traveler per resident; a second
traveler's Invite is disabled with the reason as its label. An absent
traveler pauses the bond, which ends after a day. Following and catching up
run in sorted id order, as the resident round already does.

### Ideas adopted from the research (PROPOSED, not decided)

Four notes on tabletop and computer role-playing companions were read
(old-school D&D, newer D&D and Pathfinder, Call of Cthulhu and its cousins,
other classics). **They were written from memory and their specifics are
unverified.** They supply ideas only; this page cites no page, number or
quotation from them. Each idea is a rule in this game's terms.

1. **Loves.** Each resident has one or two loves (a home, a person, a place),
   written as sentences the resident can speak. They decide yes or no to
   Invite and name what breaks trust: a threat, or taking what they treasure.
   Residents differ without classes.
2. **Joining is the resident's own want.** A resident joins when the outing
   serves its want; trust decides only whether it says yes to you. The answer
   rule has this as its second reason; make it the main one.
3. **A companion is a key, not a buff.** Who is present changes which plays
   exist. At most one such act per journey, shown as no number: *vouch* (a
   stranger treats you as one trust higher, capped at 2); *hold a live gate by
   standing there* (see Items and gates); *a third resident reacts to who you
   arrive with* (a friend relaxes, a rival refuses, through a committed fact
   in Talk context); *knowledge* (one true fact about the place or someone in
   it, once).
4. **The sleep is a staged parting.** The companion goes to its own home. The
   world records one remembered moment from the outing, in its voice, and the
   next meeting on its round opens with it. Trust is unchanged by the sleep.
5. **A named tie to another resident.** One ally, rival or missed person, as a
   fact. A gate can open because of who is present; a rival makes it harder.
6. **Discovery in three beats.** Patroclus, framed by the ship and the port.
   Then a minor resident on a round says in their own words they would come
   if the road went their way, and the Travel label appears on their card with
   no announcement. Then a resident Patroclus knows says he can vouch for
   them. No count, no list.

**Rejected, and why.** *Approval meters*: no numbers beyond level and tier, and
a meter makes trust a chore. *Gift farming*: items are unique and few, and a
gift counts only when it fits the want. *Trust drifting down from neglect*: a
hidden timer; trust falls only for an act the player can see. *Wages and
shares*: they turn residents into hirelings. *Disposable helpers and companion
death*: residents are persistent and the world is cosy; a hurt companion
recovers at home. *Dice*: the world is deterministic except player choices.
*Party benches*: a bench makes a player neglect companions and needs a layout
the cards do not have.

## Shared quests

A shared quest is a vow both hold. It is a reason to accompany and a reason
to keep going after a sleep, not the only thing that holds a companion.

- **Accepting** a resident's escort or meet quest ("bring Patroclus to the
  Hollow") makes that resident the traveler's companion at once if they are
  not already. The resident offered it, so consent is given.
- **Pinned.** While the quest is held, a sleep does not end the bond. Trust
  breaking still does. The quest and the bond are the same want, so the
  resident spends no second slot.
- **Met.** One event: the traveler's play meets the resident's want. The
  traveler earns one XP and trust rises by one, as wants and arcs says; the
  resident earns its own XP for the want met. One payout, not two quests.
- **Discard.** The bond is unpinned and only the two automatic endings apply.
  The resident keeps its own want and is still the companion until one of
  them happens. The world remembers a refused or dropped vow only through
  facts already kept (#1871 owns what residents remember of help).
- **Multiplayer.** A resident has at most one binder. Two travelers may each
  have a different companion. A second traveler's Accept on the same resident
  is disabled, with the reason as its label.

An escort is offered only by residents who can travel. The Oak and Badger
offer other kinds.

## Quest shapes beyond bring x to y

Most shapes below already exist in the world. Each needs mostly the companion
and a few lines of data.

| Shape | Example from the existing world | Needs |
| --- | --- | --- |
| Escort | Patroclus to the Hollow; Whiskerwind to the Oak, a place she wants to see; Dione the baker to Antigone, who is a person she wants to talk with | the companion |
| Meet | bring Dione and Antigone together; "bring Pip to the Oak" for an immovable asker | direction wording fix |
| Keep a live gate open | Patroclus walks the Piraeus road while the party holds the Truce there | the companion plus live roads |
| Return home to level | RATi's XP outruns his level: as a companion he asks to be taken home; the traveler accepts "Bring RATi home"; he sleeps 12 turns and wakes a level higher | residents level at home |
| Witness | meet the Shade at the Hollow at night | pack data |
| Rite with a kit | the burial kit at Ajax's grave: anoint, shroud, bury | pack data (exists) |
| Guard | hold the gate until Dione is through | a new `guard` verb, later |

The first four are the ones this page unlocks. A companion at a level-up asks
to go home and offers the escort-home quest; at home it sleeps, levels and
wakes an ordinary resident. If the traveler never goes there, it keeps the
XP and waits.

## Items and gates

**Five item roles, one reuse rule each** (PROPOSED, from the item census):

| Role | What it is | Reuse rule |
| --- | --- | --- |
| Tool | held or placed, never consumed | read by at least three live conditions in two places, or by one plus a verb and a running cost |
| Supply | eaten, made or spent; goes home when used | at least two different recurring demands; because it resets, the next demand can be met by a trip |
| Kit | a named set of three or four for one rite | the rite appears in at least two places; after each the kit goes home |
| Keepsake | one resident's own belonging | once given, it stays and becomes a standing condition (a place live only while it lies there) |
| Cosmetic | a one-way keepsake that becomes a permanent upgrade | exempt; counted separately |

An item with no reader is not allowed. A document carried once to one person
becomes a fact told in Talk, which the Ajax arc already uses. Two items that
are one idea under two names merge (the cloth, shovel and oil). On the census
this would take 95 items to about 68. Hoppy Cat is paused and unchanged.

**Live gates.** A gate is a sentence: this way is open while THING is WHERE,
or WHO is WHERE. Most live gates need only pack data: `live: true` on a route
(the Theban gate and the Oak's trail are the only two today), `travelerRequires`
for "whoever carries X", `stayUntil` and `appearsWhen` for presence. Two
examples:

- **The road to Piraeus** (and the Eleusis road): mark the routes `live`. The
  Truce starts in the Agora; carrying it to Dione shuts the road, and the
  locked box reappears with its reason (*SUPERSEDED in part by decision 12:*
shown as the want only, built from names and verbs, not a hand-written reason
line). The road place keeps both ends as
  plain exits, so nobody on it is stranded.
- **RatiRadio's three doors** keep their three different lock kinds but
  become live: the beanie held, the thermos standing on the plate, the
  figurine held with RATi trusting you. The Booth shutting again is a trade
  with the ethos line that RatiRadio's return restores a relationship. See
  open question 13.

Opening a box still pays one XP once per avatar per box, so a gate that
shuts again cannot be farmed.

**Two conditions are missing**, and are the one real gap. No condition says
"resident X stands at place P" (`actor_at` names only the traveler), and none
says "this item is switched on". PROPOSED: `actor_present {actor, place}` and
`item_on`, about 20 lines in the rules and schema with a test and the
`engine` label, batched with the next mint.

**How companions and live gates meet.** A gate can be held open by who stands
there. A resident whose place a gate guards can open it by standing there (for
example, a guard post held open by the person who keeps it); the Booth opens only while RATi sits at his desk awake. A companion
standing in the room keeps a gate live while the traveler goes through
another. Without `actor_present` this works only for a resident who holds an
item the gate reads.

**Reuse in the existing world.** The burial kit (cloth, oil, shovel) is used
at Polynices' Hollow, then goes home (cloth to Eleusis, oil to Colonus, shovel
to the gate), so reaching Ajax's grave means collecting it again. The Travel
Provisions are made from bread, figs and a wine skin, keep the ship's lane to
Piraeus open while aboard, and Myrto wants them; whether sailing spends them is open question 11.

## Build order

Kinds: pack data, client, rules. "133" means it rides the open rules 133
bump if that batch is still open; "later" means a later batch.

| # | Change | Kind | Rides |
| --- | --- | --- | --- |
| 1 | `sleep: null` everywhere; delete the four non-level home pulls; update the sleep tests | rules and data, about 30 lines deleted | 133 |
| 2 | The sticky companion: `actor.companion`, follow, hold, catch up, return-route rule, end on grievance or trust below 2, end on long-rest wake, pin by quest. About 250 to 300 lines in a new module (`world/company.mjs`) and six call sites | rules | 133 if the batch is open, else the next mint |
| 3 | Escort offers only from residents who can travel; the backwards "meet" wording fix; reason labels for the Oak and Badger | rules and client label | with 2 |
| 4 | Free the Swede, Skull, Antigone and the Household witness | pack data | with 2 |
| 5 | Residents level by sleeping at home (generalise `levelAtHome`; drop instant leveling) | rules and data, about 60 lines | later, next mint |
| 6 | Live roads (Piraeus, Eleusis) and RatiRadio doors; the Hollow as a night door | pack data, about 60 lines and a pack revision | any time, after the owner answers 13 to 15 |
| 7 | Burial kit second use at Ajax's grave | pack data, about 120 lines | any time |
| 8 | Dead-item cull: the 9 unread items and the duplicates | pack data, about 300 lines in two pull requests | any time |
| 9 | Patroclus and the Charybdis unlock | pack data and a ship fix | the 133 bump (see wants and arcs) |
| 10 | Items and places hold a want and earn XP and levels as avatars do (decision 13) | rules | later batch, not the frozen rules 133 bump |
| 11 | `actor_present` and `item_on` | rules, engine label and note | later |
| 12 | Later: loves, ties, vouching, the once-per-journey act, schedule data, sanctuaries and inns, the `guard` verb, real trust loss | rules and data | later batches |

The rules 133 bump is frozen at what is already in flight as of 2026-11-11;
row 10 and any other new rules work go in a later batch.

Rows 1 to 4 and 9 together are the sticky companion; row 2 is the highest
value item in the batch. Engine changes are expensive and data is cheap, so
rows 6 to 8 do not wait for the bump.

## Open questions for the owner

Each has a recommendation. None is decided.

1. **Companions at once.** One (recommended; it keeps the stage at three
   avatars), or several? Is there a free "part ways" play so the player can
   swap without sleeping? Recommend yes, with no trust cost.
2. **Which sleep ends it.** Waking from a long rest (recommended), or any
   Sleep play?
3. **A gate or full ship the companion cannot pass.** Left behind, and it
   catches up (recommended), or the move is disabled with the reason as the
   button label?
4. **The companion's own want.** Kept and met along the way (recommended), or
   suspended while accompanying?
5. **Trust breaking.** Add real trust loss for acts against the resident
   (recommended, since trust never falls today), or grievances only?
6. **The companion's level-up.** Suspended and offered as an escort-home quest
   (recommended), or the companion breaks off to go home?
7. **The Shade and the Gate guard.** Fixed by role (recommended), or roaming
   like everyone else? Decision 6 read strictly says only the Oak and Badger
   stay put.
8. **Shared worlds.** One companion per traveler and one traveler per resident
   (recommended), or a shared companion? An absent traveler pauses the bond
   for a day (recommended), or holds it?
9. **Tradeable quests.** Drop (recommended; the shared vow covers the need and
   a traded card risks paying XP twice), or build?
10. **Documents.** Facts a character told you, with no card (recommended), or
    carried items?
11. **Kit and provisions.** A third burial-kit use at the Eleusis pyre? Does
    sailing spend the provisions (Myrto's want becomes "eat bread at
    Piraeus"), or do they stay aboard until eaten?
12. **Scarf kit and the Willows.** Keep all 16 buttons and scarves, or 8? Cut
    the River Map, Stew Pot and Spoon, or give each a reader? May the canoe
    outlive the Swede's departure?
13. **RatiRadio's doors.** Re-lock when the key is carried off (what decision
    9 asks; recommended), or stay latched as the ethos page's "restores a
    relationship" suggests?
14. **The Hollow's night door.** Open only at night, or stay open once earned?
15. **The two conditions.** Approve `actor_present` and `item_on` now, batched
    into the next rules bump (recommended), or hold gate work to pack data?
16. **Who is paid when an item's want is met.** The item, the traveler who
    carried it, or both? Recommend both, as with helping a resident.
17. **How an item or place levels up**, given avatars level by sleeping at
    home. PROPOSED: an item levels at its home place and a place levels where
    it is, on the same rest beat. Or a simpler rule without a rest?
18. **Does an item's level-up change anything visible** beyond its tier
    colour? Recommend not yet; colour only, as now.
19. **Rarity is levels.** An item's tier would now rise through play. Does
    rarity follow that rise (recommended, since rarity is levels), or stay at
    its authored level?

## Check before building

1. The facts were read at `rules/133-boxes` commit `cf9b895fb`, not main.
   Re-read the answer rule, resident planner and ship arrival before writing
   guards; line numbers have moved.
2. Patroclus and staged wants land in PR #2647. Check how his locked card is
   placed on the Charybdis. The wants and arcs prototype put him on the quay
   at trust 1 from a gift; decision 7 says trust 3 at the unlock meeting, so that line is superseded.
3. Fights, two-traveler shared worlds and pack-to-pack companions were read
   in code, not run. Test them before trusting the stranding rule.
4. Why Whiskerwind cannot leave the Mirror attic, and which of three causes
   (asleep, not met, a standoff) hid her Invite from the owner, were not
   traced. Asleep is a third of every day.
5. The outside game references are unverified; they came from memory.
6. The effect of removing items on smoke scripts and tests was not run.
7. That the client can show Travel and a disabled Invite with its reason on
   existing cards, with no new entry in `ui-inventory.json`, was not tried.
