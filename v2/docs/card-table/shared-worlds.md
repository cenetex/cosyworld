# Shared worlds

Open **Share** in the current game. Sign in with a passkey and choose **Share this
world**. Friends enter that saved world through its invitation. The host keeps
Vale, the current place, belongings, resident state, quests, and conversation.

The original card table remains the game screen. Black pond, Empty station,
Mirror attic, Pip, the keeper, Badger, mounted story packs, and their rules belong
to this same world. Each account claims one of eight human avatars. Each room
holds four present humans. Residents can share a room with those humans.

BoardyAI appears while two or more humans are connected. Like every avatar,
he pursues one quest at a time and draws the next from the people and places
he can reach. His position, sightings and quest survive reloads and journal
replay. Presence uses the usual reconnect grace.

The online list shows names, levels, and connection status. Players discover
each other's locations through encounters in the world.

Boardy's calling card rests at Empty station. Like Boardy, it appears only
while two or more humans are connected; local and single-human games show no
card and no parlour door. Its blue smile opens a door to **BoardyAI's Parlour**
while the card is in the station: left there, or carried there by a present
human. Take the card along for the trip. Two armchairs and a
tea table wait inside. The parlour door leads back to Empty station. Saves from
pack revision 1 move a card still resting at the pond to the station and keep
each traveller's known parlour route.

The seven new humans start in their homes with their signature items on the floor.
Picking up the item opens the path to Black pond. Putting it down closes that
path. At the pond, the item reveals the home's entrance when it rests there or
is carried by anyone standing there. Full destination cards disappear
from the hand. The server checks room space again when a play reaches its turn.

The existing Play buttons add an action to the room queue. A room holds four
pending plays, including the current play. Each person has one pending play.
Waiting plays can be withdrawn with **Cancel play**. The play's button reads
as what the avatar is doing while it is sent and playing. A refusal names the
server's reason on the action bar's status line. Nudge asks a present human for attention. People
can sit quietly while the scene runs. Presence has a 60-second reconnect grace;
the avatar claim remains saved.

A card presentation or open dialog pauses that viewer's speech clock. Closing
it resumes the same line. The live portrait follows the room's common clock;
selecting it catches up immediately. A new play by that viewer starts a fresh reading clock. Incoming scenes wait
for that viewer's current scene and then play in order. A late update can bring
several scenes together; each receives its own reading time. The same rule
applies when the reader first sees replies in an empty room. Entering a room,
selecting the live portrait, or losing an old scene from the bounded history
joins the room's latest scene.

Each accepted play advances the existing world clock. Lamp fuel, temporary
sounds, and crossing sequences keep their current turn rules for everyone.
Greek locations also read this shared turn for regional weather. A weather
period lasts twelve accepted plays across the world. Players in the same region
see the same conditions, with local effects for the coast, streets, groves,
and shelters. Each view, place card, and dialogue request uses these conditions.

## One world model

The browser and server use the authored rules in `world.mjs` and its rule modules.
`human-cast.mjs` adds the new homes through the existing pack registry.
`shared-world.mjs` exposes the save, join, view, play, and speech operations.

The server runs a checked-in bundle of those modules in QuickJS, a C interpreter.
Rust supplies JSON and handles authentication, storage, queues, and provider IO.
The interpreter has bounded memory and execution time. Each request has a
two-second deadline. A request that reaches it returns "The shared world is
taking a moment. Try again." It is never reported as a changed scene. Debug and
test builds compile the interpreter with optimization, so replay tests on a busy
host run near production speed. The interpreter's runtime exposes only the
saved game and the authored rules. A C session guard checks claims, presence,
room capacity, and the actor allowed to make a play.

This is the shared card game's authority boundary: the authored rules execute in
the server's C interpreter. The browser sends an action choice. The server derives
the result from the saved world, records it, and sends the resulting view to
players. The separate native C rules for the earlier nine-room release remain
available for reading and migrating its history.

