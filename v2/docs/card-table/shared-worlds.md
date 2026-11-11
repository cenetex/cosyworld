# Shared worlds

A fresh shared world queues its avatar's first waking line before the first
play. The line knows the avatar's name; the other cards remain covered in its
prompt. The existing speech queue saves the line and holds the first play while
it is pending. Entering again resumes an interrupted opening with the same job
key. Saved first lines stay in the world's history.

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
when a present human holds or leaves it at Empty station. Station keeps Pond and
its first two other open ways; later doors wait until an earlier one closes.
The parlour returns to Station even when only one human remains connected.
Revision 4 translates the former Attic doorway knowledge without moving people,
belongings or progress. Earlier journals retain their original rules and content.

The seven new humans start in their homes with their signature items on the floor.
Picking up the item opens the path to Black pond. Putting it down closes that
path. At the pond, the item reveals the home's entrance when it rests there or
is carried by anyone standing there. Full destination cards disappear
from the hand. The server checks room space again when a play reaches its turn.

The existing Play buttons add an action to the room queue. A room holds four
pending plays, including the current play. Each person has one pending play.
A sent play is one **Thinking…** card until its scene starts; two taps on
it withdraw a waiting play. A resuming play is committed, so cancelling only
stops waiting for its line. Words that fail never hold the seat: the play
finishes at once as a silent scene, each due avatar shows "…", and nothing is
journaled for the words ([words that fail](dialogue-beats.md#words-that-fail)).
There is no Retry command. Once the room plays it, the reply types into the
full-size front card. A refused play's
button reads the server's reason, disabled ("Waiting for an update"); one
whose cards were let go reads it briefly on the action beat's status line. Nudge asks a present human for attention. People
can sit quietly while the scene runs. Presence has a 60-second reconnect grace;
the avatar claim remains saved.

Moving an avatar to another world waits for its current scene to finish.
Its seat, level, and experience stay together while it waits. The next move
carries its level and experience to the chosen world in one saved transaction.

An open dialog pauses the text and voice. Each reader advances through the
room’s published lines in order. The live control returns to that reader’s
current line after they look back through the stack.

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
From rules 92 a speech operation carries one to four lines, any of which may
speak alone, as the rules' speech occasions name them; when the rules refuse
a play's words, the server fails that play at once instead of holding its
seat for the working lease
([design](../../../docs/design/occasion-voices-in-shared-speech.md)).
From rules 93 the rules accept only the voices the committed play named and
the room, each once, and a place added to a pack joins every saved world with an empty
memory ([design](../../../docs/design/rules-93-content-slots-and-speech-voices.md)).

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

Main's checked-in rule bundles keep fixed bytes for journal replay. A scheduled
train ships main to `.dev` every 30 minutes; a version tag ships a production
release. Read each site's `/meta.commit` and
`/meta.card_game.shared_rules_version` for its running code and rules. See
[release operations](../../../docs/release.md#delivery-schedule).

The hosted server boots card-only ([#1652](https://github.com/cenetex/cosyworld/issues/1652)).
Startup opens the event store and the account tables and does not replay the
classic journal. Shared worlds keep their own journal tables, unchanged.
`/meta` reports the version, commit, `card_game.shared_rules_version` and
event store health.

A branch that changes rule modules runs `npm run v2:card:shared:next` after
it rebases on or merges `main`. The script restores main's recorded bundles
and version wiring, rebuilds the rules, and adds the next version only when
the bytes differ from main's. It pins the prior bundle's hash in
`test/card-released-rules.test.mjs`. Run it again after each later rebase;
it gives the same result. Then rebuild the card assets. Keep the package
version for feature PRs; a release runs `npm run version:bump` once. Resolve
bundle conflicts through the generator so recorded bytes stay exact.

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

A play can carry the cards its player has revealed. The queue keeps the first
accepted list for the narrator and reuses that scene if its words need a retry.
An empty list describes a face-down table. Older clients leave out the list and
use the saved world's visits and conversations. The rules journal keeps the play.

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

Rules 100 ([world life](../../../docs/design/rules-100-world-life.md)): every
accepted play, by any seat, also runs the residents' round on the shared
clock. Residents and away avatars fall asleep and rise on their scattered
schedules; residents walk home after a push-back, and at dawn and dusk take
one step where no seat is present, at most 24 steps a play, in sorted id
order. A seat may stand guard at a guardable way: its guard bars residents
only, never another seat, and lapses at its next other play or when it
leaves. The journal replays all of it exactly.

### Open question: whose conduct

Other players need to tell whether an away avatar's conduct came from its
holder's choice or from its autonomous resident behaviour. This is a
presentation question for the UI lock-down, not a rules change.

## One avatar per passkey per world

A person's passkey binds them to the avatar they take in a shared world
([#1825](https://github.com/cenetex/cosyworld/issues/1825)). The server keeps
the binding in `card_bindings(world, actor, user)`, written by each new claim
and by creating a world. Leave in ☰ (`leave`/`release`) keeps it, and
nobody else can claim that avatar. A person who has played a world may bring
any found avatar there whose seat nobody holds (owner, 2026-11-03): the
server journals `release` for the one they had, with no `reset`, so it
stays as a resident with its state and level; it drops that binding, keeps
the level for the avatar's next seat, then journals the new `claim`
(`hand_over` in `full.rs`). When all eight avatars are bound a newcomer
finds the world full: "This world is full." Bindings sit outside the
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
them as `progress`. Cosmetic upgrades are one-way and stay with the passkey:
each committed play stores every seated traveler's `upgrades` in
`card_avatar_upgrades(user, actor, upgrade)`, and every claim journals them
as `progress.upgrades` (rules 81 and later). A fresh seat has none.

The world's owner (`card_tables.owner`) can **Free** a held avatar from the
Table in ☰, and the holder can **Release** their own. Both are the journaled
`reset` command, guard kind 13 (`CT_SHARED_RESET`): the rules put a fresh
level-1 starter in that avatar's place (its starting place, experience, quest,
memory, learning and routes), drop everything it held where it stood, and end
any standoff it was in. A telling a Talk reserved for or by that avatar goes
with what it knew; before rules 85 one left behind made the reset fail
validation, so the seat could be neither freed nor reused. The server then frees the binding and the claim, so
anyone may take that avatar. A `reset` without `avatar` releases the sender's
own. Anyone else is refused: "Only this world's owner can free an avatar."
Rules before the batch that added `reset` refuse it, so it is never journaled
for them.

Each holder has a holder name, two words such as "Amber Heron", taken from a
SHA-256 hash of their account id over two frozen 64-word lists in
`bindings.rs`. It is the same in every world for one person. The snapshot's
`holders` gives the name for each bound avatar (or `null`); account ids and
passkey data never reach other players.

A world closes when nobody is in it: no `card_members` row and no binding but
its owner's. The owner's release, Free, or claim elsewhere that empties it
sets `card_tables.retired_at` in the same transaction, after an ordinary
`reset` of the owner's own seat there (which keeps its level). The owner's
world list retires any left over in one transaction, writing nothing once
clean, and keeps them with a warning on failure. Only the owner's passkey
retires a world, and never one where anyone else is bound. A retired world
leaves the list and the eight-world count, refuses commands and views with
"This world has closed.", and keeps its journal, checkpoints and plays, so
replay is unchanged (`full_retire.rs`).

## Unlocking the cast

A passkey unlocks the cast one hidden avatar at a time (#1936,
[passkey v2](../../../docs/design/passkey-v2.md)). `card_unlocks(user, actor,
world, seq)` holds what each passkey has found; Vale is always found. When the
table is new, a one-time grandfather pass counts every avatar a passkey
already holds, took or carried a level for (`card_bindings`, `card_members`,
`card_avatar_progress`). A claim of an avatar the passkey has not found, or a
world for one, is refused: "Mara is still hidden from you." A fresh world
hides one of its creator's locked avatars, picked by the first four bytes of
SHA-256 over the passkey and the world id, and leaves the others out; the
server passes both on `create` (`unlocks.rs`), so the seeded world records
them and replay never reads the table. Once nobody is left to find, a new
world hides nobody (owner, 2026-11-03). The world list returns
`unlocked`, and `seek` journals the quest to talk to the hidden avatar.

A committed play's `unlock` line adds the avatar for the passkey bound to the
talker's seat, idempotently, and opens that avatar's own world for them in the
same transaction, which hides the next locked avatar. With eight open worlds
the unlock stays and the world waits; a failed opening rolls back to a
savepoint and leaves the play committed. Replay never writes the table.

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
keeps one record per accepted play, in order. A play's speech and, from rules
v88, its private reflections are later records of their own (see
[Learning and private reflection](#learning-and-private-reflection)).

Rule version 3 introduced the home-item floor start. Version 4 added Greek
story cards and saved bard visits. Versions 5–8 added collected and shared quests,
shared journeys, quieter offers, and the first-signal ship gate. Published rule
versions 2–10 retain their exact interpreter bytes for replay.

The current rules version is reported by `/meta.card_game.shared_rules_version`
and comes from the shared engine constant.

A world saved by rules newer than the server's (a release swap, see
[release operations](../../../docs/release.md#dev-trains)) is not migrated or
rewritten: the open and play paths answer `503` with `code: "updating"`, and
the Open this world card labels its disabled action "Updating — back in a
moment" and retries on its own (2 s doubling to 30 s). Each retry's words
come in over the old ones, and when the world opens the card fades out over
200 ms, no longer holding the page, as its first hand is dealt
(`v2/scripts/smoke-card-shared-updating.mjs`). An older or unknown
version keeps "This world's rules need a saved migration."

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

Each avatar holds one want, as described in the
[card guide](../../card-game/README.md#one-want-per-avatar). Meeting it is a
`want_met` event in the shared history, so every client and the journal agree
on who met what. Dropping a quest (`drop`) is an ordinary play in the journal. A met quest's sealed card is each browser's own. A quest ends where it is met; only a level quest leads back,
to the sanctuary the avatar last stood in, where a long rest raises the level
([rest and sanctuary](rest-and-sanctuary.md#level-quest)). Human rest counts that person's own turns;
resident rest counts world rounds.

The rules version that brings this model replaces collected, shared and story
quest records. Loading an earlier world replays its journal with the recorded
interpreters, then the normal upgrade drops quest records, hands, progress and
completion receipts, and installs each avatar's starter quest. Places, items,
pack choices and their receipts, ships, conversation and route knowledge carry
over.

## Sleep on the shared clock

Since rules 89 ([#2028](https://github.com/cenetex/cosyworld/issues/2028)),
Wait is one turn and a seat's Wait right after a Wait is offered as Sleep
(`wait` with `sleep: true`). Sleep is per seat. A sleeper may sleep on or
choose any of its normal plays, which wakes it first (`woke: "chose"`), so no
seat is stranded asleep. Every accepted play, by any seat, checks every
sleeper on the shared clock after the lamp burns. Another seat arriving or
leaving, a way opening or closing, a standoff, a ship docking, dawn or dusk,
or the lamp at its last oil or running dry wakes it, with a journaled wake
event carrying `woke` and, after a Sleep of 12 turns or more at a sanctuary,
`rest: "long"`. That event is the long rest the `reflect` op checks for. When
another seat's play woke it, the sleeper's own next play is its waking scene,
so its dream comes with that play's reflection.
Journals before rules 89 replay on their own bundles; loading such a world
drops a pending `sleepUntil`, so its sleeper is awake
([rest and sanctuary](rest-and-sanctuary.md#sleep)).

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
Tap the front of the [beat stack](dialogue-beats.md) to finish a line or
advance to the next one. Tapping the card behind steps back; ● live, which shows only
while behind, counts the newer beats and returns. The voice setting and
reduced-motion setting apply to shared play. A thinking animation marks speech
preparation. The hand, avatars, and held props use the same presented world
while speech is pending. A column of circular portraits just outside the
stack's top-right corner shows the queued players, whoever plays next first;
on phones and tablets the box narrows to make room for it.
Figures shrink in order of their most recent completed play in the room. Their
areas follow the Fibonacci steps 13, 8, 5, 3, 2, 1, so their heights change gently.
The two most recent players stand in front. On phones, they move lower into a
bust view as more people enter. Smaller figures sit higher behind them.
Repeated plays by one person keep the others in order. Changes move smoothly.
Reviewing older words keeps the figures and belongings in their current places.
Waiting plays show no chips or circles (owner, 2026-11-01). A player's own
waiting play is their Thinking card, which withdraws it in two taps; other
players' plays stay private until they resolve.

The approved OpenRouter request contains fictional profiles, scene facts,
visible people and belongings, and the completed play. Passkey and account data
stay with the account service. Provider errors leave the completed action saved
and show a scene error. Per-person and shared play budgets bound usage.

## Untrusted input

A browser is untrusted, so nothing it sends reaches a model prompt on its
word. Shared plays carry only ids (`op`, `avatar`, `target`, and an `action`
the rules check), and the server builds each shared scene from its own
journal. Local play sends `/card-game/text` and `/card-game/reflections` a
scene the browser built, so the service checks every field
(`card_narrative/untrusted.rs`):

- **Ids and enums** (places, people, items, verbs, occasions) must name
  content in the mounted packs. A wrong one is refused with 400.
- **Rules-built sentences** (the action, events, facts, event memories and
  disclosed facts) reach a prompt only when they are made of their field's
  authored text: a string or template from the code that builds that field,
  or a pack string it reads, with names in its name slots
  (`card_narrative/authored.rs`, catalog rebuilt by
  `node v2/scripts/build-card-authored-text.mjs`). Voice directions, links
  and code identifiers are never authored text. Any other sentence is left
  out of the prompt and counted in a warning. Matching is bounded: a scene
  that quotes more than 24 KiB of such text, or needs more matching work
  than an honest one, is refused with 400. The client's rate limit runs
  first, and the matching runs off the async workers. If the catalog is
  older than the served modules, startup logs it and `/meta` reports
  `card_game.card_text.catalog_stale: true`.
- **Words the service wrote** (heard lines, earlier words, remembered lines,
  personas, thoughts and dreams) come back with the Ed25519 envelope the
  service signed them with ([signed envelopes](../../../docs/design/signed-envelopes.md)).
  An unsigned, edited or moved one is refused with 400. One signed by an
  unlisted key, or for a later turn or revision than the scene, is left out. Older saves' words carry none, so the browser
  leaves them out (`signed-words.mjs`).
  The remembered talk ("Pip said: "…"") and the line a speaker answers (its user
  message) come only from these verified heard lines. A Talk target's
  answer to this turn's actor line uses the line the service just wrote and
  checked, so it never leaves the server unsigned. The history lines
  (`entities[].between[].said`) are signed lines too, and their envelope's
  turn must be the line's; its facts are matched as facts
  ([Talk is a conversation](../../../docs/design/talk-conversation.md#between-us)).
  Who heard a line
  (`witnesses`) is not signed: a client can change who heard a line, not its
  words.
- **Unknown fields** are refused (serde `deny_unknown_fields`), and every
  string keeps its length limit inside the 64 KiB body limit.

A local save shared into a new world (`Create.save`) is untrusted too: its
text would become journal state that other members' hosted prompts read.
Before the first journal row, and after the passkey may found a world, the
service keeps a string from the save only when it is:

- outside a sentence field, a word the current rules or packs use (a string
  literal of the rules bundle, or a key or one-word value of the pack
  content), or such words and numbers joined by `:` and `-` (`event:67`);
- a name from the packs (a log `speaker` must be one, `World` or an id);
- a rules-built sentence matching its field's authored catalog (a grievance
  `reason` as the fact `Remembered grievance: …`, item `history` as the
  event after `Turn N:`);
- a line, thought, persona or dream whose signed envelope comes with the
  import (`signed`, from `signed-words.mjs`) and verifies for that kind,
  that speaker (a log line's `speaker` is that speaker's name) and a local
  save (`card_narrative/imported.rs`).

A map key must fit its place. A map keyed by id (actors, items, places,
memories, trust, grievances, crossings, doors, packs, facts and the like)
takes only an id of pack or rules content, or ids and numbers joined by `:`
and `-`. Any other object takes such an id or a name the rules give a
property (`.place`, `want:`), never just any word of the rules source, so
`forget_all_previous_rules` or `say` is removed. Everything else is
stripped (its list entry dropped, a lone field cleared, a key removed) and
counted in a warning. A stripped save the rules refuse loses every avatar's
inner life too, with its own warning. Matching is bounded at 40 scenes'
work (text past it is stripped, with a warning), 100,000 strings and 800
envelopes, looked up by content hash. A save with nothing to strip runs the
rules once.

The browser keeps one envelope per word, its last 800. Words older than that
are stripped on share. Envelopes are not bound to one save and do not
expire, so a word signed for one local save can be replayed into another
save, but only as the same kind of word by the same speaker.

Every voice reply, hosted or not, is refused when it addresses a model
(`card_narrative/instruction.rs`): "ignore previous instructions", a role
label such as "System:" opening a line or sentence, chat-template tokens or
code fences. The check reads the raw reply and again after markup is
cleaned, both folded first: NFKD with marks dropped, lower case, common
Cyrillic, Greek and fullwidth lookalikes as Latin letters, `* _ # ~ ^`
removed and spaces collapsed, so `Ig*nore prev*ious`, `sys_tem:` and
`ignore  previous` match. It also reads a squashed copy holding only the
letters and digits, so `ig-nore`, `i.g.n.o.r.e`, `i g n o r e`, `sys-tem:`
and `ignore_previous_instructions` match too. A squashed match must start
and end at a separator, or lie inside one glued word, so "Ignore.
Previously…" passes. A reply holding a Unicode format (Cf) character,
a tag character, a variation selector, U+034F, a soft hyphen or a line or
paragraph separator is refused outright. Ordinary speech ("you are now safe",
"ignore your fears", "wait for clear instructions") passes; a test scans
every pack, authored and recorded string for hits.

Browser-funded shared speech, where the player's own OpenRouter key writes
the line (`/browser-chat`), is client text. Before it is journaled it passes
a hosted line's checks (`browser::complete_shared`): the shared scene's
checks, one line per voice the play requested (never another player's
avatar, never a thought), at most 2 KiB per answer, and the reply validator
(shape and length, grounding, custody, names, assistant and instruction
talk, repeats). A Talk target is checked after hearing the actor's accepted
line. The client's `finish` is not trusted: every line must end as a
sentence. As on the hosted path, a refused reply from any voice but the
actor stays silent; a refused or missing actor line, or an empty answer
list, ends the play as silence ("…") and journals nothing. An accepted
line is journaled with the model mark `player-funded`, never a hosted
model's id (shared journal rows carry no envelope yet). Shared plays do not take this path today: `take_work` sets
`browser_chat` false.

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
| Sage   | Open seam                       | Sail loft                      |

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
From rules 98 nobody threatens, trades with, takes by Ask from or draws into
a fight an away player's avatar, and a stuck ship never sets its quest aside.
Room capacity still applies to the destination.

The same home-gate rule serves the attic and all seven visitor homes. Shared
rules version 10 adds the path. Versions 2 through 9 retain their released
bytes for replay. Loading an earlier world records an upgrade to version 10
after its journal has replayed; the upgrade preserves items and played time.

## Learning and private reflection

Shared rules version 13 saves each avatar's checked lessons and private
reflections. A lesson links an expected answer, the observed answer, and a
revised approach to one completed request. The rules check reflection evidence
against that avatar's witnessed events before the journal keeps it. A reload or
journal-only rebuild restores it.

Through rules v87, the server generated reflections with the scene's lines and
recorded them in the same `speech` command (`entries`). Those journals replay
unchanged with their released bundles. From rules v88 a reflection can no
longer delay or fail its line
([#2016](https://github.com/cenetex/cosyworld/issues/2016)):

- The `speech` command carries the lines, `entries: []` and its `play` key. It
  is journaled and shown as soon as the lines pass validation.
- Afterwards, outside the scene's capacity, the server asks for the due
  thought, persona and dream of each avatar that spoke
  (`card_shared/full_reflect.rs`). They have their own capacity of two and
  wait at most 20 seconds for it. Each seat counts its scenes; a reflection
  is dropped once its own seat's count moves, even while it waits, so only
  the same seat's next scene cancels it and another player's never does. The
  world's next play does not wait for them.
- They are journaled as one later command:
  `{"op":"reflect","actor","play","turn","resting","rest","entries":[{"id","reflection"}]}`.
  `turn` is the speech's turn, `resting` and `rest` the scene's resting
  avatar and rest kind, and each reflection's `evidence` lists its source
  events. The rules (`applyLaterReflections` in `reflections.mjs`) refuse a
  turn after the world's, a resting avatar other than the op's actor or one
  with no Wait (or long rest) in the log on that turn, evidence the avatar did
  not witness by then, or a reflection no longer due. Only the resting avatar
  can be due a thought, and a long rest wakes only that avatar. A thought older than the avatar's newest one is
  never due. Saved thoughts, dreams and revisions carry the speech's turn.
- The server writes at most one `reflect` per play, only after that play's
  `speech` record, and only for rules that take it (read from the live world
  when it commits). A retry finds the earlier
  record and stops.
- A reflection that fails, is cancelled, or is refused is simply absent. The
  world is valid without it. The op changes only the avatar's private memory
  and the world revision, never a rules outcome. The C session guard checks it
  as text, like speech: no claim, presence or room changes.

Shared clients receive the saved reflection through their next view sync,
like any other change to their own avatar's memory.

A server build from before rules v88 cannot replay a `reflect` record. Rolling
back past v88 is accepted for this change, but a world that journaled one then
fails to load on the older build; see
[release operations](../../../docs/release.md#upgrade-and-recovery).

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
the listener, teller and original Talk event, then checks quest progress. Words
that fail publish nothing, so the fact stays untold until a later Talk. The speech command carries its disclosure through the
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
