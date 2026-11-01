# Card world text and memory

## Shipping engine

`world.mjs` owns the card game's state, legal actions, resident turns, and save
format. `forest.json` holds the forest catalog, starting state, and each hub
avatar's starter quest. `createWorld()` copies that data for each game.
`app.mjs` uses the engine in the browser. The modules beside it provide quests
(`want.mjs`), motives, life, memory, pack rules, and presentation. Both the local server and
the Rust asset server publish this same game.

[lonelyforest.com](https://lonelyforest.com/) receives deliberate versioned
releases. [cosyworld.fly.dev](https://cosyworld.fly.dev/) tests changes from
`main` through automatic deployment.

Build new game rules in these shipping modules and check them through
`test/card-*.test.mjs`. The [generated-world backlog](../../docs/archive/backlog/generated-world-core.md)
keeps the useful ideas from the retired standalone engine, with its source
revision for reference. Existing player saves use `world.mjs` and
`legacy-saves.mjs`; keep their migrations with changes to the save format.

### Allocation on the play path

Each play runs the rules many thousands of times: `entityActive`,
`rootHolder`, `carried` and `validateWorld`. Allocation there turns into
garbage on every play, and phone browsers that build up enough of it kill the
tab. Keep these paths free of per-call `Set`s, spread arrays and array
literals. Build lookup sets and sorted key strings once, when the module
loads, from the fixed catalog. Walk short holder chains without tracking
visits, and track visits only for a chain long enough to hide a loop.
`validateWorld` marks each world it accepts. `encodeSave` skips the check
once for a marked world, the one a play just returned, and clears the mark.
A decoded, imported or saved-again world is checked in full.

## Public assets

`public-assets.mjs` defines the public files and their content types. It includes
room music and pack media from their registries. The local server and release
smoke read that list. Build image variants, music stream descriptions, and the
Rust server's embedded list with:

```sh
npm run v2:card:images:build
npm run v2:card:music:build
npm run v2:card:assets:build
```

Stage images use full-size WebP copies; viewports up to 640 pixels wide use
copies that fit inside 960 pixels, which decode to about a third of the memory.
Hand cards and small portraits use 512-pixel copies. Transparent parts keep their original alpha values. Authored
image paths keep their identity in saves and rules.

`media-manifest.json` records the SHA-256 of each published image and audio
response. `mediaUrl()` adds that hash to the URL. Browsers can retain those
bytes across visits. A changed file receives a new URL. Other static requests
use content validators for a short revalidation reply.

Music stream URLs expose the original MP3 audio frames after the leading ID3
metadata. The original MP3s keep their metadata and remain available at their
published paths. Each stream has its own hash and byte range support.

Commit the generated image map, WebP files, music stream map, and media hashes
with their source changes. The Rust module that embeds these files is not
committed: `v2/orchestrator-rust/build.rs` runs
`v2/scripts/build-card-assets.mjs --rust-out` on every build, so Cargo needs
Node.js 22 or newer on `PATH`. The module depends only on repository files, so
one commit always yields the same `assets_sha256` in `/meta`.
`npm run v2:card:pack:build` rebuilds this set and the pack data.
`npm run v2:card:pack:check` checks it during CI and release gates.

## Character voices

Pack residents can set `expression` to `speech`, `movement`, or `emoji`.
Speech is the default. Movement replies describe a small visible gesture and
appear as narration. Emoji replies use two to five symbols from
`emoji-symbols.json`; their English names supply the accessible reading.
The server reads the expression type from the authored character profile.
Spoken audio and letter sounds follow speech replies.
A committed ring at your place strikes a synthesized bell (`sfx.mjs`), softer from next door; it follows the music switch and volume.

Spoken character voices use the player's OpenRouter credits and account routing
settings. Written dialogue uses the game's account. Provider retention follows
the chosen account settings and provider policy. Temporary provider errors can
retry; request, account, and routing errors return control to the player
immediately.

The Settings footer and the COSYWORLD wordmark tooltip name the build from the
server's `/meta` (`v1.2.104 · 94ff0b8 · rules 57`, commit linked); a static
server shows none.

Connect OpenRouter in Settings and leave **Voices: on** to hear Vale, Mara,
Pip (`moth`), the Keeper, Badger, and Dione (`greek-baker`). The first tap or
key press enables audio. The voice reads the character’s actual dialogue.
Tapping once reveals the words; tapping again advances to the next speaker.
The automatic reading pause waits for audio to finish. Menus and hidden tabs
pause the voice. **Retry voice** repeats a failed request for the current line.

`voices.json` maps the cast to six original Seed Audio references in
`assets/voices/`. `character-speech.mjs` sends the reference, transcript, and
current dialogue to `fish-audio/drama-3` through the player's browser OpenRouter
connection. [Drama 3](https://openrouter.ai/fish-audio/drama-3) supports voice
cloning and natural-language performance direction. The saved references keep
each character's original voice. A provider error appears in Settings and enables
**Retry voice** by the line.

Each character can set its own speaking speed. Vale, Mara, Pip, the Keeper,
Badger, and Dione use 1.12× speed for a slightly quicker delivery. Voice settings
are part of the cache key, so a pace adjustment produces fresh speech for that
character.

Each voice also has a delivery brief in its `direction` field. The shared aim
is connected thoughts, clear words, gentle emphasis, brief natural pauses, and
soft phrase endings. The dialogue guides the emotion. Vale has dry warmth;
Mara has flowing theatrical phrasing; Pip has light, papery courtesy; the
Keeper has measured dignity; Badger has rounded words and a warm rumble;
Dione has direct warmth and calm assurance. These briefs travel in the existing
speech request's `instructions` field. A direction change gives that character
fresh generated clips through the voice cache key.

Generated clips stay in this browser’s cache for replay and reload, up to
32 clips and 16 MiB. Cached clips also play after disconnecting OpenRouter.
Cache identity includes the model, reference hash, direction, transcript, and
spoken words. Audio stays separate from saves and shared world history.
Shared viewers hear their own copy of the room dialogue in order. Reference
and generated audio are checked through `test/card-character-speech.test.mjs`.

## A quest stack per avatar

Each avatar holds a stack of up to three quests (#1831). Each quest is an
item to hold, a place to reach or a person to talk with. A world pack defines each resident's starter quest as its `want`
(`{kind, target}`); `forest.json` does the same for Vale, Pip and the keeper.
What happens next comes from the world rules in `want.mjs`, not from authored
quest chains. The internal field `actor.want` is the top of the stack, the
quest pursued and shown; `actor.under` holds the quests beneath it, next
first, and is absent while the stack holds one. Player-facing text says quest.

- **Stack.** A new quest always goes on top, and nothing replaces or wipes a
  quest already held. A quest the avatar already holds comes to the top
  instead of being held twice. When a fourth arrives, the oldest ordinary
  quest leaves. A level quest never leaves this way, and a story quest
  (`story: true`, pushed by pack content such as RATi hiding your button at
  the Cosy Cottage) leaves only when everything beneath the top is a level or
  story quest. An avatar holds one level quest at a time. Any quest in the
  stack is met when its condition holds, not only the top one, and a met
  quest leaves the stack; the next is drawn only when the stack is empty.
- **Choose and drop.** In the open fan, choosing a quest beneath the top
  brings it to the top with a **focus** play naming it (`quest`, its index).
  Focus is journaled like any play, but it takes no turn: the world does not
  move on. The top quest offers **Drop quest**, the `drop` play with that
  index and no item; the rules accept a drop at any index. Dropping an
  ordinary quest costs nothing, and its target stays out of mind a while;
  dropping a level quest costs half the experience and keeps the level.
  Dropping the last quest draws another at once, and a drop takes a turn.

- **First quest.** A player holds no quest at the start: the attic opening
  has no quest card. The hub's `questsBeginAt` (`forest.json`,
  `{ "kind": "arrived", "place": "pond" }`) holds back a player's first quest
  until it first reaches the Black Pond, and that quest is drawn at once on
  arrival. Residents hold their wants from the start, and a save already past
  the pond keeps its quest.
- **Met.** An item quest is met when the avatar is the item's root holder, a
  place quest when it stands there, and a person quest when the two share a
  place and Talk. Meeting a quest records a `want_met` history event and one
  experience point. Level is a rising curve of experience: 1, 3, 6, 10 points
  reach levels 2 to 5. Standoff strength and the scene read that level.
  A pack resident may set `startLevel` (1–99) and begins with that level's
  experience. Each pack starts a few residents at a tier's first level: one
  Legendary (50), one Epic (30), two Rare (20) and three Uncommon (10), as far
  as its cast allows. Player and human avatars start at level 1. An item, in a
  pack or the hub's `forest.json`, may set the same `startLevel`; its card
  shows that level and tier with the same numeral and border. Items do not gain
  levels yet, and an item's level changes no rule.
- **Next.** The next quest is drawn deterministically from the world, seeded
  by the avatar and turn: items others hold nearby that the avatar values
  above what it carries, reachable places it has not visited, and known people
  it has not talked with. Every other draw for a player comes from the whole
  world instead: any active place, any active person, and any item someone
  else holds or that lies somewhere, whether the player has met or found it
  or not (#1831). A target needs only to exist; it need not be reachable now.
  Residents keep to what they know, since they must find a way there. A quest ends where it is met: nobody is sent home
  (#1824). A resident rests right there a few turns while it holds the next
  one.
  Every active avatar, players and unseen residents too, always holds at
  least one quest: with nothing near left, its curiosity starts over at once, and then
  anyone known, or what they hold, will do, reachable or not. A new world
  draws one for every avatar without an authored `want`; a quest left empty
  by an older rule set or a pack mounted later is drawn after a short rest.
- **Level quest.** The quest is the threshold (#1583). A player's
  experience still rises with every quest met, but its level (`actor.level`)
  rises only through a level quest. Waking from a long rest at a sanctuary
  with experience enough for the next level brings that quest in the dream:
  the scene tells the model the quest as a fact, and it goes on top of the
  stack, above the ordinary quests. The quest for level n has F(n) steps
  (1, 1, 2, 3, 5 ...), each drawn from the whole known world among the half
  furthest from home. After the last step comes the way back: a **rest**
  step at the sanctuary the avatar last stood in (`actor.sanctuary`, or home
  for one that never reached a sanctuary). Being there is not enough; the
  long rest there raises the level. A rest step anywhere in the stack
  counts. A step with no way forward becomes another of the same level.
  Residents level on experience alone.
- **One world each.** Level, experience and quests belong to an avatar in
  one world (#1825). A new world starts the avatar at level 1 with its
  starter quest, and the old world keeps its progress. The packs mounted in a
  world (Greek, Willows, Hoppy Cat) are part of it and share that progress.
- **Step verbs.** A level quest step may carry `step: { verb, to?, at? }`
  beyond its kind's own verb (hold, go to, talk), drawn from the living world
  (`want.mjs` `STEP_VERBS`). State verbs hold after any play: **find** an item
  by standing where it is, whoever holds it; **meet** a person by being
  together, without a Talk; **bring** an item to a person at a place by
  holding it there together. Act verbs are met when the avatar's own play
  resolves: **give** only when accepted, **threaten** and **strike** (the attack play) whatever
  the outcome, and only from Rare (level 20). Steps interlock with other
  avatars' quests: an item another known avatar wants to hold may be given
  or brought to them at home, meeting both quests in one play, and a person
  on the way to a place may be met there. A step already true where the
  avatar stands is not drawn. Steps come one at a time in order; nothing is
  authored ahead.
- **Pursuit.** Residents use the fixed verbs: travel along routes (travellers
  who learn the roads keep to the routes they know), then ask, trade their
  least valued spare, and threaten when bold enough by resentment, level or
  earlier refusals. `expects()` lets them skip some offers they expect to be
  refused, but refusals still happen: each refusal of the quest item counts,
  and after three, or a long spell with no way forward, the quest is set aside
  for a while: it moves to the bottom of the stack, fresh, and the quest
  beneath comes to the top (a lone quest gets a newly drawn one above it).
  Residents pursue their top quest. A resident that keeps to its scene acts only while someone is
  there, so its quest can stall only after a first refused attempt, and the
  stall clock starts at that attempt.
- **Trust** has one source: someone gave me the item my quest wanted.
- **Connect.** BoardyAI's starter quest is `{ "kind": "connect", "target":
  "humans" }` in `boardyai.json`. It is met by any Talk in his room while two
  connected humans are there with him. In Talk he says "I want to introduce
  you to someone." As a resident he Talks once two connected humans share his
  room, and otherwise goes to one who is elsewhere. Generated quests are never
  connect quests. BoardyAI is inspired by [Boardy](https://x.com/boardyai).

The hand holds people, items and places, and a quest card for each quest in
the player's own stack (`quest-card.mjs`, client only). The card shows a small 4:3 scene
(`quest-screen.mjs`): the player on the left doing the quest's verb with the
target on the right, from the images the stage already uses, with attack and
guard poses for Strike and Threaten. A place quest shows the player small in
that place. The place's painting fades softly into the card, with no frame,
and appears only for the place itself or when the step happens where the
player stands; elsewhere the figures stand on the card's dark ground. An
unknown target shows a small carved card back in its slot, and an unknown
place shows the back alone. The card names
nothing: only one short verb (Hold, Talk, Go to, Discover, Introduce), the
level numeral of a level quest and its tier colour, which follows the quest's
F(n) steps (1 Common, 2–3 Uncommon, 5 Rare, 8 Epic, 13+ Legendary). It never
shows who holds the target or how far it is; it glows softly and steadily
while the target is within two moves. Steps still to come lie face down behind
the card, showing the card back. It plays nothing. The top quest folds behind the player's avatar card as
a full-size card in its stack: face down, showing the carved card back, leaning
out to the top left with a glowing line in its tier colour along its edge.
Choosing the folded card fans the whole stack out, top first, and so does
opening the avatar's stack. In the open fan the top quest is chosen and
offers Drop quest. Tapping a quest beneath brings it to the top, with no turn
taken, and tapping the chosen one folds the fan. The rules remove a met quest at once; the browser keeps its card,
sealed, in the fan, and the folded line glows until its player taps the card
to clear it. Any met card can be cleared, in any order; clearing shows the one
point of experience it brought rising from the card (a still label with
reduced motion) and glows the avatar when it ends a level quest. Clearing is
this browser's alone. A first quest arrives with its line glowing. There is
no card for anyone else's quest. Another person's quest reaches the player only
through Talk:
`want-talk.mjs` adds one first-person fact about the top quest ("I want the
Lamp.") for the player and the person on the other side of a Talk play, with a
count of the rest of the stack ("I have one other quest too."). Bystanders' quests stay
unsaid, and a met quest is not said.

Loading an earlier save drops its quest programs, collections, progress and
quest history (`forgetQuests` in `legacy-saves.mjs`) and installs each
avatar's starter quest. Saves from before schema 6 start fresh. Shared worlds
move to the new rules through the normal upgrade; released journals still
replay on their frozen rule bundles.

`test/card-want.test.mjs` covers the rules, `test/card-liveness.test.mjs`
checks that every resident meets a quest in each 80-turn window of loose play,
and `test/card-want-talk.test.mjs` checks the Talk fact.

### Later: quests from everything known (#1506)

Owner decision: when choosing an avatar's next quest, every item, avatar and
place the avatar has **seen or heard about** is an eligible candidate: items
held or loose, avatars (person quests) and places (place quests). Nothing
known is excluded outright, except the avatar's own holdings and current
place. Preference weighting (values, unvisited, not yet talked, nearby) stays.
Unreachable quests are fine (mystery over reachability; no fallbacks).

Today `nextWant` widens to anyone known and what they hold (#1700), but an
item lying loose in a place still cannot become a quest, and there is no
per-avatar `known` list fed by sight or Talk. The plan: record a per-avatar
`known` list of entity ids deterministically from committed plays (what it
sees where it stands, what it hears in Talk, and entities named by events it
witnesses); draw candidates from it with a seeded weighted draw; ship a new
rules version with released bundles kept for replay and JS/Rust agreement.
It shares its store with [hidden holdings](../../docs/design/hidden-holdings.md).

## Image-first presentation

Card faces contain the illustration and a small name. People and things stand
upright at 2:3, the shape of the carved cover; an uncovered place keeps a wider,
landscape-leaning card (4:5 on phones). The hand fans: each card overlaps the
one before it and leans with its place in the row, and the chosen or hovered
card comes to the front. Names stay clear of the next card's overlap and wrap
rather than hide under it. The card after a chosen or open card moves out from
under it, so a long name like "Road to Theban Courtyard" keeps its first
letters. The hand leaves room for the outer cards' lean,
the folded quest and a chosen card's lift, so nothing is clipped at its edges.
Cards carry no count badges; opening a stack shows its cards. Tapping a card toggles
its selection. Selecting a card or pair shows named actions in the row below.
A selected card lifts and wears one white edge over its tier border, apart from
the level-up glow, and the rest of the hand dims. At most one place is
selected: choosing another place replaces it and keeps the selected person or
item, so Pip + Station, then Pond, offers **Invite Pip along** to the Pond.
Tapping an action button plays it. The current place leads the hand, followed
by items lying there, avatars with their carried items, and travel destinations.
The places you can go from here form one location stack: the current place
lies face up on top, and each reachable place adds a face-down card, showing
the carved card back, behind it, up to three. Tapping the current place fans the stack (and the items lying there)
out like the hand; tapping a place selects it for **Travel**, and the stack
folds back after the play.
A person or place holding things shows the first of them peeking out behind
its card. Hover lifts a card and its preview stack together. The name shade reaches the
card edge, so a raised card clipped by the folded row shows no stray art.
Arrival starts the hand at the new current place. Selection keeps its scroll position.
On wide screens, the resting hand occupies two card widths at the right. Dialogue
sits at the left. Selecting a card opens the hand across the screen and moves
dialogue above it. Swipe, use the wheel, tap the ‹ › buttons beside an overflowing hand, or use the arrow keys to reach more cards. The buttons dim at each end, cards fade out at an edge that hides more of the hand, and a sideways swipe stays inside the hand.
Play stays available during an exchange. A play that has not resolved shows
what the avatar is doing on its own button, as a rules caption from its kind:
**Waiting…**, **Striking…** or **Travelling…**. In a local game tapping it again cancels it. Selecting another
card clears the waiting play. Shared play waits for the player's current turn
to finish, then checks the chosen action against the current table before
sending it. There a second tap keeps the play; **Cancel play** withdraws it.
The button keeps that caption while the shared play is sent and played.
Nothing floats over the stage. Words the player must see, such as **Not played**
with the server's reason, an unsaved world, a lost connection or a nudge, read
on the action bar's status line above the hand. A refusal stays until the next
play and does not return on reload.
Selection, cancellation,
drag pairing and keyboard navigation spend no turn; only a committed play does.
The latest selected carried item appears in the player's avatar hand.
Clicking the scene keeps that item selected and held. Tap its card again or
press Escape to clear it.
The preview follows the figure's facing and movement and shows the item's light,
ringing, and covering. Lowering that card returns to the other selected item;
clearing the selection clears the preview. A play that leaves the item in the
player's hands, such as Light or Cover, keeps it raised with the player's card,
so the row offers the next play, like Put out. Choosing a third card while the
item is raised replaces the other card and keeps the item. Giving, dropping or
trading the item clears it as soon as custody changes. For half a second after
a play, the redrawn row ignores taps, so a double tap cannot reach the new slot.

New cards arrive in their normal stacks with a carved wooden-box cover. A new
game's opening cards, such as Vale, the lamp and the attic, start covered too, as
do a new visitor's first cards in a shared world; a table this browser already
knows keeps the cards its player has uncovered. The first tap uncovers a card
without selecting it or spending a turn; subsequent taps select it normally.
A place widens from the upright cover to its wider card as the lid lifts;
with reduced motion it crossfades.
An uncovered new card glows in its tier colour and carries no text badge.
Covered cards cannot be dragged or paired. Each browser remembers which cards
are still covered, including after a reload.

The player's avatar knows only what its player has uncovered (#1575). Until a
card is uncovered, the screen never names it: the place heading, world name
and page title show "…", and card labels, screen-reader text and stage alt text
leave it out. A new game's first line waits until its player uncovers both the
avatar and its place; in shared play the room's lines wait the same way for
each viewer. `speech-knowledge.mjs` removes covered items from every local
speech request, so the dialogue service cannot name them; a fact that
mentioned one says "something I can't make out" instead, or "something shining I can't make out" for a lit light no cloth covers. The first line is
raw (#1600): the request is marked `waking`, and the service frames it with
"I'm waking up." and only what is uncovered (the place, the holdings and,
once the avatar's own card is uncovered, its name). The waking line never
gets a system voice, so the idiolect's wants and bargains start on the next
turn (#1665). The cue is "Me:" until the avatar's card is uncovered. No line is scripted: if the model
gives no first line, the avatar shows the silent "…". This filter lives in the browser
because it uses that browser's covered set. Rules-owned knowledge will replace
it.
Borders use Signal's level-tier colours: Common 0–9, Uncommon 10–19, Rare 20–29,
Epic 30–49 and Legendary 50+. A selected person or thing shows its exact level
as one faint, matching Roman numeral at its top; places have no level of their
own and show none. These fixed bands use existing avatar levels; items
currently have level 1. They do not change progression.
When a shown card's level rises, it glows once from its old tier colour to the
new one, lifts slightly and changes its numeral in place, in about a second;
reduced motion shows the new level at once.
No card face or hover text exposes quest checklists, hope fractions, Inspiration,
fuel arithmetic, ringing deadlines, or ritual phases. Observable changes
belong in the scene and art; hidden conditions never become a progress indicator.
Accessible descriptions report the same observable facts, not extra puzzle clues.

Lamp and cloth manipulations need no generated commentary. Social exchanges,
travel and the existing authored bell echo retain their speech. The optional
The Memory panel shows remembered beats; the export contains spoken lines, not an objective journal.
Basic controls are available on request in Menu, without combination recipes.

This presentation change preserves the existing simulation and save fields;
it does not erase saved levels or replace the resident motivation system.
Forest owns crossing mechanics. No new gate format is introduced here.

Run `node v2/scripts/smoke-card-image-first.mjs` for real desktop, phone and
short-landscape checks. It exercises keyboard, scrolling, selection, drag,
ritual reload, visible state, travel and conversation without paid model calls.

Run `node v2/scripts/smoke-card-devices.mjs` for Android phones, 130% text
size, landscape, tablets and a Chromebook. The hand shows at least 70% of each
card with its name on screen, and the top bar and dialogue stay inside the
viewport. Some in-app browsers block storage. In that case the table plays a
fresh opening in the tab and says the world cannot be saved; it does not refuse
every card.

### Later: partner cards show their play (#1379)

With one card raised, each other card should show the verb it would play, and
tapping a labelled card plays that verb. Cards with no play are dimmed, and the
screen-reader readout still works. Today the hints go only to `#play-readout`.
#1699 dims every unraised card, but no partner card shows its verb and tapping
a partner still only selects. The single action bar (#1725) does not replace
this preview. UI only.

## Oak and the Moonlit Trail

Oak's avatar card and dialogue portrait show the gnarly oakheart. The Old Oak
Tree keeps its broad landscape painting, and Oak remains part of that backdrop
without a second figure on the stage.

Later: the [tree of dreams](../docs/card-table/old-oak-dreams.md) (#1468)
adds the Roots beneath the Oak and a Mandarin → French → English dream chain
that only RATi, Skull and Whiskerwind can reach.

The Wolfprint Charm opens a path from Oak to the Moonlit Trail while the charm
is at Oak: carried by someone present, put among the roots, or given to Oak.
Taking it away closes that entrance. The return from the trail to Oak is always
open. The garden path still opens after tending the drain or stones, so a first
visitor can reach the charm on the trail before finding this shortcut.

## World packs and the Wine-Dark Sea

At quiet Black Pond, the fueled Lamp and Black cloth can summon a ship.
Board it, then disembark at **The Wine-Dark Harbor**. The Theban Harbor Road
leads to Thebes and **Before the Burial**. The ship keeps its dock and passengers in the same
saved world. Once summoned, it remains available for later crossings.

After a public Theban response, Dione offers the next journey at her table.
Accepting opens **The Open Door**: the Athenian Agora, Colonus Grove,
Eleusinian Sanctuary and Marathon Altar, and the stories at
Piraeus Quays. The invitation opens the roads for every traveler in the
shared world. Piraeus Quays itself lies outside the Open Door: a ship with the
Travel Provisions aboard reaches it, and its roads inland open with the
invitation. Athens Harbor has joined Piraeus.

Roads separate towns, and places inside a town link directly. Between two
towns there is exactly one road or a sea lane, and every walkable road has its
own painting. Athens has three districts: the countryside, the city and the
harbour. The Sacred Way joins the countryside to the city and the Long Walls
join the city to Piraeus. Each is a gate: a route from one end, with a live
condition, replaces that end's exit, and the way back stays open (see the
[Open Door guide](../content/greek-drama/OPEN-DOOR.md)). The Theban Harbor Road is the only way
between the Wine-Dark Harbor and Thebes. The battlefield is a Theban place
outside the walls; the City Gate opens onto it only while the gate guard holds
the Burial Decree there, and the way back in is always open. The Cithaeron
road leads on from the battlefield to Eleusis while a Theban account of the
burial is there or on Dione's table. The Road to Delphi joins the Agora and
Delphi, the Oeta Road joins Delphi and Trachis, the Royal Road joins Troy and
Susa, the Black Sea Road joins Thrace and Tauris, and the Colonists' Road joins
Corinth and Sicily. A road has two fixed ends, shown by destination cards in a
fixed order. Avatars come first in the hand, followed by the first end, the
road, and the other end. Its entry card names the place ahead. Travelers can
meet, wait and carry objects on the road. Myrine walks from Eleusis to Piraeus
one road at a time, along the Sacred Way and the Long Walls.

A place *within* another, such as a house in a quarter, names its parent in
`within`. It links only to that parent and does not count toward the parent's
links.

A pack marks an old road or place `retired: true` to keep its ID for saved
history. No exit leads onto it. A save that stands on a retired road
continues at the road's first end; one at a retired place continues at the
place's one exit, the place that took it in.

Run `npm run v2:card:travel:smoke` for desktop and phone trips through
Piraeus, the Athens–Piraeus Road, the Agora and the return to Dione. The check
also tests the destination cards, a reload on the road and waiting for the ship.

The ship's card follows the same paintings. Aboard, it shows the stage
backdrop: the deck at a port, or open sea by day or night. From a mooring
with a berth painting (the Wine-Dark Harbor, Piraeus, Trojan camp landing or
Signal Jetty), it shows the ship at that berth. Greek moorings follow the hour;
the Signal Jetty keeps its starry sky. The berth's focus frames both the scene
and boarding card on phones. Departures restore the empty shore painting.
Black Pond keeps the authored Black Pond card.

The ship sails authored sea lanes, at most four from each port. Black Pond
has one lane, to the Wine-Dark Harbor. The Wine-Dark Harbor has
lanes to Piraeus and the Trojan camp landing. The Piraeus lane opens only
while the Travel Provisions are aboard, carried by anyone on deck or resting
there. Two one-way lanes keep the way home from Piraeus always open. Aboard a docked ship, the other place cards are course cards. The
first course played sets the voyage for everyone aboard; the ship then spends
one world round at sea. On arrival the only Disembark card is that port, and
someone who boarded there cannot step straight back. Passengers who stay
aboard can set the next course. A ship left with passengers and no course for
three rounds sails its first lane. An empty ship stays where it was left;
waiting at a port to board brings it one lane closer each round. Residents
use the same vessel and leave the course to a human aboard. The lamp signal
still calls the ship to Black Pond. Existing saves keep their positions,
belongings, stories and poems. The design is in
[ship voyages and scattered things](../../docs/design/ship-voyages-and-scattered-things.md).

Selected cards with authored decisions show their legal actions in the row
below the hand. Choosing a history is a committed turn:
Helen's Egyptian and Trojan accounts open different witnesses and evidence;
the three Atreid accounts open different households. Later actions depend on
that choice. Leaving, reloading, or switching tabs preserves the account.

The [pack source and coverage guide](../content/greek-drama/README.md)
documents all 44 works, the executable episodes, and the situated inquiry
hooks. The ordinary card catalog, custody, memory, save, and action system
carry the pack. `pack-registry.mjs` evaluates closed conditions and effects;
story text cannot choose a branch or perform an action.

Earlier schema 6 saves gain schema 7 and the mounted packs through a validated migration
that retains their original state. A save that claims a mounted pack must have its complete,
valid state; it cannot silently recreate missing characters or erase choices.
The existing save slot stays unchanged. Future revisions require migrations.

Dialogue receives at most eight local entity cards and three speakers, with
bounded outcome records and active history embodiments only. The server
adds trusted profiles from the authored source. Existing character model
pins remain required; new pack voices use the configured WorldContent model
unless explicitly pinned in the deployment map. No new provider key or
client-selected model is introduced.

```sh
npm run v2:card:pack:check
npx vitest run test/card-greek-drama.test.mjs
npm run v2:card:greek:smoke
```

The browser smoke exercises the real card interface at desktop and phone
sizes, including choices, save reload, evidence custody, return travel, and
cross-tab updates. Its deterministic speech fixture tests the UI; the
narrative contract smoke separately sends real Greek request contexts
through Rust validation without a paid model call.

## Greek stories

The Theban, Open Door and Ajax stories are told through pack choices: Talk,
Give and Use plays whose effects the rules commit, with receipts saved in the
pack state. There are no story quest cards or story quest records. The Bard's
conversation names his poem and the travelers whose deeds it holds, in the
order of the saved choice receipts. The couplet text is lore in the pack's
`lore/` folder, not prompt text. The [exact copy list](../content/greek-drama/OPENING-POEM.md),
the [Open Door guide](../content/greek-drama/OPEN-DOOR.md) and the
[Ajax chapter guide](../content/greek-drama/AJAX.md) record the scenes.
Packs no longer carry `storyQuests` or `situations`. A story choice is
the listener's own deed: only their Talk commits it. A resident who seeks Vale
out for its own quest can tell the same account, and Vale's later Talk with
that resident still commits the choice, one choice per turn.

Run `node v2/scripts/smoke-card-open-door.mjs` and
`node v2/scripts/smoke-card-greek-homecoming.mjs` for the Open Door and
homecoming journeys at desktop and phone widths, and
`node v2/scripts/smoke-card-ajax.mjs` for the three Ajax journeys, each walked once.
`smoke-card-greek-drama.mjs` also plays the opening poem, where the Bard's
quest to hear Vale brings it to the courtyard, and
`smoke-card-bard-travel.mjs` follows the Bard's own quests along the roads and
through the mask-gated theatre door.

## The bell crossing to the Steam Clock

The Forest Clearing, Badger and the Steam Clock are a world pack
(`v2/content/badger-forest/`) joined to Black pond by a bridge
(`v2/worlds/badger-forest/`). No engine rule names them; see
[`v2/docs/card-packs.md`](../docs/card-packs.md) for the format.

Ring the Bell twice in a row at Black pond to find the Forest Clearing.
The first ring gets one reply: **echo** says **bong**. The second folds
the pond's reflection and unveils a Forest Clearing card; Vale stays at the
pond until the player plays it, then travels with their belongings. Only
Vale takes that way, and no one can be asked along. A different successful
player play resets the sequence; inspecting cards and hearing replies keeps
it. The first ring also survives a reload. The bell must be uncovered.

The second ring opens entry for three following player turns. Another ring
at the pond refreshes that active window to three turns. The ringing bell
must remain physically at the pond, either carried or on the ground; taking
it away or muffling it closes entry. Discovery remains remembered, but the
clearing card disappears when its entrance closes. Reload retains the exact
remaining window. Inspecting cards and retrying dialogue consume no turns.

Badger starts asleep beside the clock. Playing his avatar card wakes him.
His mood, wake cause, memories, and generated conversation belong to the
same world save as the shore cast and items. Ringing beside him annoys him;
quiet turns ease that irritation. His voice stays curt and territorial even after
quiet: concrete complaints, grudging answers, and a firm claim to his warm
patch of moss. More noise makes him terser and more indignant. He answers
useful questions from known facts without turning into a cheerful guide.

The Black pond card in the clearing appears only while a bell is audible at
one of the two shores. Silence removes both the exit and the travel offer.
Choose **Ring the Steam Clock** on the clearing card to ring its installed
bell for three following turns, even if the hand bell was left behind.
Ringing the clock wakes or annoys Badger; it does not move or ring the hand bell.
Once the entrance closes, two consecutive rings at the pond open it again.
The normal card UI handles travel, inventory,
conversation, and history throughout. Earlier shore saves gain the clearing
and its sleeping resident when loaded.

Run `node v2/scripts/check-card-awakening.mjs` for a browser check of the bell
sequence, waking Badger, returning, reloads, and phone layouts. Screenshots
are saved in `output/badger-check/`.

## Shore text and memory

Every avatar, item, and location has a profile in `entity-profiles.json` and a saved memory in the browser world. A memory holds the latest 16 witnessed events, six lasting encounters, and the latest generated text. Gifts, trades, threats, shared trips and quest effects can become lasting encounters. Card plays record events for the actors and objects present, the item used, and both places during travel. Generated speech and descriptions are marked as expressions, so the next prompt can distinguish them from game events. Speech receives recent facts and a few lasting encounters. Each avatar's memories, beliefs and fears give its request or response a personal reason.

Speech receives visible facts, current wants, and witnessed results. Item and place profiles describe appearance; an avatar profile is one seed sentence. Hidden interaction rules stay in the simulation; each avatar's facts can include the quest line described in [A quest stack per avatar](#a-quest-stack-per-avatar). A revealed path joins the location cards; travel happens when its card is played. Earlier opening expressions stay in saved history while fresh speech uses observations until Vale first douses or relights the lamp in the attic, or leaves it.

When a play calls for speech, the browser sends the current local entities and departing avatars, their facts, avatar interests, and eight recent memories, witnessed events, and the four latest spoken lines to `POST /card-game/text`. A speech prompt shows the present rather than a transcript: it leaves out earlier table lines and remembered speech, and keeps one past line only when this turn's Talk is aimed at the speaker, the acting avatar's latest line that the speaker heard. A character's voice comes from its seed sentence, its facts and its own inner life; prompts carry no authored description or example lines. The `repeat` check compares a reply with the speaker's last three spoken lines, which the service reads from its memories, its previous reply and the request's table lines without putting them in the prompt. Thought, persona and dream calls still read remembered speech ([#1537](https://github.com/cenetex/cosyworld/issues/1537)). Facts name only what the speaker has found: a quest or trial target it has not talked with, visited, or (in the browser) uncovered reads as "someone I haven't met yet", an avatar does not retell its own earlier deed unless this Talk tells it, and a persona naming an item kind the avatar was never near is left out. The Rust service adds the authored profiles and uses the existing AI gateway. The deployed character map sends each avatar to its own exact OpenRouter model. Items and places each have their own voice call. These calls run together inside one bounded scene request. Each call returns a brief plain-text reply, which the service validates before publication. A short unpunctuated reply can pass when the provider confirms it finished. A trailing continuation mark or an unfinished first line triggers the usual retry. Complete sentences and voluntary quotations keep their wording. Each entry carries its own model attribution. Raising a card prepares a play and keeps the current conversation. Playing a card commits the action; social actions and travel can start an exchange, while ordinary object manipulation can remain silent. The place, played item, and chosen speakers also receive scene beats. A quiet turn with departures gives the words to the moving cast, without an automatic Vale recap. A Stay without departures keeps Vale available. Direct interactions, combat, travel and introductions retain their relevant speakers. The departure action stays in the source scene. Words are written after the move commits, so a departed avatar's line is recorded at the destination with that place's cast; a player left at the source never sees it, and the waiting portrait does not name them there. The prompt includes the completed card play so their lines form a question and answer or a shared reaction. A separate resolved-turn record gives the played verb and outcome, every avatar's final location and holdings, exact travel companions, and final item ownership. Accepted accompany plays record both travellers; independent trips record an empty companion list. Current results take priority over desires and remembered speech. When Vale speaks on a wait play, the words stay at the place where Vale stayed. A solo farewell frames desired company as a hope for later.

Each server voice call writes one `card voice call` log record with the entity, part, attempt count, outcome (`spoken`, `untold`, `silent` or `cancelled`), each attempt's rejection reason, and approximate prompt tokens (characters / 4) for every section: `system`, `now`, `facts`, `directions`, `memories`, `earlier`, `conversation` and `inner`. It never records prompt or reply text. `GET /meta` reports the same counters since the process started under `card_voice`. `npm run v2:voice:eval` builds every prompt for the narrative-contract scenes and a scripted station conversation, prints token and section statistics, and replays the recorded replies in `test/fixtures/card-voice-replies.json` through the validator. The eval also counts first-person possession and deed claims that the resolved turn does not support (`false_claim`); the live validator does not check those yet ([#1537](https://github.com/cenetex/cosyworld/issues/1537)).

The dialogue is a depth stack of beats, not a chat log: the current beat in front and one earlier beat behind it ([dialogue beats](../docs/card-table/dialogue-beats.md)). Earlier visits are in the optional Memory panel, which builds its portraits only while open and drops them when closed. The browser buffers each exchange until it passes validation, then reveals complete letters on a local clock with short pauses at punctuation. The selected speakers take their turns in order. Each exchange advances after a reading pause. Tap the front card to finish a line, then tap again to bring the next speaker's beat in front. The hand pauses for up to 2.5 seconds while words are generated. A slow request can be replaced by another play. Once a complete reply arrives, the hand locks through scene preparation and every speaker, then becomes ready after the last reply. A blinking cursor marks the end. Tap the card behind, press ↑, scroll or swipe down to step back in time; tap the front card, press ↓ or swipe up to step forward, or use ● live. A replayed line stages the avatars present now; a speaker who has left keeps the words and stays off the stage. Vale, Mara, Pip, the Keeper, Badger, and Dione speak with their original cloned voices when OpenRouter is connected. Settings toggles voices. Other speakers keep their soft, pitched voice sounds. Reduced motion shows full lines at once. Hidden tabs and open menus pause playback, including the rest of a punctuation pause. Text reveals on browser paint frames. Each visible line keeps its own height, and portraits stay mounted when the speaker changes. Empty prior replies and speech rows collapse. A scene with no words shows a compact loading line. A spoken card play immediately shows its first speaker with a loading mark. The waiting portrait names whoever speaks next, in speaking order: after Talk or Ask, the player's avatar thinks first, then the reply partner thinks while a streamed reply is still being written. Shared play waits on the acting avatar. The browser saves complete text before playback begins. Fresh tables request an opening exchange: at turn 0 the browser asks `/card-game/text` for Vale's first line, with no action and Vale as the only speaker. The World narration from `forest.json` stays as the authored scene-setting event. If that request fails or times out, Vale shows the unsaved silent "…"; Retry dialogue asks the model again. A reload keeps the Retry dialogue control instead of asking again, and a save from another tab never starts a request in this one. Shared worlds have no browser opening line; their server publishes speech. Reloading resumes saved dialogue from the current turn. If the current turn's words failed before the reload, the dialogue panel keeps its Retry dialogue control. Action records remain in the saved world and scene export. A declined Give, Trade or Ask appears as a caption on the giver's beat and in Memory. Every Give and Trade sends its recorded answer as `accepted` in the resolved-turn record, so the cast can voice a refusal.

The stage holds up to three avatars. Vale stands in the foreground, with the other two farther back. The composition mirrors when Vale returns from the other side of a route. Seats and sizes stay fixed throughout an exchange. The speaker and listener face each other; another witness looks toward the speaker. The keeper has a separate right-facing cutout, so the clock face keeps its painted detail. A soft lean and light change mark the speaker. Carried item symbols follow recorded custody, including covered items. A figure carrying a lit light holds it up in its hand cutout while no card is raised, so Vale wakes visibly holding the lit lamp. Things lying in the current place, whether put down or there from the start, stand on the painted floor as untappable props: the bare item cutout from the hand card, hand-sized beside the cast, behind the avatars and clear of the dialogue. Each keeps a stable spot from its id and the place. Wide screens show up to six; narrow and short ones show up to three. Every such thing keeps its hand card, and a prop leaves the stage as soon as someone takes it. Actual arrivals fade in together for an accepted accompany play. Quiet actions update the stage cast immediately to match the hand and current locations. Reduced motion uses still poses. The scene script exports each actor's position, depth, scale, facing, gaze, pose, travel companions, and carried items for each beat, plus the floor items and their spots. The browser uses `portrait-facing.mjs` to match each painted portrait to that gaze. This presentation-only map covers the human cast, pack portraits and Keeper variants; add new portrait files here with their native direction. Hand thumbnails keep their native artwork. A pack resident may list `poses`: each names a portrait in the pack, a place (`at`), saved conditions (`requires`), or both, and an optional stage `scale` from 0.3 to 1. The first pose that holds replaces the standing portrait on stage. Poses read committed state only, so local and shared tables show the same sprite; `portrait(id, null, world)` in `scene.mjs` returns its path, and `residentPose(world, id)` returns the chosen entry. The Swede sits by the fire at camp, listens at the bank and once the humming has been heard or the watch is chosen, and looks worried after the signs are shared. A pack place may list `backdrops` the same way: each names a backdrop in the pack and saved conditions (`requires`), and the first that holds replaces the place's `backdrop`. A hub place in `forest.json` may list `backdrops` too; the same lookup tests them against the forest rules, as for the lit or doused attic. `placeBackdrop(world, id)` in `scene.mjs` returns it. State entries name their own lighting through `daylight` conditions; a matching painting is final, so the ordinary night table cannot erase an observed sign. Backdrop conditions use the same closed vocabulary as crossings, including weather and ship position. Crossing scenery takes priority; an unmatched base keeps the existing day/night fallback. A place whose backdrop conditions name daylight uses the saved clock for scene lighting and day/night crossfades, including before a sign is known; an unmatched sign keeps its ordinary painting.

A raised card keeps the current conversation in place. Playing a destination starts the new visit. Room memories and the previous response follow that visit; earlier visits stay available in Memory. While a Talk or Ask reply is pending, the waiting speaker's card is in front with Thinking and their committed actions; the card behind steps back to earlier beats and ● live returns to the wait, in local and shared play. Fresh dialogue waits for the backdrop, avatar images, and entrance motion to settle. The travel screen fully covers the source before the destination is drawn. Arrivals begin after that screen clears, and dialogue begins after the arrivals finish. Agreed companions enter together; independent followers enter a moment after Vale. Beat captions distinguish followers, companions and departures, including with reduced motion. The same order applies when reopening a saved game. Media waits have a time limit. A reset or a save update cancels the travel screen and its waiting entrances.

The card rules still commit movement, trades, quests and inventory. The text response updates memories and scene lines. Revision checks discard old replies. Each ready exchange finishes before the next card action. Selecting cards prepares a single play or a combination. The scene and both conversation lines stay on the completed play until the next play is committed. Departure captions sit on the departing character's beat. A temporary speech failure retries the same completed turn once after a short pause. A 429 is never retried: the browser shows Retry dialogue, and its next request waits out the `Retry-After` time. Only one request is in flight for an unchanged scene. Both attempts share a thirty-second limit, allowing the server its full twenty-five-second deadline. The hand becomes available during a slow request after its 2.5-second pause. Reset and save updates cancel the active attempt and retry pause. Completed replies reach playback as soon as they are validated, while stream cleanup finishes separately. A retained line follows its event ID when the history window trims older events. The window keeps the latest 100 game events and, separately, the latest 100 generated lines, so generated text never shortens the history the rules read. The latest arrival also stays on the world, so the stage keeps Vale's entrance side after that event leaves the window. After both attempts fail, the hand becomes playable and the failure remains visible even if the scene has no earlier words. Retry dialogue requests the same completed scene without spending a turn or moving anyone; a later card play also tries again. Incomplete responses remain failures, and stale or cancelled replies cannot overwrite the current scene. A replying speaker whose words do not come shows "…" on its beat and in Memory; that line is not voiced or saved. In shared play the acting avatar's line is still required (otherwise Retry dialogue), while a silent reply passes and the scene record lists it under `silent`, and every client in the room shows the same "…" after that scene's spoken lines on the shared reading clock. `v2/scripts/smoke-card-silent-reply.mjs` checks the local path at desktop and phone width. A new game or a save update from another tab cancels the old request.

Schema 6 saves include location changes, favours and lasting memories. Earlier saves keep their positions, items, current programs, earned steps and generated speech. Conversation exports include only the speaker and text of spoken lines.

## Opening in Mirror attic

New browser tables and shared worlds use `createWorld({ opening: true })`.
Vale starts alone in the lamplit attic with a lit lamp; the mirror shows only
the room. Dousing the lamp reveals the Black Pond and the path through
the mirror: leaving means choosing the dark (#1600). Vale reaches Black pond by playing that path card, meets Pip,
and can follow the shore to Empty station and the keeper.

Empty station connects to Black pond. Mirror attic connects to the pond through
the reflection. Leaving the attic requires the lamp in the attic, not shining
(doused, dry or covered). Returning needs a lit, fueled, uncovered lamp at the pond. Both are
`requires` data on `forest.json` `reflectionRoutes`; the attic's `backdrops`
paint it lit, doused, or dark without the lamp; the stage dims those paintings only at night. The Black
cloth in the lit attic, or any traveler's scarf carried by someone there, also
reveals stairs down to Cosy Cottage. The two ways never open together: lit with
the cloth or a scarf offers only the cottage, lit without either offers neither,
and dark offers only the pond. The lit attic keeps its lit
painting, whose mirror shows only the room. The cloth can lie in the room or
travel with someone or something there. The cottage's
stairs back up stay open after either item leaves or the light goes out.
A stranded traveler in the attic still finds a narrow rescue path to the pond
when the lamp is out of reach. That escape is separate from the
mirror and cottage gates.

Each newly met card joins its stack covered until the first tap. Travel loads
the destination scene before its cards and dialogue; uncovering never delays speech.

New attic openings carry version 1. Saved pond openings carry version 2 and
retain their original purposes and discovery records. Saved positions, belongings, meetings
and earned progress survive loading. The current routes apply to every save.
`createWorld()` retains the station seed used by older simulation fixtures.

## Shore experiment

Every world keeps motives. Vale, Pip, and the Keeper use the same cards,
locations, items, ownership rules, and turn order. Their quests and motives
remain internal; the player encounters people and their observable actions,
not task dashboards.

Pip values warm light and fine clothes. The Keeper values quiet, the bell, and returned belongings. Vale likes interesting routes and a decent bargain; the player chooses Vale’s actions. Fuel, oil, ownership, and recent slights change what matters now. A cast member scores legal actions to seek an object, trade, ask, tend a lamp, or travel. Its preferred place becomes attractive once its main interest is met.

### Fuel and oil

The lamp burns one fuel each lit turn and holds twelve. There is no pour play.
Whenever one avatar holds both the Oil flask and the Lamp while the lamp is
empty, the oil fills the lamp to twelve at that point in the play. The flask
then leaves that avatar's hands and stands full again on the ground at Empty
station, the keeper's home. A flask has no dose count: one flask fills one lamp.
The rule is data in `forest.json`: `things.oil.refuels` names the lamp and
`things.oil.returnsTo` names the station. A `refuel` narration event records
`actorId`, `itemId`, `targetId`, `itemIds`, the `locationId` where it happened
and the `returnLocationId` where the flask waits. The Bell rings as before but
no longer makes oil at the pond.

Trades compare each character’s value for both objects, including attached cloth. A grievance raises the requested price. A favour can lower it. Ringing beside the Keeper, spoiling Pip’s light, threats, and repeated requests can create grievances. Only witnesses remember a slight. A useful gift softens the receiver’s grievances toward its giver and earns a bounded favour. Grievances retain the other avatar, incident, turn, and strength across reloads.

Give and Trade are always offered when the item fits in the other person's
hands; a trade needs room on both sides. The answer comes when the card is
played. The same willingness tests as before decide it. A refusal takes the
turn and moves nothing. It records `accepted: false` and one reason: `grudge`,
`needs-it` or `wants-something-else`. Ask and Accompany refusals commit the
same codes. The log says only that the other side declines; the narrator brief
passes the code to the cast, so the refuser's own line says why. Plans carry no
reason text, and a player's Wait is an ordinary `wait` action entry. The
residents' planner reads `expects(s, action)` to skip some offers it expects
to be refused.

Accompany requests use the companion's quest, the items carried by the requester, favours, and grievances. An agreed trip moves both avatars and their belongings through the usual rules. A refusal leaves both in place for that exchange. The other cast member takes its own turn.

Tastes shape prices; a remembered grievance raises a price, refuses company, or prompts a retreat. A quest item is worth more to the avatar that wants it, and nobody trades away its own quest item. Generated speech receives exact outcomes and witnessed grievances.

A hub thing may name its own `art` (the card and stage image) and a `view` (a larger image). Once its card is uncovered and selected, the action row offers **Look**, a client-only overlay of the view: tap the image to zoom, tap outside it or press Escape to close. Look plays nothing and never reaches the rules. A save written before a hub item existed gains it at its `initialState` holder on load. Every load reconciles the save with the current content: a missing authored thing joins at its authored holder, a thing the content no longer defines leaves and whatever it held stays with its holder, and a retired crossing closes. A save that still cannot be read offers New game instead of an error.

At the station, Vale can take the bell. The Keeper values the bell more than the oil and accepts that pair. Ring the bell beside the Keeper first and the price rises. Pip values the lamp more than the cloth. These competing tastes let the same objects support several bargains.

The hub cast's tastes, home and item values live in `forest.json` under `people`, beside the pack residents' `tastes` and `values` in their card worlds. Each named avatar also has one authored `want`, `{ "kind": "item" | "place" | "person", "target": id }`, which names what it seeks first: Vale wants the lamp, Pip wants it lit (`"lit": true`), the keeper wants the bell. A lit item want is met only while the item is in the avatar's own hands, lit and uncovered; a resident holding it otherwise takes off the cover, then lights it, so a moth keeps its flame where the stage and the mirror can see it. Pack residents with a `desire` carry a matching `want`, which the pack schema checks against the pack's and hub's items, places and avatars. The rules don't read `want` yet.

Situational worth is data too. A hub thing in `forest.json` may carry `valueRules`, and a person may carry `valueRules` keyed by item: each rule lists facts (`{ "item", "field", "min" | "max" }` or `{ "holds": item }`) and adds to the value or `set`s it. The empty lamp, the oil a dim lamp's holder needs, and the cloth the keeper wants while the bell rings are three such rules. A person's `grievances` list names the plays that offend them (`on`, partial action patterns) and the remembered `reason`; the keeper's ringing and Pip's spoiled light are two. A pack resident's `tastes.noise` is the same rule for a rung bell. The planner has no lamp special case: a resident in the lit attic waits until a play douses the lamp.

## Local play

Run the Rust server with `COSYWORLD_PRIMARY_GAME=cards` and the normal AI provider configuration. It serves both the game and the text route. For the lightweight card server, set `COSYWORLD_CARD_TEXT_ORIGIN` to the Rust server's origin before running `npm run play:cards`. Provider credentials stay in the Rust service. `COSYWORLD_CARD_TEXT_MODEL` selects a registered world-content model for this card table. Both production sites use `openai/gpt-6-luna` with `COSYWORLD_CARD_TEXT_REASONING_EFFORT=none` for short scene text.

The endpoint accepts at most 64 KiB, fixed entity IDs, eight local entities, and bounded facts and memories. It allows two model requests at once, 30 requests per peer per minute, and 1,200 requests per process per hour. Same-site browser requests pass the origin check. Model calls have a 25-second deadline. Clients send `Accept: text/event-stream` for live text deltas followed by a validated `complete` event with all entries and the resolved model name. Other clients receive the full JSON response. Disconnects cancel the provider request and release its capacity.

## Learning and inner life

Open **Menu → Inner life** to read your avatar's inner life as a short chain:
**I'm** (the authored name and title, "I'm Vale. The Lamplighter."), **I'm
becoming** (one current intention: the newest grounded thought, else the
persona) and **I dream** (recent dreams), closed by the avatar's name. Lines
that read as an assistant talking about the scene are hidden, and so are
lines that are not first person, break their quotes, or name an item kind
the avatar was never near ("my compass is ready"). A quest target the
avatar has not found reads as "someone I haven't met yet". Measured attempts guide the planner and stay in
the save; the panel does not show them. Each avatar keeps up to 32 completed plays for item and
companionship goals. The record includes the goal, the chosen action, the
estimate before the play, the observed result, and the exact event as evidence.
The first estimate is unknown. Later estimates come from that avatar's results.

The action chooser compares those results across legal requests, trades, gifts,
conversations and waits. It gives less-tried approaches room to establish a
record. Recent results matter more. A changed situation gets fresh exploration,
with earlier results providing a small starting estimate. The same present
world can therefore produce different choices for avatars with different past
results. Repeated failures can lower a once-successful approach's value.
A ready trade keeps its known value for completing the goal. Another approach
can replace it when its learned value is higher.

Reaching the goal earns twenty points; improved trust or eased grievances earn
two points per step; each carried item is worth four points; each play costs
one point. Exploratory gifts preserve the item the current quest needs. Up to four linked plays share a
later result with a 0.7 discount per step. A changed recorded situation or a
completed goal ends that link. Human choices and resident choices use the same
measurement path. Earlier lessons remain readable in existing saves.

Solo and shared avatars reflect when they choose **Wait** after something
new has happened to them. Other plays never start a reflection. A new thought
informs the persona revision. A dream may come with the thought, alongside the
persona. Each accepted revision keeps its source events, previous persona and
the model used for each part. Four revisions stay in the save. Thoughts stay at
least six turns apart. A dream needs two thoughts since the last dream and at
least 24 turns since it. These gaps apply in both modes. Shared publication commits the
reflection with its speech through the world journal. Retrying the publication
keeps its original play identity. The server rejects a thought, persona or
dream that is not first person, carries a `," she called` tag, or names an
item kind the scene does not know ("my compass is ready"). It also leaves a
kept thought or dream that names such a thing out of later prompts, so a
retired item in an old save does not return.

The server sends a player their own inner life and lessons. Resident inner life
stays in the simulation. Other characters' public words remain on their cards.
Conversation prompts include each line's witnessed audience, so a later arrival
learns an earlier exchange through a new conversation. Older prompts use that
avatar's recorded expressions as their witness evidence.

Shared rules version 18 adds measured action values and exploration. Versions
2–17 retain their released interpreter bytes. An explicit upgrade keeps the
existing world, possessions, quest, memory and persona.

## Your OpenRouter account

Hover over the CosyWorld title to reveal the video camera. Keyboard focus also
reveals it. Phones show the camera beside the title. Click it to film the last
two displayed dialogue lines. The video uses the current place, character
appearances, visible items, their holders, light, and other visible states.
The default model is TBC Mischief 1 (`tbc/mischief-1`); Settings can choose another.
The current stage supplies a reference frame where the model supports one.
The clip aims for ten seconds and uses the nearest supported model duration
(five seconds for Mischief 1).
The camera uses the player's OpenRouter credits. Its window shows progress,
playback, and a download link. Stop waiting ends the browser wait.

Connect OpenRouter opens a separate sign-in window. The callback carries its
own state value. It returns the connection to the original game tab through a
same-origin browser channel. The game stays open during approval. A browser
that blocks the window uses the same-tab PKCE return.
The sign-in page loads before it opens OpenRouter. A Continue to OpenRouter
link supports browsers that ask for another click before leaving the page.
The return accepts the approval code and state on its saved callback path.
If the provider replaces the query, the browser restores the original game
link after it checks the state. The PKCE verifier stays in the game tab.

Open Settings and choose Connect OpenRouter. The browser uses an S256 PKCE
challenge and a fresh state value. The return must match the stored callback and
arrive within ten minutes. The browser clears the return code before exchange.
The connected key lives in session storage for that tab. Disconnect clears it;
the OpenRouter keys page offers revocation and spending controls.

Normal dialogue uses the server's OpenRouter key in local play and shared
worlds. Each character keeps their authored model and account routing settings.
The server generates and checks the words. Saved shared plays and retries use
the server, including plays queued by an earlier browser-funded session.

Speech audio and video use the connected player's OpenRouter account directly
from the browser. The player's key stays in browser session storage.

The media section accepts a prompt, audio model, voice, and video model. The
model lists come from OpenRouter. Each Create button uses the player's credits.
Audio uses `/audio/speech`. Video uses `/videos`, polls the job, and fetches
the fixed OpenRouter content path. The player can play and save the result.
Stop waiting ends browser polling; submitted work remains in OpenRouter activity.
A failed, cancelled or expired job stops polling and shows OpenRouter's reason.
Rejected requests (400, 422) and provider errors (5xx) add OpenRouter's message.

## Threats and standoffs

Avatar cards offer Talk and Threaten. A threat opens a standoff between the two avatars and adds Brace and Strike to their cards. Each has four resolve. A strike removes two resolve between equal levels, three against a lower level, and one against a higher level. Brace softens the next hit by one, with a minimum of one damage, until that avatar's next play.

A threat stays in force until both sides have stood down: each fighter's latest play is something other than Strike or Brace, such as Talk or Wait. One side standing down alone leaves it open, and a Strike or Brace, by either side, never counts and takes that fighter back into the fight. Releasing the disputed item settles it at once, so handing over the demanded item is still the quick way out. While a standoff is open, its whole room is locked: nobody present, fighters or bystanders, can move, accompany, set a course, take, drop an item, give, trade, ask or cover. The only exception is that the threatened side may hand the demanded item to the challenger, which ends the standoff. Newcomers may still arrive and are then locked in. Bystanders can still Talk but cannot Strike. Residents stop wandering until the standoff ends. The hand shows only the people, plus the demanded item. A resident strikes while the other side is still fighting, once blows have landed or when it is the challenger that wants the item; once the other side stands down it stands down too. One that has set the item aside lets it go. The [standoff endings note](../../docs/design/standoff-endings.md) has the reasoning. At zero resolve, the losing avatar drops the disputed item (or an item the winner needs) and retreats along an open path. Both avatars get three turns to recover before another threat. Saved levels retain their combat effect.

The cast braces, answers strikes, or steps back. Threats, hits, releases, and retreats enter witnessed memories. A threat also leaves a personal grievance. Earlier saves gain an empty standoff state.

### Repeated defeats

Each avatar counts its defeats in a row in `defeats`. A win clears the count. Only a rest at a sanctuary changes the count: any Wait there clears it, for players and residents alike and at any time. For a player that Wait is a long rest. A Wait anywhere else leaves the count as it is. A resident's rest where it just met a want clears nothing unless that place is a sanctuary. Nobody rests during a standoff.

### Rest and sanctuary

Each world has one sanctuary, marked `"sanctuary": true` on a place in its pack data (the Mirror attic for the reflected shore; Badger's glade is part of the Lonely Forest, whose sanctuary is the Cosy Cottage; the Willows has none). Wait is the only rest. The player's Wait at a sanctuary is a long rest: the avatar sleeps until the next light change (`actor.sleepUntil`), its only play is Wait until then, and on waking its defeats clear and the wait event carries `rest: "long"`, which makes a thought and a dream due. Solo play runs the world on until the sleeper wakes; in a shared world the others move the clock. A sanctuary allows Threaten but never Attack. Resting gives no experience. See the design note on [#1648](https://github.com/cenetex/cosyworld/issues/1648).

- Defeats one and two: the loser drops the disputed item and retreats, as above.
- Defeat three: the loser drops everything they carry where they fell, their own belonging included. Then they go home. Nothing goes home with them, and the count clears. An avatar without a reachable home retreats instead.

Going home this way crosses nothing. It does not discover a crossing, move a crossing's signal, or anchor the attic during the opening.

Every home has a way out for its own avatar. The attic and each visitor's home open a narrow path to Black pond when the lamp or belonging is out of reach. Getting back in still needs the lamp or the belonging. A test checks every active home with empty hands.

### Fight events

Strike is the rules action `attack` and Brace is `guard`; the table renames only the words, so saves and the journal keep those kinds. The attack action (`kind: "action"`, `verb: "attack"`) records the hit:

```js
{
  kind: "action", verb: "attack", actorId, targetId, locationId,
  damage: 2,               // resolve removed
  guarded: false,          // the defender's guard softened the hit
  resolveBefore: 1, resolveAfter: 0,   // the defender's resolve
  outcome: "hit" | "guarded" | "yield" | "sent-home",
  lossCount: 1,            // the defender's defeats in a row after this hit
  droppedItemIds: ["lamp"], // only when outcome is "yield" or "sent-home"
}
```

A defeat that moves the loser adds one more entry. It is not dialogue, and it is not the player's chosen play:

```js
{
  kind: "narration", verb: "retreat" | "sent-home",
  actorId,                 // the loser
  targetId,                // the winner
  fromLocationId, locationId,
  droppedItemIds, lossCount, witnesses,
}
```

When the loser is the current player, the entry also sets `world.arrival`. A loser with nowhere to go stays put, and only the attack records the outcome. Both entries keep their English `text`.

### Seeing a fight

A standoff play is shown beat by beat before the new world is drawn. Each beat opens with a telegraph above the actor (a warning sign for Threaten, a shield for Brace, crossed blades for Strike) and a stage caption such as "Pip strikes Vale…". Before the first frame the two fighters turn to face each other, whoever they were watching, and fighters in an open standoff keep facing each other between plays. The stage pushes in and dims. An attacker lunges, the target holds for a short hit-stop, recoils, shakes once and brightens once (no red). Resolve pips under each fighter drain with a lagging ghost, an outcome word ("−2 resolve", "Braced −1", "Yields") rises over the target, and the step joins the beat stack and Memory as that fighter's beat. Fighters in an open standoff keep their pips between plays. The hand drops to a sliver the moment the strikes or the travel screen begin, cannot be tapped while down, and rises once the new scene is drawn. In shared play another player's strike or move drops it only while those beats lock the hand anyway. Reduced motion lowers and raises it without the slide. The dialogue sinks with it, below the fighters (a strip at its foot beside a resting desktop hand), and rises with it for the speech that follows; reduced motion fades it out and back instead. Plain talk never lowers it. Captions lowercase a name's leading article mid-sentence ("Vale strikes the keeper…").

Published brace (`guard`), strike (`attack`) and hit paintings follow those beats and preserve the player's plain or scarf wardrobe. A committed brace keeps its raised-arm portrait until consumed or cleared. Beat images preload before playback; unavailable art keeps the existing portrait. The Keeper uses his unmirrored right-facing neutral portrait when the scene faces him right, since his combat paintings face left. Combatants fit inside the phone frame throughout a beat; Pip and the Keeper keep that framing between plays too. Carried props stay in their cards while combat arms are raised, and the normal portrait and framing return when playback ends or is cancelled.

When the player loses, their figure slumps and greys and a defeat card ("Pip drove you off") lists what changed: dropped items, standoffs lost and "Sent home" on the third loss. The card is announced and waits for Continue. The scene then fades to "You come to at <place>", and the player's beat repeats it. The arrival line comes from one voice: a resident at the new place, or the player's avatar when nobody else is there. Its brief is one short fact: "Vale was beaten by Pip and came to at Empty station. Say one line."

Tapping the stage finishes the current beat; its outcome text still shows. Settings › Fight speed switches between 1× and 2×. A full fight stays under three seconds at 1×. Reduced motion replaces the cut, lunge and shake with outlines and fades and keeps all text. The flash follows "Flashes and scares". Local and shared tables play the same beats from the committed log (`combat-beats.mjs` reads the rules' structured attack and retreat fields, falling back to standoff state and the rules' lines; `combat-view.mjs` draws them).

Run `node v2/scripts/smoke-card-combat.mjs` for a lost standoff at desktop, phone and reduced motion.

Card selection keeps the current card elements in place and leaves keyboard focus on the tapped card. The hand and action row open together over 220 milliseconds; held items slide out from their owner. A play in the same place refreshes the cards as the hand lowers, with each name moving into its resting position. Travel changes the hand under the scene veil. Rapid taps reverse the current motion. Reduced motion applies the final layout at once. Menu and Memory keep the selected cards and open items, and Escape closes the active panel before lowering the hand. Only a click on empty table space (the stage, outside the cards and the dialogue; not the toolbar or action row), Escape, or a play folds the hand to its resting row. A click outside keeps the selection and any chosen play; the next tap on the hand only raises it again as it was. A tap on the dialogue steps its beat and leaves a raised hand raised. Nothing but the player's own action moves the hand: new beats, shared updates and another tab's save leave it, and its scroll, as they were (a card that leaves the table drops out of the selection). Selecting, changing the pair and deselecting keep it open, as do the scroll arrows and empty hand space. A held item stays raised with its plays, and any tap on the folded hand opens it again. Short landscape screens keep the hand inside the viewport.

A ready or pending play's buttons sit under the dialogue, above the hand. The hand never moves for them: the dialogue rises to make room, and nothing lies between the cards and the screen edge. Beside a resting hand on a wide screen, the buttons sit under the dialogue on the left. A strike or journey that drops the hand takes the buttons with it. The action bar's status line (#1725) sits in the same spot, above the buttons. Captions name a thing with one article: "Vale took the Burial Decree". `node v2/scripts/smoke-card-action-spot.mjs` checks the spot at 1440, 390 and 844 px.

Run `node v2/scripts/smoke-card-actions.mjs` for Chromium controls, or `CARD_BROWSER=webkit node v2/scripts/smoke-card-actions.mjs` for WebKit. The checks cover desktop, phone, short landscape, reduced motion, fast taps, panel dismissal, and save updates.

When the lamp, or the flask an empty lamp needs, is trapped beyond the attic, a narrow path can open from Black pond. It appears after reachable lamp remedies are exhausted. A traveler inside can still fill the empty lamp by holding it with the flask. Every object keeps its holder until a play changes it. The Black cloth and local lamplight reveal the cottage stairs from the attic.

### Later: humans fight in shared play (#1511)

Today `legalActions` never offers Threaten against a human-controlled avatar
when sharing is on (#1177), and visitor avatars have `standoffs: false` in
`human-cast.mjs`, so a human can only lose a fight they started against a
resident. #1177 added both as a launch default with no recorded reason.
Owner decision (generic, deterministic, fair to an idle human):

1. Remove both restrictions. The ordinary threat, brace, strike, defeat and
   sent-home rules apply to humans.
2. **An unanswered human is not struck.** Strike is not offered against a
   human defender until that human has made a play after the threat. Any play
   answers, including Wait, Brace, Talk or leaving.
3. **No double strikes against a human.** After a hit on a human, the striker
   cannot strike again until that human has played. The room queue already
   serializes plays and `play` rechecks legality, so a queued second strike is
   refused.
4. **An unanswered threat lapses.** If the human defender has not answered
   three world turns after the threat, the standoff ends with no loser and the
   usual three peace turns.
5. **Home is safe.** A human at their own home cannot be threatened. A
   visitor's home is private and the sent-home loser lands there, so no one
   waits at a spawn.
6. Item drops and sent-home follow the repeated-defeats rule above. A
   visitor's home keeps its rescue path to Black pond.

Residents defending against a human keep using their quest plan; humans choose
their own Brace and Strike. Evidence: `test/card-combat.test.mjs` cases for
human vs human, human vs resident both ways, an idle defender, a visitor sent
home and home leavable; a new shared rules version with released bundles
pinned; JS/Rust `card_shared` agreement; a shared smoke with a two-human fight.

## Accompany requests

Pair a nearby avatar with an open location card to ask them to accompany Vale. Either card order works. Tap the Accompany button beneath either raised card to play the request. Pairing Vale with a location offers travel there. Pairing a carried item with the current place offers to put it down; pairing a lamp or bell lying here with the current place offers to light, put out or ring it where it lies.

The invited avatar weighs its own interests, the requester’s belongings, remembered grievances, and favours. Standoffs and recovery also shape the answer. Accepted requests take one round. The pair resumes its own choices on the next play. An invited resident can use an open crossing back to their own part of the world. Their belongings stay with them on that return.

Requests record the destination and the answer in the scene script. Both places, witnesses, avatars and carried items remember an agreed trip. The same model request writes Vale's invitation and the invited avatar's reply from the completed result, desires, personas and memories.

## Action, travel and fresh goals

The dialogue service gives the model a plain account of every recorded trip and a direction for Vale's chosen action. Threats keep their pressure, attacks keep their commitment, and guards hold a defensive stance. A later player choice can change that stance. Separate trips to the same destination remain separate arrivals in avatar speech, item descriptions and location narration.

Run `node v2/scripts/smoke-card-pond-access.mjs` to check lamp custody, quiet departures, both mirror directions (douse to leave, hold it lit at the pond to return), the lit and doused attic paintings, reload and relighting at desktop and phone widths. Run `node v2/scripts/smoke-card-dialogue-timing.mjs` to check the first loading speaker, card locks through each reply, and the cast after quiet actions. Run `node v2/scripts/smoke-card-beat-stack.mjs` to check the beat stack at desktop and phone widths, with and without reduced motion: a new beat arriving in front, tapping behind to step back, tapping the front card to finish a line or step forward, the live count, and Memory. Run `node v2/scripts/smoke-card-movement.mjs` to check visible entrances, the travel screen, arrival beat captions, and reset during travel with fast and delayed replies. The card table still keeps its rules and inventory in the browser; `/card-game/text` only generates validated text and does not authorize movement.

Run `node v2/scripts/smoke-card-dialogue-recovery.mjs` to check visible service failures, same-turn retry, incomplete responses, later plays and reload at desktop and phone widths. It uses local fixture responses and makes no model calls.

Music loading starts when playback is ready: after the first accepted play,
with music enabled and the page visible. A place triggers a song when music
is idle. Each song follows the player through travel until it ends. The current
place chooses the next song. A quiet place lets the player hear the landscape.
Mute and hidden tabs pause the same song for a later resume. River Camp chooses
one of four supplied acid jazz songs during the day. An active camp song keeps
playing through dusk and night. Run `node v2/scripts/smoke-card-music-network.mjs`
for the throttled request and first-sound checks. `test/card-music.test.mjs`
covers songs that follow travel.

Room music starts with the first accepted card play in a new game. In a shared world, each avatar starts in silence until their own first accepted play, such as picking up or using their item. The saved play journal keeps that choice across reloads. The opening scene and menu wait for that play. Starting another new game resets this wait and keeps the saved music and volume settings.

## Character models and inner life

Both Fly configurations set `COSYWORLD_CARD_CHARACTER_MODELS_JSON`:

| Character     | Stable OpenRouter model                    |
| ------------- | ------------------------------------------ |
| Vale          | `openai/gpt-6-luna`                        |
| Pip           | `openai/gpt-6-luna`                        |
| The keeper    | `anthropic/claude-haiku-5.5`               |
| Grumpy Badger | `mistralai/mistral-small-3.2-24b-instruct` |

The map covers the authored cast. Each model also has an explicit world-content
entry in the operator registry. The narrator keeps `COSYWORLD_CARD_TEXT_MODEL`.
Assignments depend on the character ID, so they survive turns, saves, reloads,
restarts and changes in who is present. Operators can change an assignment by
editing the map and its registry entry together. Hosts with the character map
unset use the default world-content model for each voice. Mounted pack avatars
inherit that default unless their ID has an explicit model assignment.

Character calls send reasoning effort `none` when the registry entry declares
`reasoning`, so GPT-6 Luna and Claude Haiku 5.5 answer without thinking inside
the call and scene deadlines. A registry entry with `"temperature": false` makes
the gateway omit sampling temperature for endpoints that reject it.

Each avatar call receives the public scene plus that avatar's own witnessed
memories, current persona, thoughts and dreams. Other avatars' inner lives stay
with their own calls. The only authored identity is one seed sentence, such as
"Vale, the Lamplighter." ([#1673](https://github.com/cenetex/cosyworld/issues/1673);
[seed sentences](../docs/card-table/seed-sentences.md)). Current actions,
possessions, travel, wants and relationships come from the resolved simulation,
and the rest of who an avatar is grows in its inner life.

An avatar reflects when it chooses Wait after a new witnessed event; the scene
names that avatar as `resting`. A reflection supplies a thought and an evolved
persona. The thought and persona prompts also carry the avatar's hope, its wish
and next step, from the life rules. Sleeping and waking state still comes from
game facts. Each field has its own brief completion. Public lines enter the
queue first.

Dreams run raw. They have no system voice, scene, persona or hope. The prompt
lists the avatar's kept dreams, oldest first, so each dream can lead into the
next one. The dreamer and turn then seed what drifts in: sometimes the latest
thought, a few words from a random memory, or a one-line sketch of someone met
that day. Dreams use a warmer sampling temperature. A new thought colours speech
for six turns. A dream colours speech for two turns after waking.

The browser saves the current persona and the latest four thoughts and four
dreams per avatar beside the existing witnessed memories and landmarks.
`History` → `Inner life` shows them for discovered characters. Every avatar
starts from its seed sentence and gains an inner life as play continues.
Dreams and thoughts are marked as private impressions. They are separate from
witnessed events and public conversation.

Each voice receives a short first-person transcript and completes one plain-text
line. An avatar's system line is `I am <seed>` plus its grown persona; avatar
profiles carry no persona, voice, idiolect or example utterances, and tastes
stay out of speech ([#1673](https://github.com/cenetex/cosyworld/issues/1673)). Items keep an optional `idiolect`, and places keep their
`persona` and narrator `voice`. The server checks
visible state, including lamp state, before accepting each line. Supplied quest
facts remain part of the transcript. A bard's poem context names its title
and the travelers whose deeds it holds, with no authored verse text. The bard
speaks in its own voice. Ordinary factual, custody, observation, and speech
checks apply to local and shared replies.

Hosted calls have a twelve-second limit and the scene has a twenty-two-second
limit, with eight calls in flight. Replies are collected as they complete, then
published in scene order. Local play can publish completed lines once at least
one requested speaker succeeds. Omitted cards keep their saved words. Shared
play requires both selected voices and journals the committed text through the
existing shared dialogue event. Shared speech uses the same transcript and
visible-state checks. Shared reflections are saved through the world journal.

Optional voice tiers are enabled with exact model IDs in
`COSYWORLD_CARD_REFLECTION_MODEL` and `COSYWORLD_CARD_ESCALATION_MODEL`.
Both settings start unset. The reflection tier writes an avatar's lasting
persona in local play. Public speech, thoughts, and dreams use the character's
own model. The escalation tier gets one cooler attempt after the selected
model's attempts fail validation or time out. All tier models must qualify for
world content in the current registry and data policy. Equal selected models,
including two IDs for the same concrete model, share the original attempts.

An enabled escalation receives a reserved part of the scene's remaining time:
half the remaining time, up to one call timeout. Earlier attempts share the
rest. A voice starting at the beginning of the hosted twenty-two-second scene
therefore has about 5.5 seconds for each of its two own attempts and eleven
seconds for escalation. Queue waits use the same deadline. Every returned line
and reflection passes the same checks before it can enter the saved world.
The browser retains the avatar's public model attribution beside its private
persona, thoughts, and dreams across reloads.

For local Ollama play, pull a model and run `npm run play:cards:local`.
The [local app guide](../local/README.md) covers Chatterbox setup and character
voices. `COSYWORLD_LOCAL_MODEL` defaults to `gemma3:4b`; `OLLAMA_URL` and
`COSYWORLD_CARD_LOCAL_PORT` select the server and table port. The local profile
allows ninety seconds per call and four minutes per scene, with one call in
flight. `COSYWORLD_CARD_TEXT_PROFILE=local` selects this profile on another
server. The served page receives the matching wait budget. Operators can set
`COSYWORLD_CARD_STORY_BUDGET_MS` for a separately served card page.

## Painted Greece

All released Greek places share day and night. Each light setting lasts
twenty-four accepted world turns. The Theban places, Athens, Colonus, Eleusis,
Marathon, the ship's deck and the Trojan camp have matching night paintings.
The deck shows its pack backdrop `assets/greek-drama/ship-deck.webp` by day and
`ship-deck-night.webp` at night (`daylight.mjs`), at port or at sea. New day art
replaces `ship-deck.webp` under the same name; then run
`npm run v2:card:images:build` and `npm run v2:card:assets:build`.
The eight Attic roads share an olive-road painting in both light settings.
The Theban Harbor Road has its own coast and town painting in both settings.
Road approach cards use the same light as the road scene. All three harbors
have matching day and night views for the ship at the berth and the open berth.
The saved ship dock selects the painting. Reloading preserves the light, and
dialogue facts name the current place.

Greek weather follows one cycle per region. Each period lasts twelve accepted
world turns. Clear skies, cloud, rain, and mist appear in the scene and on place
cards. Coasts, courtyards, open ground, groves, and shelters each have their own
view of the regional weather. The Underworld has low mist above its water.
The Greek ship has its own `sea` region wherever it lies: mist, rain, mist,
rain, mist, then a clear spell, so a crossing feels like weather.
The Willows camp, thicket and bank share a `willows` region that is never
clear: an eight-period cycle of soft drizzle under low mist and heavy river
mist, four periods to a day and night, so the mix shifts from one day to the
next. Their `river` exposure keeps the rain light and the mist
green-grey. The landing has no weather, so the boatman, the otter and the
canoe read clearly there.
The cycles and each place's region and exposure are data in `weather.json`.
The rules commit only the weather word: dialogue facts read `Weather: rain.`,
and the narrator's own words describe it.
The shared game, local saves, dialogue facts, and scene exports all read the same
turn. Reloading keeps the current weather. Shared rules version 18 adds the
harbor and road views. Each earlier rule bundle keeps its contents for replay.

`weather-shader.mjs` paints the weather with one WebGL fragment shader. The
scene animates parallax rain sheets with gusts and ground splashes, drifting
cloud shadow, and folding mist banks. Each exposure sets its own slant, rain
strength, mist height, and tint, and night cools the palette. Place cards show
cached still frames from the same shader, so the hand never holds more than
one extra WebGL context. Reduced motion holds a single frame. Clear skies and
hidden tabs stop the animation loop. Without WebGL, `weather.css` supplies the
earlier gradient view.

`transitions.mjs` softens changes that happen while the player stays in one
place. When night falls or lifts, the old painting fades over the new one for
four seconds and the light filter eases with it. Other painting changes in the
same place, such as a lamp or an opened crossing, fade in under a second. When
the weather turns, the shader eases its rain, cloud, mist and night values over
six seconds, so a storm gathers and mist lifts instead of snapping. Travel cuts
under its veil, and reduced motion cuts everywhere. These are presentation only:
they read the committed scene, so local and shared play look the same.

In the Willows all year (`UNCANNY_PLACES` in `transitions.mjs`, client data the
rules never read), and elsewhere on Halloween (31 October, browser local date;
`HALLOWEEN_DAYS`), some entries to a place briefly show one image as something
else for 140 milliseconds: either a figure or the painting, never both. The
copy is the image's own name with `-uncanny.webp`, such as
`assets/willows/swede-seated-uncanny.webp` beside `swede-seated.webp`. Images
without a copy registered in `image-variants.json` never flicker, so new art
needs no code. The copy is preloaded and stacked on its image with the same box
and light filter, so nothing moves or brightens. There is at most one cut per
entry, a 40% chance, and none within 30 seconds. Reduced motion and Settings → Flashes and
scares: off disable it. `?halloween=1` or `?halloween=0` forces the flicker on
or off everywhere for testing.

New Greek games expose the harbor and six Theban places, each with a distinct
painting. The Open Door adds five paintings and eight resident portraits.
Old Greek saves retain later routes and histories. The ship uses
a painted transparent layer over the unchanged pond and a card crop from
that same scene. Both worlds now share Forest’s crossing implementation and
one compiled `packs.json`. The new art prompts and hashes are saved in
`assets/greek-drama/open-door-art.json`.

Boarding keeps the ship at its departure shore so other players can join.
The voyage moves it to the arrival shore, where it stays after the first
passenger lands. Passengers still aboard can step off there or stay for the
next course, so a passenger can stay aboard through several trips. A lamp
recall waits until the ship is empty. Shared rules version 27 adds the sea
lanes and the round at sea (ship record version 3). Older occupied ships wait
docked for a course; ships that had landed keep their arrival. Older journal
actions replay with their original rules.

The same rules make knowing a lane personal. Course cards show only
the lanes the person knows from that port. People from a world with a port
know its lanes; people from the forest know the Black Pond lanes; Myrto the
shipmaster knows every lane. Everyone aboard learns the lane they sail. A
lane that a thing aboard opens (`opensWith` in the pack bridge) is a course
card for everyone on deck while the thing is there, whoever knows it. At a
port or aboard, Talk can tell a lane as a fact ("Ships for Piraeus Quays leave
from the Wine-Dark Harbor."), and the listener learns it only when the published
speech says it. A gated lane is told with what opens it ("…only with Travel
Provisions aboard."). A story choice that is ready at the port is told first, so a
new lane never holds up an authored scene. Lanes are saved as `sea:` edges in route knowledge.

See the Greek pack README and `test/card-theban-release.test.mjs`; the scene
journey is `v2/scripts/smoke-card-theban-scenery.mjs`. The weather journey is
`node v2/scripts/smoke-card-weather.mjs`.