The bundle builder is `v2/scripts/build-card-shared-engine.mjs`. Regenerate the
bundle after changing any module it imports. The check mode compares the bundle
with its sources. The Rust service embeds the bundle, so a deployed server and
its browser assets come from one release.

Every merge to `main` deploys, so main's newest bundle is live and its bytes
are fixed. A branch that changes rule modules runs `npm run v2:card:shared:next`
after it rebases on or merges `main`. The script restores main's released
bundles and version wiring, rebuilds the rules, and adds the next version only
when the bytes differ from main's. It pins the live bundle's hash in
`test/card-released-rules.test.mjs`. Run it again after each later rebase; it
gives the same result. Then rebuild the card assets and bump the release
version. Do not resolve bundle conflicts by hand.

`test/card-shared-bundle-modules.test.mjs` lists the modules the bundle may
contain. A new import into the shared rules fails it. Pack content and
presentation modules are moving out of the bundle so that content changes stop
minting rules versions; see
[the design note](../../../docs/design/pack-content-outside-the-engine.md).

The dialogue context for a committed play, and the scene the browser draws,
come from a second bundle,
`card_shared/narrator.js`, built by `npm run v2:card:narrator:build`. Its
output goes only to the story service and is never a journal input, so it is
rebuilt from current sources and never versioned. `npm run v2:card:shared:next`
and the land script rebuild it.

`card_shared/content.json` holds the pack content the shared rules read: every
JSON module the rules bundle imports, built by `npm run v2:card:content:build`.
Rules from v58 on take content as input and receive it per request, so the
bundle holds rules only and an art, pose or pack change leaves `engine-v*.js`
unchanged. A world records the SHA-256 of that content as `pack`. The server
stores each revision in `card_full_packs` before a journal row names it and
replays only from verified stored bytes. A `repack` command moves a world to
new content under the same rules. Released rules v2 to v57 carry their own
packs and never use the store.

## Event sync

Each browser keeps a sequence number and SHA-256 hash for its shared view.
The first read receives a snapshot. Later reads and command replies carry
changes from that cursor. Quiet reads carry the server clock and cursor.
New scenes enter the existing history through list changes, including when
the room reaches its 40-scene limit.

Each sync event records its sequence, previous hash, hash, and patch payload.
The browser checks the chain before presenting the new view. A missed reply
is recovered from the last checked cursor. An older cursor or a damaged chain
receives a fresh snapshot. Recovery uses reads; each submitted play keeps its
original key.

SQLite saves a separate stream for each world and account. Each stream keeps
its latest view and up to 64 events within a 512 KiB payload budget. Streams
survive a server restart. A changed avatar starts a fresh stream. Earlier
clients continue to receive full views.

The browser sends `X-CosyWorld-Sync: <stream>:<sequence>:<hash>` on world reads
and commands. `snapshot` requests a fresh view. Event hashes use SHA-256 over
UTF-8 text in this order: stream, newline, sequence, newline, previous hash,
newline, exact payload text. The payload is JSON with `set`, `remove`, and
`splice` operations. The snapshot supplies the chain's starting cursor.

## Moving an avatar

An account's avatar is in one world at a time
([#1737](https://github.com/cenetex/cosyworld/issues/1737)). A `claim` command with `"move": true`
releases that account's avatar in every other world, in the same transaction
as the new claim; a refused claim leaves the old worlds as they were. Creating
a world takes `avatar` (Vale by default) and the same `move` flag. A release
is the ordinary `release` journal action, so replay is unchanged. A claim
without `move` keeps the earlier behaviour.

## Away avatars live as residents

Since rules 80 ([passkey v2](../../../docs/design/passkey-v2.md)) all eight
avatars are in every shared world. A human steers an avatar only while
present. An avatar whose holder is away, and one nobody holds, lives there as
a resident: it is seen, keeps its things, and acts on its own wants when
someone plays in its room. There is no server tick, so in a world where
nobody is playing, nothing acts. A claim can carry the avatar's level and
experience from its last seat (`progress` on the journaled `claim`).

## One avatar per passkey per world

A person's passkey binds them to the avatar they take in a shared world
([#1825](https://github.com/cenetex/cosyworld/issues/1825)). The server keeps
the binding in `card_bindings(world, actor, user)`, written by each new claim
and by creating a world. Step away (`leave`/`release`) keeps it: the person
always
returns there as that avatar, and nobody else can claim it. A person bound in
a world can claim only their own avatar there. When all eight avatars are
bound the world is full: "This world is full." Bindings sit outside the
journal, so old journals replay unchanged. The table was back-filled from
the members at deploy; an avatar released before then was never recorded
and can be claimed once by a newcomer.

An avatar is in one world at a time (#1846). A claim of an avatar, from Send
to or a friend's link, empties that person's seats for it in every other
world in the same transaction. Each old seat goes through the journaled
`reset`, so it starts over for whoever takes it next and what the avatar held
stays there. Worlds whose rules predate `reset` release the claim and the
binding instead. The avatar's level and experience are kept in
`card_avatar_progress(user, actor)`. They are written whenever a seat empties
through Send, Release or Free, and taken by the next claim, which journals
them as `progress`.

The world's owner (`card_tables.owner`) can **Free** a held avatar from the
Table in ☰, and the holder can **Release** their own. Both are the journaled
`reset` command, guard kind 13 (`CT_SHARED_RESET`): the rules put a fresh
level-1 starter in that avatar's place (its starting place, experience, quest,
memory, learning and routes), drop everything it held where it stood, and end
any standoff it was in. The server then frees the binding and the claim, so
anyone may take that avatar. A `reset` without `avatar` releases the sender's
own. Anyone else is refused: "Only this world's owner can free an avatar."
Rules before the batch that added `reset` refuse it, so it is never journaled
for them.

Each holder has a holder name, two words such as "Amber Heron", taken from a
SHA-256 hash of their account id over two frozen 64-word lists in
`bindings.rs`. It is the same in every world for one person. The snapshot's
`holders` gives the name for each bound avatar (or `null`); account ids and
passkey data never reach other players.

## Saving, replay, and earlier worlds

Sharing validates the host's current save. It keeps the source browser save and
records its shared-world link separately. Later visits can continue the shared
world through **Worlds** or **Continue shared world**. Starting a new local game
starts a new source slot association.

Full worlds use an append-only journal and a checkpoint in the existing SQLite
store. Each action is checked against the current world as it executes. Unique
play keys make retries safe. Removing a checkpoint rebuilds the world from its
seed and recorded operations.

Shared-world writes take turns in the server process before they open a SQLite
write transaction, so concurrent views, plays and narration do not race each
other on SQLite's busy timeout and fail with "database is locked". The journal
is unchanged: one record per accepted play, in order.

Rule version 3 introduced the home-item floor start. Version 4 added Greek
story cards and saved bard visits. Versions 5–8 added collected and shared quests,
shared journeys, quieter offers, and the first-signal ship gate. Published rule
versions 2–10 retain their exact interpreter bytes for replay.

The current rules version is reported by `/meta.card_game.shared_rules_version`
and comes from the shared engine constant.

Version 9 adds a two-card quest hand and explicit Drop actions. Loading an earlier
world first replays its accepted history with the recorded interpreters, then
records an upgrade to version 9. The upgrade preserves the world turn, item
positions, ship access, conversation, quest progress, and earned receipts.

Version 10 adds the home recovery path described below. Version 11 adds
The Open Door. One traveler can accept Dione’s invitation
and open five places for everyone in that world. Greek pack revision 3 adds
eight residents and nine objects. The upgrade keeps earlier possessions,
choices, memories, and poem. Tests load real version 9 worlds from both a
checkpoint and the journal alone, then check the shared invitation.

Earlier shared invitations keep their IDs and account claims. Their first full
world load records an explicit migration seed. It maps the old rooms and items
onto the full game and keeps the old counters as migration evidence. Existing
single-player saves continue through the normal save upgrader.

## Run seeds and specials

A world has one run seed, `world.run.seed`. Each pack's `specials` pool
([design](../../../docs/design/small-worlds-alternates-specials.md)) is drawn from it once and saved as `packs[id].specials`; replay never
draws again. Rust derives a shared world's seed from its ID (the first four
bytes of SHA-256); a local New game makes one in the browser. A local save
from before run seeds starts a new game.

Migration preserves each held item, the lamp's state, and up to 80 saved
exchanges with their original text and times. An avatar carrying more than the
current limit keeps those items. That allowance shrinks as items are put down;
new pickups and gifts use the normal limit.

## First ship signal

The ship opens for every player and resident after the first completed lamp
signal. The saved signal discovery keeps both boarding shores open through
lamp changes, reloads and later voyages. Boarding always follows the ship's
current dock.

Save upgrades preserve the current voyage of a human already aboard. Shared
worlds use the authenticated avatar claims for that check. A prior NPC voyage
keeps its saved destination, and its passengers can land; boarding still needs
the completed signal. The upgrade validates the old save before granting this
human passenger allowance.

Rule version 27 makes each voyage a shared world round. The first course card
played aboard sets the ship's course for every passenger; the round ends with
the ship at sea, and the next round ends with its arrival. Each player's view
shows course cards only while the ship is docked, and Disembark only to the
people who sailed in. Loading an earlier world replays its journal with the
recorded interpreters, then upgrades the version 2 ship record to version 3.

The same version keeps sea lanes per person in route knowledge as `sea:` edges.
Each player's course cards are the lanes that player knows from the dock. A
lane told in Talk joins the listener's chart only from published speech that
contains the fact, so replay and every client agree.

## Quests in shared worlds

Each avatar holds a stack of up to three quests, as described in the
[card guide](../../card-game/README.md#a-quest-stack-per-avatar). New quests go
on top and nothing wipes one already held. Meeting one is a `want_met` event in
the shared history, so every client and the journal agree on who met what.
Dropping a quest (`drop` naming it) and pursuing one from beneath (`focus`) are
ordinary plays in the journal. A met quest's sealed card is each browser's own. A quest ends where it is met; only a level quest leads back,
to the sanctuary the avatar last stood in, where a long rest raises the level
([rest and sanctuary](rest-and-sanctuary.md#level-quest)). Human rest counts that person's own turns;
resident rest counts world rounds.

The rules version that brings this model replaces collected, shared and story
quest records. Loading an earlier world replays its journal with the recorded
interpreters, then the normal upgrade drops quest records, hands, progress and
completion receipts, and installs each avatar's starter quest. Places, items,
pack choices and their receipts, ships, conversation and route knowledge carry
over.

## Shared words

The server records the action before requesting speech. Each play receives a shared
exchange. A conversation can include the resident who was addressed. A saved
turn-based choice occasionally adds a short atmospheric location line. Its
prompt is a one-line cue plus the place's visible facts, including the weather
word. Repeated reads and retries keep
the same choice. The server records the lines
and their reading times so people in the room see the same exchange. The
Memory panel shows the beats this player witnessed, newest visit first.

Shared lines reveal letter by letter with the same voice sounds as solo play.
Each line arrives in front of the [beat stack](dialogue-beats.md) on the room's
reading clock. Tapping the card behind steps back; ● live, which shows only
while behind, counts the newer beats and returns. The voice setting and
reduced-motion setting apply to shared play. A thinking animation marks speech
preparation. The hand, avatars, and held props use the same presented world
while speech is pending. A column of circular portraits beside the stack shows
the queued players, whoever plays next first.
Figures shrink in order of their most recent completed play in the room. Their
areas follow the Fibonacci steps 13, 8, 5, 3, 2, 1, so their heights change gently.
The two most recent players stand in front. On phones, they move lower into a
bust view as more people enter. Smaller figures sit higher behind them.
Repeated plays by one person keep the others in order. Changes move smoothly.
Reviewing older words keeps the figures and belongings in their current places.
Waiting plays appear as small profile circles beside the dialogue. Their order
runs from top to bottom. A player can select their waiting circle to withdraw
their play; hover text and screen-reader labels read "Pip is thinking…" or
"Pip is playing…", never the play itself.

The approved OpenRouter request contains fictional profiles, scene facts,
visible people and belongings, and the completed play. Passkey and account data
stay with the account service. Provider errors leave the completed action saved
and show a scene error. Per-person and shared play budgets bound usage.

## Entrances and future journeys

| Person | Entrance                        | Home                           |
| ------ | ------------------------------- | ------------------------------ |
| Vale   | Existing shore and mirror paths | Empty station and Mirror attic |
| Mara   | Parted curtains                 | Paper theatre                  |
| Ash    | Diving bell                     | Sunken belfry                  |
| Iris   | Growing gate                    | Wild glasshouse                |
| Tavi   | Wind path                       | Wind hill                      |
| Rue    | Carriage door                   | Between-hours carriage         |
| Cass   | Game-tile bridge                | Games pavilion                 |
| Sage    | Open seam                       | Sail loft                      |

Rue's carriage opens beside the pond while her route board is present there.
Carrying the board inside the carriage opens the way back to the pond. The
saved crossing IDs remain stable. Empty station connects through Black pond.

## Folded belongings

Loose items stack behind their location card. Selecting the location reveals
those items. Carried items follow the same holder-based layout behind an avatar.
The table keeps selected interactions and visible holders together through
movement and delayed speech.

## Art

The existing pond, station, attic, lamp, and Vale artwork remain in the game.
The seven new human cutouts, items, and homes use the generated art under
`v2/card-game/assets/shared/`. Full prompts and source IDs are in
`art-prompts.json`. The earlier pond and station concepts remain saved as art
sources.

The homes use natural wood, stone, paper, and mist with quiet complementary
accents. Rue has close-cropped dark hair and a blue coat. Cass is tall and wiry,
with auburn hair, spectacles, and an indigo waistcoat. Sage has white hair and a
wooden wheelchair; Ash has a broad build and a grey beard.

## A way out of a stranded home

A narrow path to Black pond appears when a player in a home has no ordinary
route and the room lacks the resources to reopen its gate. A belonging on the
floor or carried by a present helper keeps its usual role. A fueled lamp can be
lit or uncovered; a dry lamp fills itself when someone holds it with an Oil
flask available in the room. A belonging
carried away leaves the pond path available. Since rules 80 an away
player's avatar stays as a resident, so what it holds still counts.
Room capacity still applies to the destination.

The same home-gate rule serves the attic and all seven visitor homes. Shared
rules version 10 adds the path. Versions 2 through 9 retain their released
bytes for replay. Loading an earlier world records an upgrade to version 10
after its journal has replayed; the upgrade preserves items and played time.

## Learning and private reflection

Shared rules version 13 saves each avatar's checked lessons and private
reflections. A lesson links an expected answer, the observed answer, and a
revised approach to one completed request. The server checks reflection evidence
against that avatar's witnessed events before it records speech and reflection
in the same journal command. A reload or journal-only rebuild restores both.

Player views include their own thoughts, persona, dreams, reflection evidence
and lessons. Other avatars supply public card text. This privacy check also
applies when projecting a world that still uses an earlier interpreter.

Every other entity's memory reaches the browser as an empty record: no
events, landmarks, sightings or summary. The browser reads only its own
avatar's memory; the stored world, journal and dialogue context keep all of
it. Late in a 66-actor world this halves the view (644 KB to 322 KB JSON,
41 KB to 25 KB with brotli). Every route already compresses JSON responses.

The current interpreter is `engine-v22.js`. Version 22 adds spoken story
middles: the Ajax shield's carrier learns from Teucer, Odysseus or Tecmessa
where it belongs, and the forest adds the three walkers' evening watch. A
`knows` condition may name several topics. Version 21 restores the dark-attic
new game. Released versions 20 and 21 keep their exact bytes for replay.
Version 20 adds Ajax’s named Trojan
account, its lasting ship invitation, three burial routes, and the signed
return to Dione. Greek pack revision 7 adds the cast, objects and place memories
while preserving earlier custody, choices and visits. Version 19 adds the Hoppy Cat pack,
the Willows island, source readings, learning from measured plays, the common
quest core, and spoken knowledge.
It also adds the forest chapter and pond opening. Version 18 keeps day and night ship
views at Athens Harbor and Piraeus Quays, plus the painted Theban Harbor Road.
Town travel keeps the older road IDs in saved memories and completed deeds.
Version 17 keeps introduction quests, remembered sightings, and Boardy’s visits.
Released versions 15, 16 and 17 keep their exact bytes for replay. Version 15 adds regional
Greek weather and Thebes day and night views. Version 14 keeps BoardyAI, his
parlour, and his calling card. Earlier versions keep their released rules.
Existing worlds receive an explicit saved upgrade.

A rules upgrade starts a fresh sync stream from the player’s current private
view. Earlier cached view events are replaced at that boundary.

## Greek ports and roads

Shared rules version 16 adds Athens Harbor and Piraeus Quays to the Greek
ship. An empty ship follows its circuit while a human waits at a port.
Resident passengers step ashore after arrival; a human aboard chooses the
port before those companions leave the ship.

Greek pack revision 5 preserves positions, belongings, story choices and
poems. It adds memories for the new port and roads, and expands earlier
learned routes through their current road and ship scenes. Myrine's coast
journey uses two Accompany plays. Versions 13, 14 and 15 keep their released
bytes. The builder writes `engine-v20.js`; older journals replay with the
recorded rules before the saved upgrade.

Shared rules version 19 makes the harbor and Agora a direct local visit, and
joins the Theban harbor directly to the courtyard. Seven roads connected the
towns then. Each road has two fixed ends, shown by destination cards. Earlier internal road IDs
stay in saved history. Current visitors, belongings and unfinished purposes
continue at a town endpoint. The migration uses the other endpoint when the
port already holds four human avatars. Released versions 16 and 17 keep their exact bytes.

Greek pack revision 8, in shared rules version 27, joins towns by one road
each. Inside a town places link directly; between towns there is one road or a
sea lane, and every walkable road has its own painting.

- Attica keeps one road, from Athens to Piraeus. The other six Attic roads are
  marked `retired`: their IDs stay in saved history, and no exit leads onto
  them. Athens links directly to Colonus, Colonus to Marathon, and Piraeus to
  Eleusis.
- The Theban Harbor Road is again the only way between the Wine-Dark Harbor and
  Thebes.
- The Sacred Way joins the Agora and Delphi, the Oeta Road joins Delphi and
  Trachis, the Royal Road joins Troy and Susa, the Black Sea Road joins Thrace
  and Tauris, and the Colonists' Road joins Corinth and Sicily. The Scythian
  Crag is now part of Tauris. Piraeus no longer reaches Tauris or Sicily, and
  Aulis no longer reaches the Greek camp: Troy is reached by ship at the Trojan
  landing.

One upgrade, `upgradeGreekOneRoadSave`, takes a revision 7 save to revision 8.
A remembered direct harbor-to-Thebes step becomes two steps along the Theban
road, and an open request for passage between them asks for the road. A known
link that now has a road becomes two steps along it, and a cut link is
forgotten. Without the Trojan invitation, a traveler left on the Trojan side
goes back the way they came: to Aulis, or to Piraeus from Tauris. Then the
revision 6 road fold runs. A visitor or object on a retired road continues at
its first end, and any other learned step that no longer exists becomes the
shortest walkable path, so Athens to Eleusis passes through Piraeus. Myrine's
journey is her saved place on its path. If she was on the coast road, she and
her companion continue at Piraeus, where she arrives. Visitors already on the
Theban road in an earlier save stay there.

## The Bard's poem as world facts

Shared rules version 60 moves the Bard's 56 authored couplets out of the
rules and prompts (#1537). Recital verses keep their choice, quest and
`summons` flag; receipts, `recitals` records, the singer's travel and
`claims` checks are unchanged. The pack schema now rejects couplet text in a
recital verse, so the engine bytes change; v59 keeps its exact bundle for
journals recorded with the older content. The couplets live intact in
`v2/content/greek-drama/lore/bard-couplets.json`. The narrator's poem
context carries the title and each stanza's id, turn and author, and the
prompt says only "My poem … holds deeds by …". A follow-up turns the lore
into readable book items.

## Learning from outcomes

Shared rules version 19 records measured attempts for item and companionship
goals. The same action chooser runs in the browser and the C interpreter. Each
avatar's retained results set its action values. The chooser compares estimates
and gives less-tried legal approaches room to establish a record. The authored
rules define goals, legal actions and the reward measure.

Each record retains the estimate made before the play, the action event, and
observations before and after it. Delayed credit covers up to four linked plays;
a changed situation or a completed goal ends that link. Saves and journal replay
preserve the measured attempts, including exploration choices. Each player
receives their own learning records through the existing private view.

The builder writes `engine-v20.js`. Versions 2–19 keep their pinned bytes.
Existing worlds receive an explicit saved upgrade before new plays use these
rules. Earlier lessons remain readable; new completed plays establish the new
estimates.

## Quest core and spoken knowledge

Shared rules version 19 uses common step capture and advancement for personal
and shared quests. Each saved step keeps its evidence, source turn and card key.
Repeated checks in one turn preserve the single-step and single-effect rules.

Earlier rules read story cards and ordered endings from pack
`storyQuests`. Current packs carry none; stories are told through pack choices.

Talk may share one fact from an authored topic or the speaker's saved knowledge.
The accepted line must contain the complete fact sentence. From rules version
56 the teller may say it in their own voice: their name may become I, me or
my, the listener's may become you, articles may drop and simple tense or person
may change, but every other word, so every item, place and other avatar, stays
in order. The prompt gives the fact in that voice ("I take the Lamp.") when the
teller is its actor. A line that passes every other check but misses the fact
is still spoken after the last attempt; it teaches nothing, so the fact stays
queued for a later Talk instead of silencing the teller. Publication records
the listener, teller and original Talk event, then checks quest progress. A retry
uses that saved exchange. The speech command carries its disclosure through the
world journal, so checkpoint recovery and journal replay produce the same facts.

Versions 2 through 17 retain their released interpreters. Loading an earlier
world records an upgrade to version 18 with its prior progress and receipts.

## Saves follow the current content

Shared rules version 63 reconciles every loaded save with the current content.
A missing authored thing joins at its authored holder, a thing the content no
longer defines leaves the world with what it held kept by its holder, and a
retired crossing closes even where the save had found it, so Black pond no
longer leads to the Halfway Tea Garden. Loading an earlier world records an
upgrade to version 63; versions 2 through 62 keep their released bytes. A save
that still cannot be read gives the New game message, never a script error.

Shared rules version 69 keeps Greek revision 10 saves whose guard told the
decree through Talk. Revision 11 tells the decree on meeting, so the saved
account no longer names a Talk choice; the upgrade lets it follow its topic.
