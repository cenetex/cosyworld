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

## Privacy

The passkey panel and the members-only sign-in say what a passkey keeps and
link the Privacy page (`privacy.html` at `/privacy`, also in Settings;
[#2052](https://github.com/cenetex/cosyworld/issues/2052)). `privacy.mjs` holds
the notice and operator details. The Privacy page is layered: eight short
lines that fit one phone screen, then each topic's full text in a closed
`<details>` section. `/download` redirects to the source on GitHub.

Play counts are anonymous daily totals. `POST /card-game/metrics` takes
`{"day": <UTC day number>, "counters": {"play.talk": 2}}`, where every name
comes from the fixed list in `play_metrics.rs`. An unknown name or field, a
count over 1,000, a day more than one day from today, a cross-site post or a
body over 4 KiB is refused. Each client may post 12 times a minute. The
server adds the counts to `play_metrics_daily (day, name, count)` in the event
database. It keeps no IP, account, world, install or session id, and no text,
and it drops days older than 400 days on every write. The request log names
only the route and status. `GET /moderation/play-metrics` (moderation token)
returns the last seven days. Nothing reads the counts back into play.

`metrics.mjs` counts in memory and sends one `sendBeacon` batch a minute and on
`pagehide`. Settings has a Play counts card. With it off, under
Global Privacy Control, or in the desktop app until turned on, nothing is
counted or sent. `smoke-card-play-counts.mjs` checks all three.

## Settings

☰ › Settings is a hand of cards in place of the play hand
(`settings-cards.mjs` deals it, `settings-screen.mjs` draws it), dealt the
way the play hand deals a place and the things in it. Four group cards, You,
Sound, Play and World, hold their settings as a place holds its items: a
folded group shows its first setting peeking out behind it, a tap fans it
open and folds any other, another tap folds it, and a pointer lifts the
group with its peek (the play hand's 180 ms shuffle; reduced motion only
brightens it). Choosing a setting puts its action in the context button
("Turn voices off", "Open privacy"); pressing the button does it and folds
the group back. With no card chosen the button is Close settings, and Escape
unchooses, then closes. A card shows only its name and art. Its face is its
state: lit while on, dim while off. State words and reasons are in the button
and the beat's info line, and in each card's accessible name ("Music, off").
Sign out, New game and Restore a backup ask a second press ("Tap again to
sign out"); a credit commit asks in its own beat.

Settings opens with You fanned, and Privacy is the first thing it holds, so
Privacy is one tap away. You then holds Account and Credits (hosted play),
Another passkey (a shared world, signed in) and Play counts. Sound holds
Music, Voices and Volume. Play holds Fight speed, Flashes and scares and
Controls, which steps through tips. World holds the four pack cards, Cosy
Cottage (`lonely-forest`), The Reflected Shore (the hub), The Wine-Dark Sea
(`greek-drama`) and Hoppy Cat Universe (`hoppycat-archive`), then New game
(the local table), Backup (the desktop app), World pool (a shared world) and
Download, which opens `/download`. A pack card is
a place card drawn as the quest card draws its place (`questScreen`): the
painting feathered into the card, its name where the quest names its verb.
Every other card is a place card too, each a region of the owner's moonlit
workbench (`assets/settings/PROVENANCE.md`): the letter and dice for You,
the candle for Sound, the dice cup and mug for Play, the window for World,
the sealed letter for Privacy,
lamplight on the bench for Music, Pip's ears for Voices, the candle flame for
Volume, a moth's wing for Flashes and scares, the dice cup for Fight speed,
the dice for Play counts, Pip at the table for Account, the gear for Another
passkey, the old books for Credits, the brass mug for World pool, the scroll
for Backup, the moon for New game, the armillary for Controls and the book
stack for Download. A card lifted over the next by pointer or focus moves that card's name clear.
A pack card is lit while its pack is on, and dims when it is off. Its button
switches it (rules 98, `pack-toggle.mjs`; no turn passes) or names why it
can't: one pack stays on, not during a fight, the shore not before the first
crossing, Hoppy Cat "Reached by The Wine-Dark Sea" while the Sea is off (it
dims with it), and shared worlds keep every pack for now. The cards drive the controls in `#menu-dialog`, which no longer
opens. While Settings is open the scene fades to black under the world's
logo (the toolbar's, set where the title lifts it over its card) and the
room or battle song fades out and holds its place; closing Settings fades
both back in, the song from where it stopped (`setQuiet` in `music.mjs` and
`music-cues.mjs`). The island hum and world sounds rest with it. Reduced
motion swaps the scene at once. A moment later the workbench painting comes
up whole as Settings' own scene, as a place's painting is a scene's
(`SCENE`). `smoke-card-settings.mjs` checks the groups, Privacy one tap
away, the peek, the hover lift, fanning, choosing, pressing, the fold, the
second press and closing at three widths; `smoke-card-music.mjs` checks the
held song.

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
The service reduces an emoji voice's reply to those symbols in code rather
than by prompt: words, punctuation and emoji the table cannot name fall away,
a skin-toned symbol reads as its authored one, a ZWJ sequence stays whole or
falls away whole, the first five stay, and a reply with fewer than two left
is silent ("…"). A reduced reply publishes flagged `emoji reduced`.
The server reads the expression type from the authored character profile.
Spoken audio and letter sounds follow speech replies.
A committed ring at your place strikes a synthesized bell (`sfx.mjs`), softer from next door; it follows the music switch and volume.

Players do not connect an OpenRouter account. Written dialogue uses the game's
account and stays free. Spoken voices spend the signed-in passkey's credits
([#1924](https://github.com/cenetex/cosyworld/issues/1924)): a new spoken line
costs 1 credit and a speech pack is 100 credits. Settings shows the balance from `GET /card-game/credits` and a "Get a
speech pack" link. `credits.mjs` asks `POST /card-game/speech` for each new
line; the server spends the credit, voices the line on its own OpenRouter key
and refunds a failed new purchase. A line already bought plays again for free;
a failed replay keeps its original purchase charged. Requests for the same line
wait for the active attempt to settle; saved completion survives clip eviction. Signed
out or out of credits, lines are simply not voiced. The Mac app keeps its
local voices without credits.

When the server has Stripe set up, `GET /card-game/credits` says `checkout:
true` and "Get a speech pack" in Settings (and on the camera when a film is
out of reach) opens Stripe Checkout; Stripe's webhook adds the pack.

In a shared world the world's credit pool pays instead. Any passkey can commit
credits to it from Settings ("Commit 10 credits" / "Commit 100 credits"); the
action beat confirms, since a commit is never taken back. Settings shows the
pool and its largest contributors (`GET /card-game/credits/pool?world=`). The
server spends each voiced line once for the whole world and keeps the clip, so
every player hears the same audio; the camera films on the pool. An empty pool
leaves lines unvoiced and greys out the camera.

Shared speech sends `{world, play, line}`, with a zero-based line index into
the completed play's saved scene. The server checks seated or bound access
and resolves the recorded speaker and words before cache lookup or spending.
Queued, missing and scene-only legacy records cannot spend the pool. Old
shared clients must refresh. Personal local speech still sends speaker/text,
and local Chatterbox stays free.

The Download card in Settings and the brand tooltip name the build from the
server's `/meta` (`v1.2.104 · 94ff0b8 · rules 57`, commit linked); a static
server shows none.

Leave **Voices: on** to hear Vale, Mara, Pip (`moth`), the Keeper, Badger, and
Dione (`greek-baker`) where a voice client is available. The first tap or key
press enables audio. The voice reads the character’s actual dialogue. Tapping
once reveals the words; tapping again advances to the next speaker. The
automatic reading pause waits for audio to finish. Menus and hidden tabs pause
the voice. **Retry voice** repeats a failed request for the current line.

`voices.json` maps the cast to six original Seed Audio references in
`assets/voices/` for `fish-audio/drama-3`, which supports voice cloning and
natural-language performance direction. `character-speech.mjs` asks its voice
client for each clip.

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
32 clips and 16 MiB.
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
  dropping a level quest costs 1 XP for the first, 2 for the next, and so
  on, never below the experience its level took (`questXp`), so the level
  stays; its button reads "Drop quest (−N XP)". It is a secondary,
  destructive choice: red words with no panel, and a play box holding only
  it keeps no box of its own.
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
  An avatar draws a quest whenever its stack is empty, except when it is
  content: from rules 90 an ordinary quest met with nothing beneath is
  enough for now (`actor.content`, `want: null`). A player draws its next
  quest on waking from any Sleep, a resident after a day (`CONTENT_TURNS`).
  A content resident waits and still answers plays. While content, no quest
  card is shown: the hand has no fold, no quest card and no Drop quest until
  the next want is drawn (`v2/scripts/smoke-card-content.mjs`). A draw takes something
  near first; with nothing near left, curiosity starts over, and then
  anyone known, or what they hold, will do, reachable or not. A new world
  draws one for every avatar without an authored `want`; a quest left empty
  by an older rule set or a pack mounted later is drawn after a short rest.
- **Level quest.** The quest is the threshold (#1583). A player's
  experience still rises with every quest met, but its level (`actor.level`)
  rises only through a level quest. Waking from a long rest at a sanctuary
  with experience enough for the next level brings that quest in the dream:
  the scene tells the model the quest as a fact, and it goes on top of the
  stack, above the ordinary quests. The quest for level n has ceil(n / 5)
  steps ([level curve](../../docs/design/level-curve.md)), each drawn from the whole known world among the half
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
  resolves: **give** only when accepted. No step is violent: a person step
  is Talk or **meet** at every level (Threaten and Strike steps saved before
  rules 90 are still met). Steps interlock with other
  avatars' quests: an item another known avatar wants to hold may be given
  or brought to them at home, meeting both quests in one play, and a person
  on the way to a place may be met there. A step already true where the
  avatar stands is not drawn. Steps come one at a time in order; nothing is
  authored ahead.
- **Pursuit.** Residents use the fixed verbs: travel along routes (travellers
  who learn the roads keep to the routes they know), then ask, trade their
  least valued spare, and threaten when bold enough by resentment, a higher level tier or
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
place shows the back alone. A step that gives to
someone shows all three: the player, the thing and the recipient. Its label
reads "Quest" in small capitals, then the quest as a plain sentence ("Give the
Burial Decree to the Gate Guard") in the label's face, as written, on at most
two lines, with a level quest's numeral on the right. Its tier colour is the
highest tier among the things it names that the player has found (its target,
a step's recipient and place), from their levels (`questTier`), and at least
the tier of the level a level quest leads to; face down, and folded until it
has first turned, it shows only the common tier. It never
shows who holds the target or how far it is; it glows softly and steadily
while the target is within two moves. Steps still to come lie face down behind
the card, showing the card back. It plays nothing. The top quest folds behind the player's avatar card as
a full-size card in its stack: face down, showing the carved card back, leaning
out to the top left with a glowing line in its tier colour along its edge.
Choosing the folded card fans the whole stack out, top first, and so does
opening the avatar's stack. Each quest card is dealt face down, showing the
carved lid, and turns to its face 520 ms after it is first seen, with the
hand's reveal (`card-reveal.mjs`), the next quest a moment after; reduced
motion crossfades. It turns once: folding and opening the fan, plays, redraws
and progress on the quest (its steps, its place in the stack) leave it face
up. Its identity is whose quest it is, its kind and its target, so only a
quest that leaves the hand and later comes back is dealt face down again. The
hand a page or a new game opens on is already dealt: a quest in view then is
face up at once. It takes taps while face down. In the open fan the top quest is chosen and
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
its card. A pointer over a card shuffles it: the card and its preview stack lift together while the rest of the fan parts around it (180 ms; touch has no hover, reduced motion only brightens it).
Every card names itself at its top in one label, for avatars, items, places,
quests, packs and Settings alike: the quest card's 600-weight sans in capitals
at 4.2% of the card's height (10 px at least), in the card's tier colour over
a light shade. It breaks only between words, a hyphenated word staying whole
(`card-label.mjs`), and keeps clear of the next card in a fan; an unlit card
dims it. A figure's head stands below the label. A face-down or locked box
carries none.
A card new to the view (an avatar arriving, a thing picked up or put down, a
place found, the hand at a new place) rises into its slot over 460 ms, cards
entering together 70 ms apart (`card-entry.mjs`). A card already there never
moves again on a redraw, a card seen moving keeps that move, and reduced
motion just shows it. An entering card takes taps at once; the motion is this
browser's alone and never waits on the rules or the shared room.
A card that leaves the view (a thing given or put down into a folded stack,
an avatar walking away, a place left behind, a quest cleared or set aside)
falls 24 px and fades over 360 ms, staggered as entries are, at most six at
once (`card-exit.mjs`). The hand redraws at once; an inert, aria-hidden copy
from `card-ghost.mjs` plays the fall where the card lay and is released when
it ends. A card shown under another holder moves there instead, and a reveal
keeps its card, so it never falls. A page opening, a new game, another tab's
world and reduced motion show no exit (`v2/scripts/smoke-card-exit.mjs`).
A card locked behind a quest (a sealed card, the far side of a shut gate) is
a locked wooden box: the darker locked lid on a red edge, labelled only
"Locked" (the owner's one exception to words on a card), with no painting and
no name.
Tapping it chooses it, and the context button gives its quest. When the quest
opens the way, the box turns over once, with the same lift as an uncovered
card (a crossfade under reduced motion), and the card shows as itself from
then on; a redraw never covers it again (`locked-box.mjs`). In a shared world
each browser reads its own player's view of the gate.
Arrival starts the hand at the new current place. Selection keeps its scroll position.
On wide screens, the resting hand is a fanned deck at the right, as wide as
its cards so none is cut at the screen edge; once it would crowd the dialogue
the cards overlap more instead. The dialogue sits at the left with the
earlier beat peeking above it. Selecting a card raises the hand into the phone layering: in one 280 ms
motion the deck grows into a full row across the screen while the dialogue
slides to the middle (at most 720 px wide) and lies over the cards' feet, and
lowering slides both back. Reduced motion crossfades. On phones and tablets the
dialogue is always that fixed box at the foot of the screen, over the hand,
with the earlier beat peeking dimmed above the current one inside it: resting
cards show their tops above it, and a tap on a card raises the hand
above it with each card's foot still tucked behind it. A tap on the scene
drops the hand again; there the dialogue never moves. Before the first beat there is no dialogue, and the hand leaves no hole for
it: raised cards show whole, name and all, and the first beat lifts the row
under its box. Short landscape screens keep the dialogue above the hand.
While a beat shows on a phone, no figure stands behind the resting cards'
tops: the cast stands on the dock's top edge, and a resident painted into the
backdrop, such as Badger at the Steam Clock, steps up off its spot where a
portrait screen's painting cannot rise far enough.
A resting hand, and one tucked down for a fight, shows only its cards' art:
each name and its shade fade out (120 ms; reduced motion switches at once)
and fade back when the hand rises, a card is chosen, or a pointer or keyboard
focus is on the card. The card buttons keep their names for screen readers. Swipe, use the wheel, tap the ‹ › buttons beside an overflowing hand, or use the arrow keys to reach more cards. The buttons dim at each end, cards fade out at an edge that hides more of the hand, and a sideways swipe stays inside the hand.
Play stays available once a line has been read, in an exchange's last reading pause, which a chosen play skips. Every play in flight, queued, sent or committed, is one **Thinking…** card with no button ([dialogue beats](../docs/card-table/dialogue-beats.md#what-is-in-front)); two taps cancel it, and choosing the same play again keeps it. A committed play stays saved: its two taps only stop waiting for its words. Cards chosen meanwhile wait behind the Thinking card, and their play comes forward with the reply read. Selecting another
card clears a play queued here. Shared play waits for the player's current turn
to finish, then checks the chosen action against the current table before
sending it. Once the room plays it, the reply types into the full-size front
card.
Nothing floats over the stage. A play the shared table refuses says why on its
own button, disabled, in the server's first sentence ("Waiting for an update"),
as a blocked Take does; choosing its cards again, or the world moving on,
offers it again. A refusal that lands once its cards are let go reads briefly
on the action beat's status line ("Not played: Wait. That play has changed.").
Other words the player must see, such as an unsaved world, a lost connection
or a nudge, read on that status line in front of the dialogue. A refusal does
not return on reload.
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
do a new visitor's first cards in a shared world (after the new-world title,
the avatar's own card is already face up); a table this browser already
knows keeps the cards its player has uncovered. The first tap uncovers a card
without selecting it or spending a turn; subsequent taps select it normally.
A place widens from the upright cover to its wider card as the lid lifts;
with reduced motion it crossfades.
An uncovered new card glows in its tier colour and carries no text badge.
Covered cards cannot be dragged or paired; a tap on one reveals it first.
Each browser remembers which cards are still covered, including after a
reload, per table and per shared world and seat.
The stage shows only what its player has revealed (`stage-reveal.mjs`): a
covered person, resident or thing lying there, and a covered light someone
carries, are not in the scene, and a covered current place is black behind
whoever is revealed. A new world therefore opens on Vale alone, on black; the
lamp and the attic come in as their cards are tapped, in either order. A tap
fades the figure or item in over 900 ms and brings the place's painting up
out of the black; reduced motion shows it at once. A covered person who
speaks is revealed with the line, there at once, so the words never wait.
The rules' world and knowledge are unchanged.
The opening of a new local world (`opening.mjs`) offers no play while the
lamp or the attic is still face down: the context button reads a quiet
Reveal and turns the next one. Once both are revealed the lamp is chosen, so
the button offers the rules' own first play, Put out; it darkens the attic
and the pond arrives face down behind it. A reload or a shared world has no
opening beyond the reveals its player has kept.

The player's avatar knows only what its player has uncovered (#1575). Until a
card is uncovered, the screen never names it: the place heading, world name
and page title show "…" (beside a toolbar logo the covered world name is
hidden instead), and card labels, screen-reader text and stage alt text
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
Epic 30–49, Legendary 50–99 and Mythic 100+ (`level-tiers.mjs`, shared with
the rules). A selected person or thing shows its exact level
as one faint, matching Roman numeral at its top; places have no level of their
own and show none. These fixed bands use existing avatar levels; items
currently have level 1. They do not change progression, but they set strength
in a standoff.
When a shown card's level rises, it glows once from its old tier colour to the
new one, lifts slightly and changes its numeral in place, in about a second;
reduced motion shows the new level at once.
No card face or hover text exposes quest checklists, hope fractions, Inspiration,
fuel arithmetic, ringing deadlines, or ritual phases. Observable changes
belong in the scene and art; hidden conditions never become a progress indicator.
Accessible descriptions report the same observable facts, not extra puzzle clues.

Lamp and cloth manipulations need no generated commentary. Social exchanges,
travel and the existing authored bell echo retain their speech. The optional
The Memory panel shows remembered beats, not an objective journal.
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
screen-reader readout still works. Today the hints go only to `#play-readout`,
with one exception: when the rules refuse Take on an item within reach for
space (an avatar carries at most three things), the context button reads "You
have too many items to take the oil flask" and plays nothing. The cards
themselves are unchanged (#2018).
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
join the city to Piraeus. Each is a gate: a route from one end replaces that
end's exit, opens the first time its condition holds and stays open after,
and the way back stays open (see the
[Open Door guide](../content/greek-drama/OPEN-DOOR.md)). The Theban Harbor Road is the only way
between the Wine-Dark Harbor and Thebes. The battlefield is a Theban place
outside the walls; the City Gate opens onto it once the gate guard holds the
Burial Decree there and stays open, and the way back in is always open. The
Cithaeron road leads on from the battlefield to Eleusis once a Theban account
of the burial is there or on Dione's table. The Road to Delphi joins the Agora and
Delphi, the Oeta Road joins Delphi and Trachis, the Royal Road joins Troy and
Susa, the Black Sea Road joins Thrace and Tauris, and the Colonists' Road joins
Corinth and Sicily. A road has two fixed ends, shown by destination cards in a
fixed order. Avatars come first in the hand, followed by the first end, the
road, and the other end. Its entry card names the place ahead. Travelers can
meet, wait and carry objects on the road. Myrine walks from Eleusis to Piraeus
one road at a time, along the Sacred Way and the Long Walls.

A place _within_ another, such as a house in a quarter, names its parent in
`within`. It links only to that parent and does not count toward the parent's
links.

A pack marks an old road or place `retired: true` to keep its ID for saved
history. No exit leads onto it. A save that stands on a retired road
continues at the road's first end; one at a retired place continues at the
place's one exit, the place that took it in.

Run `npm run v2:card:travel:smoke` for desktop and phone trips through
Piraeus, the Athens–Piraeus Road, the Agora and the return to Dione. The check
also tests the destination cards, a reload on the road and waiting for the ship.

A destination card shows where you are going, never where you stand. Every
place card in the hand uses the same painting the action beat shows for that
place, lit for its hour and weather. The ship's card always shows its deck: the
deck at a port, or open sea by day or night, from the pond, a berth or aboard.
The stage at a mooring with a berth painting (the Wine-Dark Harbor, Piraeus,
Trojan camp landing or Signal Jetty) shows the ship at that berth. Greek
moorings follow the hour; the Signal Jetty keeps its starry sky. The berth's
focus frames the scene on phones. Departures restore the empty shore painting.
A road card shows the road, because the road is the next place.

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
use the same vessel and leave the course to a human aboard; with no
player's avatar aboard, a resident sails the ship to its own destination,
cargo or not (rules 96). The lamp signal
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

Every avatar, item, and location has a profile in `entity-profiles.json` and a saved memory in the browser world. `senses.json` gives each place one first-person sense line (what a visitor feels, hears or sees there, without the place's name) and each avatar its pronouns. Only the server's voice context reads it; the rules and the browser do not. A memory holds the latest 16 witnessed events, six lasting encounters, and the latest generated text. Gifts, trades, threats, shared trips and quest effects can become lasting encounters. Card plays record events for the actors and objects present, the item used, and both places during travel. Generated speech and descriptions are marked as expressions, so the next prompt can distinguish them from game events. Speech receives recent facts and a few lasting encounters. Each avatar's memories, beliefs and fears give its request or response a personal reason.

Speech receives visible facts, current wants, and witnessed results. Item and place profiles describe appearance; an avatar profile is one seed sentence. Hidden interaction rules stay in the simulation; each avatar's facts can include the quest line described in [A quest stack per avatar](#a-quest-stack-per-avatar). A revealed path joins the location cards; travel happens when its card is played. Earlier opening expressions stay in saved history while fresh speech uses observations until Vale first douses or relights the lamp in the attic, or leaves it.

When a play calls for speech, the browser sends the current local entities and departing avatars, their facts, avatar interests, and eight recent memories, witnessed events, and the six latest spoken lines at this place to `POST /card-game/text`. An avatar's spoken line is one moment of a conversation, and it speaks as itself (owner, 2026-11-03: "Prompts should be in FIRST person exclusively, with ZERO instructions."; "ai are interpreting the 'I' as a user message, put it in the assistant block keep system block clear"). Every call sends the same turns: a system turn that is only who it is ("You are Vale, the Lamplighter.", from its seed sentence; owner: "Perhaps our system prompts need 'You are Vale…'"), a user turn of silence ("…"), then the avatar's own view as its own assistant turn, then the user turn it answers. A body-language or emoji voice has its reply shape as its system turn instead. The view is short prose, a paragraph per part rather than a fact per line, and holds no instructions. It does not repeat the seed sentence the system turn already gives (a gesture or emoji voice's view opens with "I am Vale, the Lamplighter."). First, as its own paragraph with no label, comes what it knows and wants (its facts, as background rather than a script; what it learned about its own approaches stays out, as planning rather than speech, and so do the browser's "At the dialogue scene", "Location now" and "Wants …" restatements of what the view already says; the fact the rules reserved for this Talk is one of them), its history with the person it faces, and the talk it heard here as its own memory ("Pip said: "…"", "I said: "…"", at most six lines and about 400 characters, read from committed speech). Last, next to the line it answers, comes what it perceives now, in about 70 tokens at most. `perception.mjs` chooses it from existing state and sends only ids and event indices, which the server checks and words. In order: its trip ("I've just come to Black pond from Empty station."); on its first word after arriving, how the place differs from its last visit ("I've never been here before.", "Pip was here last time I came."); one line of the place (its pack `sense`, or for now the first sentence of its description); what it holds, and the state of what it or its listener holds ("My Lamp is unlit and uncovered."); the one or two events of this moment that most involve it, ranked about me, then my listener, then the thing I want, then anyone here; who holds the thing it wants; a wanted place one path away ("The way to Black pond starts here."); and the person it is talking with, by seed sentence ("I'm talking with Pip, a moth."), or who is with it when it addresses nobody. It never lists everyone here or every exit, and never says "I'm at …". A tab from an older release sends no perception and keeps the earlier view. `person.rs` rewords the rules' captions, events, facts and memories in the speaker's own first person ("Vale waits one turn." is "I wait a moment."; "Pip threatens Vale over the Lamp." is "Pip threatens me over the Lamp."), and a play's turns are moments in every prompt ("in the prompting lets call them moments instead of turns", owner, 2026-11-03), while the table's captions keep their words. The final user turn is only the line it answers, as `Pip says, “…”` (a bare line or `Pip: …` drew `Vale: …` back): in a Talk, the target answers the actor's line from this turn, so the target speaks after the actor, and is silent when the actor has no line this turn; the actor speaks within the first 55% of the scene, so the reply always keeps the rest; the actor answers the latest line someone else said to it here; when nobody has spoken (a Wait, an opener), the turn is the person it is talking with, there ("Pip is here."), because on gemma-3-4b silence drew scene narration where the listener's presence drew speech, and it is silence ("…") when it faces nobody. Its own "I" never reaches a user turn, where a model read it as the other person's and answered "You are at The Wine-Dark Harbor…". Where the route continues a final assistant turn (Mistral, and llama.cpp locally) a call that heard a line ends on the opening quote `“` of the reply, sent as a prefix, and the reply is the speaker's own quoted spans (`speech.rs`; a span tagged to someone else is theirs); Claude rejects a prefill and OpenAI starts a new turn, so neither gets one, and no route ever gets the view as a trailing turn to continue. `prompt_version` is `card-voice-v5`. There is no speaker cue and no scene scaffold in a user turn, and a Talk's caption is not in the prompt. Its own earlier lines from memory stay out of a line ([#1537](https://github.com/cenetex/cosyworld/issues/1537), [#2016](https://github.com/cenetex/cosyworld/issues/2016)). A character's voice comes from its seed sentence, its facts and its own inner life; prompts carry no authored description or example lines. The `repeat` check compares a reply with the speaker's last three spoken lines, which the service reads from its memories, its previous reply and the request's table lines without putting them in the prompt. A reply that repeats six words in a row from another speaker's recent line is a `repeat` too, so a heard rule is not parroted; an answer may echo the line it answers, unless it says that whole line again. `echoed brief` fires only on scaffold leakage: one of the prompt's labels in any case ("I remember:", "Pip said:"), a retired label ("what i know:", "between us:"), the prompt's own wording ("recent talk here", "measured attempt"), and, blocking the reply, ten words in a row that run from one fact of the assistant view (its seed sentence included) into the next, three or more on each side, which read the view back. A fact said, even word for word, is speech. A retry resamples the same words with no correction: `max_tokens`, the post-trim and the validator shape a reply, not prompt text. A body-language or emoji voice keeps the reply shape its own check reads. A reply that is otherwise valid but leaves out its reserved fact is published at once as `untold`, with no retry; the rules' own check finds no fact in it, so the fact stays for another Talk. A thought or persona call sends the same view with its memories and all the talk it heard, ending on its own first words ("I think to myself:", "Who I am now:"); a dream's view is only its scraps and "Last night I dreamed:"; a waking avatar's view is "I'm waking up." and what it has uncovered. Each is the assistant turn, answered by silence. Thought, persona and dream calls still read remembered speech ([#1537](https://github.com/cenetex/cosyworld/issues/1537)). Facts name only what the speaker has found: a quest or trial target it has not talked with, visited, or (in the browser) uncovered reads as "someone I haven't met yet", an avatar does not retell its own earlier deed unless this Talk tells it, and a persona naming an item kind the avatar was never near is left out. The Rust service adds the authored profiles and uses the existing AI gateway. The deployed character map sends each avatar to its own exact OpenRouter model. Items and places each have their own voice call. These calls run together inside one bounded scene request, except that a Talk's target waits for the actor's line. Each call returns a brief plain-text reply, which the service validates before publication. A short unpunctuated reply can pass when the provider confirms it finished. A trailing continuation mark or an unfinished first line triggers the usual retry. Complete sentences and voluntary quotations keep their wording. Each entry carries its own model attribution. Raising a card prepares a play and keeps the current conversation. Playing a card commits the action. Talk and Ask always speak: the player's avatar and the target's reply, and a resident who sought the player out with Talk is answered the same way. Every other play is silent unless the rules meet a speech occasion, and a silent play sends no `/card-game/text` request: its beat is the portrait and the action caption, and the hand is ready at once. `SPEECH_OCCASIONS` in `narrative.mjs` checks the occasions in a fixed order from committed state, and `speech.json` names who speaks on each: a refusal (the refuser), a want met for the actor or the target (that avatar; level-ups ride on it), a first meeting (the newcomer), a threat (the target reacts), a defeat (one host line), an agreed companion arriving with the player, a Wait in a battle (the player and the opponents), waking from a long rest, a due thought on Wait (about one in six), the opening, the player's first arrival at a place (the place's caption) and a crossing's echo (the authored line, with no request). Residents' own arrivals and departures, item voices and routine travel stay silent. The request names its `occasion`, which the server's voice metrics count. The place and chosen speakers receive scene beats. The departure action stays in the source scene. Words are written after the move commits, so a departed avatar's line is recorded at the destination with that place's cast; a player left at the source never sees it, and the waiting portrait does not name them there. The prompt includes the completed card play (except Talk, which is the conversation itself) so their lines form an exchange or a shared reaction. A separate resolved-turn record gives the played verb and outcome, every avatar's final location and holdings, exact travel companions, and final item ownership. Accepted accompany plays record both travellers; independent trips record an empty companion list. Current results take priority over desires and remembered speech. When Vale speaks on a wait play, the words stay at the place where Vale stayed. A solo farewell frames desired company as a hope for later.

Each server voice call writes one `card voice call` log record with the entity, part, attempt count, outcome (`spoken`, `untold`, `silent` or `cancelled`), each attempt's rejection reason, the registry `model` and `provider` it last tried, each gateway failure code (`failures`), its latency (`ms`), and approximate prompt tokens (characters / 4) for every section: `system`, `now`, `facts`, `directions`, `memories`, `earlier`, `conversation` and `inner`. It never records prompt or reply text. Each record also names the `play` (the resolved card kind, `opening` at turn 0) and the scene's speech `occasion` (from a fixed list, or `none`). `GET /meta` reports the same counters since the process started under `card_voice`, with calls and spoken replies per play under `by_play` and per occasion under `by_occasion`. `by_model` and `by_provider` count calls, attempts and each outcome per registry model and provider (at most 24 labels each; the rest share `other`), and `provider_failures` counts gateway failure codes such as `inference_timeout` or `ai_provider_unavailable` behind each `provider` rejection. An attempt that ran out of its own time is a `timeout` rejection; the attempt still running when the scene deadline or a closed viewer dropped the call is `cancelled`. An `untold` line is published, so it adds no rejection. `rejections` are blocked reasons: the reply was not published. `flagged` counts reasons on lines that were published anyway; a flagged line counts as spoken, and its log record lists them under `flags`.

Each scene also writes one `card voice scene` record, because a failed streamed scene still answers HTTP 200. It names the `path` (`table` for `/card-game/text`, `shared` for a shared world's words), whether it streamed, the `outcome` (`spoken`: every needed speaker has words; `partial`: some show "…"; `failed`: none do; `closed`: the viewer left first), the needed and voiced speaker counts, the scene's `ms`, and `voices`: for each line call its entity, outcome, model, provider, attempts, `ms`, blocked `reasons` and published `flags`; a flagged line counts as spoken. A request refused before any voice call writes the same record with `outcome=refused` and a `reason`. `/meta` reports these under `card_voice.scenes`: `by_path` counts scene outcomes per path; `speakers` counts each needed speaker's end (`spoken`, `untold`, `silent`, `cancelled`, or `unvoiced` when it was never called, such as a Talk's target after a silent actor), so one "…" in a two-speaker scene is counted as silence; `refused` counts refusals by cause (`busy`, `client_busy` and `rate_limited` for the three 429s, `invalid` and `envelope` for 400s, `too_large` for 413, `unreadable` for 422, `forbidden` for 403, `unavailable` for 503); and `shared_plays` counts how each shared play's words ended on the table (`spoken`, `partial`, `failed`, `expired` when its 60 s lease ran out, and `refused` when the rules refused the words, also counted as `failed`) with `silent_voices`, the "…" they showed. Shared lease expiry also logs `shared card words lease expired`. `npm run v2:voice:eval` builds every prompt for the narrative-contract scenes and a scripted station conversation, prints token and section statistics, and replays the recorded replies in `test/fixtures/card-voice-replies.json` through the validator. The eval also counts first-person possession and deed claims that the resolved turn does not support (`false_claim`); the live validator does not check those yet ([#1537](https://github.com/cenetex/cosyworld/issues/1537)).

The dialogue is a depth stack of beats, not a chat log: the current beat in front and one earlier beat behind it ([dialogue beats](../docs/card-table/dialogue-beats.md)). Earlier visits are in the optional Memory panel, which builds its portraits only while open and drops them when closed. The browser buffers each exchange until it passes validation, then reveals complete letters on a local clock: a letter every 28 ms, 90 ms after `,;:—` and 180 ms after `.!?…`, never faster than twice that after a slow frame, each letter's ink fading in over 60 ms so two or three are soft at once (`createTextReveal` and `createRevealPainter` in `dialogue.mjs`, the same reveal that inscribes effects). A tap fades the rest of the line in over 150 ms. A finished line folds back into plain text, keeping the last letter for the cursor. A line taller than its box turns a page rather than scrolling under the reader. The selected speakers take their turns in order. Each exchange advances after a reading pause. Tap the front card to finish a line, then tap again to bring the next speaker's beat in front. The hand pauses for up to 2.5 seconds while words are generated. A slow request can be stopped from its Thinking card, then replaced by another play. Once a complete reply arrives, the hand locks through scene preparation and every speaker, then becomes ready after the last reply. A blinking cursor marks the end. Tap the card behind, press ↑, scroll or swipe down to step back in time; tap the front card, press ↓ or swipe up to step forward, or use ● live. A line that arrives while the player is stepped back raises the live count and is written when they return; it never pulls them forward. A replayed line stages the avatars present now; a speaker who has left keeps the words and stays off the stage. Vale, Mara, Pip, the Keeper, Badger, and Dione speak with their original cloned voices where a voice client is available. Settings toggles voices. Other speakers keep their soft, pitched voice sounds. Reduced motion shows full lines at once. Hidden tabs and open menus pause playback, including the rest of a punctuation pause. Text reveals on browser paint frames. Each visible line keeps its own height, and portraits stay mounted when the speaker changes. Empty prior replies and speech rows collapse. A scene with no words shows a compact loading line. A spoken card play immediately shows its first speaker with a loading mark. The waiting portrait names whoever speaks next, in speaking order: after Talk or Ask, the player's avatar thinks first, then the reply partner thinks while a streamed reply is still being written. Shared play waits on the acting avatar. The browser saves complete text before playback begins. Fresh tables request an opening exchange: at turn 0 the browser asks `/card-game/text` for Vale's first line, with no action and Vale as the only speaker. The World narration from `forest.json` stays as the authored scene-setting event. If that request fails or times out, Vale shows the unsaved silent "…", and a reload after it failed keeps the "…" without asking again; a reload that interrupted the request asks again. A save from another tab never starts a request in this one. Shared worlds have no browser opening line; their server publishes speech. Reloading resumes saved dialogue from the current turn, and a line already begun shows whole instead of being written again; a shared room's line on screen when the page opens shows whole too. If the current turn's words failed before the reload, nothing asks again and the caption stands. Action records remain in the saved world and scene export. A declined Give, Trade or Ask is inscribed as a caption onto the card current when it happened, and shows in Memory. Every Give and Trade sends its recorded answer as `accepted` in the resolved-turn record, so the cast can voice a refusal.

The stage holds up to three avatars. Vale stands in the foreground, with the other two farther back. The composition mirrors when Vale returns from the other side of a route. Seats and sizes stay fixed throughout an exchange. The speaker and listener face each other; another witness looks toward the speaker. The keeper has a separate right-facing cutout, so the clock face keeps its painted detail. A soft lean and light change mark the speaker. Carried item symbols follow recorded custody, including covered items. A figure carrying a lit light holds it up in its hand cutout while no card is raised, so Vale wakes visibly holding the lit lamp. Things lying in the current place, whether put down or there from the start, stand on the painted floor as untappable props: the bare item cutout from the hand card, hand-sized beside the cast, behind the avatars and clear of the dialogue. Each keeps a stable spot from its id and the place. Wide screens show up to six; narrow and short ones show up to three. Every such thing keeps its hand card, and a prop leaves the stage as soon as someone takes it. Actual arrivals fade in together for an accepted accompany play. Quiet actions update the stage cast immediately to match the hand and current locations. Reduced motion uses still poses. The scene script exports each actor's position, depth, scale, facing, gaze, pose, travel companions, and carried items for each beat, plus the floor items and their spots. The browser uses `portrait-facing.mjs` to match each painted portrait to that gaze. This presentation-only map covers the human cast, pack portraits and Keeper variants; add new portrait files here with their native direction. Hand thumbnails keep their native artwork. A pack resident may list `poses`: each names a portrait in the pack, a place (`at`), saved conditions (`requires`), or both, and an optional stage `scale` from 0.3 to 1. The first pose that holds replaces the standing portrait on stage. Poses read committed state only, so local and shared tables show the same sprite; `portrait(id, null, world)` in `scene.mjs` returns its path, and `residentPose(world, id)` returns the chosen entry. The Swede sits by the fire at camp, listens at the bank and once the humming has been heard or the watch is chosen, and looks worried after the signs are shared. A pack place may list `backdrops` the same way: each names a backdrop in the pack and saved conditions (`requires`), and the first that holds replaces the place's `backdrop`. A hub place in `forest.json` may list `backdrops` too; the same lookup tests them against the forest rules, as for the lit or doused attic. `placeBackdrop(world, id)` in `scene.mjs` returns it. A place card in the hand shows a place as the player would find it on arriving, carrying what they hold: `placeCardArt(world, id)` moves the player there before the same lookup, so at the Black Pond the Mirror attic card shows the lit attic while Vale holds the lit lamp, and the stage inside the attic still follows where the lamp is. State entries name their own lighting through `daylight` conditions; a matching painting is final, so the ordinary night table cannot erase an observed sign. Backdrop conditions use the same closed vocabulary as crossings, including weather and ship position. Crossing scenery takes priority; an unmatched base keeps the existing day/night fallback. A place whose backdrop conditions name daylight uses the saved clock for scene lighting and day/night crossfades, including before a sign is known; an unmatched sign keeps its ordinary painting.

A raised card keeps the current conversation in place. Playing a destination starts the new visit. Room memories and the previous response follow that visit; earlier visits stay available in Memory. While a Talk or Ask reply is pending, the waiting speaker's card is in front with Thinking, and the play's effect is inscribed on the card behind it; the card behind steps back to earlier beats and ● live returns to the wait, in local and shared play. Fresh dialogue waits for the backdrop, avatar images, and entrance motion to settle. The travel screen fully covers the source before the destination is drawn. Arrivals begin after that screen clears, and dialogue begins after the arrivals finish. Agreed companions enter together; independent followers enter a moment after Vale. Beat captions distinguish followers, companions and departures, including with reduced motion. The same order applies when reopening a saved game. Media waits have a time limit. A reset or a save update cancels the travel screen and its waiting entrances.

The card rules still commit movement, trades, quests and inventory. The text response updates memories and scene lines. Revision checks discard old replies. Each ready exchange finishes before the next card action. Selecting cards prepares a single play or a combination. The scene and both conversation lines stay on the completed play until the next play is committed. Departure captions are inscribed onto the card they interrupted. A temporary speech failure retries the same completed turn once after a short pause. A busy 429 (every scene slot is taken, or this client's previous scene is still being written) carries a one-second `Retry-After`: the browser asks again at most twice, after that wait plus up to 0.4 seconds of jitter, and only while the play is still inside its five-second Thinking grace. The pause moves the scene's deadline later, since the server never started that scene. A 429 whose wait would end after the grace, such as a ten-second minute or hour limit, is not retried: its words fall silent, and the next request waits out the `Retry-After` time. Only one request is in flight for an unchanged scene. Both attempts share a thirty-second limit. The first transport gets twenty-three seconds, allowing the hosted server its full twenty-two-second deadline and reserving seven seconds for the pause and one automatic retry. Longer configured scene budgets keep the same seven-second reserve. Aborting the first transport closes its stream before the retry begins. The hand becomes available during a slow request after its 2.5-second pause. Reset and save updates cancel the active attempt and retry pause. Completed replies reach playback as soon as they are validated, while stream cleanup finishes separately. A retained line follows its event ID when the history window trims older events. The window keeps the latest 100 game events and, separately, the latest 100 generated lines, so generated text never shortens the history the rules read. The latest arrival also stays on the world, so the stage keeps Vale's entrance side after that event leaves the window. After both attempts fail, the words are silence: each avatar due to speak shows "…" on its own beat and play goes on at once. There is no failure note and no Retry, and a failed scene is never asked again, after a reload either ([words that fail](../docs/card-table/dialogue-beats.md#words-that-fail)). Reloading during a pending request asks again, with the Thinking card (#2017); a completed reply or a fresh world clears the marker. A reply over 400 characters is incomplete: it is retried once and then falls silent. Stale or cancelled replies cannot overwrite the current scene. A replying speaker whose words do not come shows "…" on its beat and in Memory; that line is not voiced or saved. In shared play the server voices the scene's speakers as given, except other players' avatars, plus a due place caption. When the acting avatar is among them its line is still required (otherwise the scene falls silent: every due avatar shows "…", nothing is journaled for the words, and the seat frees at once). A scene with no voices finishes with no lines, no model call and no speech op. A silent reply passes and the scene record lists it under `silent`, and every client in the room shows the same "…" after that scene's spoken lines on the shared reading clock. `v2/scripts/smoke-card-silent-reply.mjs` checks the local path at desktop and phone width. A new game or a save update from another tab cancels the old request.

Schema 6 saves include location changes, favours and lasting memories. Earlier saves keep their positions, items, current programs, earned steps and generated speech. Conversation exports include only the speaker and text of spoken lines.

## Opening in Mirror attic

### New-world title

Every new world on Lonely Forest opens black, then shows the land
acknowledgement (`title-intro.mjs`, started from `entry.mjs`), silent, while
the table boots underneath. Its text is data in `acknowledgement.json`: six
stanzas, each a list of lines, set like a film's opening card with generous
leading, and nothing else. Each line shows as written; on a narrow phone a long
line wraps under a hanging indent. The
text writes in with the dialogue's own reveal (`dialogue.mjs`) at the
dialogue's pace: a letter every 28 ms behind a gold caret, each letter's ink
fading in over 60 ms, the same rests after punctuation, and 650 ms between
stanzas (`STANZA_MS`). A few words keep a silence of their own (300–320 ms
after "land", "peoples", "still", "keepers", "living", "Nothing" and "box"),
and one long silence (1.8 s) falls after "Nothing here began with us." before
"Before you sits": `pauses` in `acknowledgement.json` names each word, which
time it appears and its `pauseMs`; the larger of that and any punctuation or
stanza breath wins. Fifteen single words light, in five sets
(`highlights`), each in a held pause after its own stanza ends, so nothing
lights while text is writing: Uncommon "peoples", "waters", "seasons",
"lands"; Rare "keepers", "homes", "machines"; Epic "voices", "stories",
"echo"; Legendary "Nothing"; Mythic "intricately", "carved", "wooden", "box"
(`level-tiers.mjs`). Each word names which time it appears, so only "these
lands", the first "machines" and the first "stories" light. The pen settles
200 ms (`settleMs`), the words light in reading order one every 450 ms
(`wordStepMs`), each glow rising over 600 ms (`glowInMs`) with no motion,
then 250 ms (`tailMs`) before the next stanza: 2.25 s after stanzas 1 and 5,
1.8 s after stanzas 2 and 3. "Nothing" lights 600 ms into the 1.8 s silence
and stands alone before the box. About 25 seconds in all. The last line,
"Will you take it?", stays plain cream. A lit word takes a gentle tint of its
tier's colour (45% of the tier over the text's cream), a soft 5 px glow (the
tier at 30%) and a little weight, a 0.03em stroke under the fill, so colour is
never the only cue and no glyph moves; all fifteen stay lit, well above AA
contrast. A tap that shows the rest lights them all at once, and at a large
text size a set with a word scrolled out of view lights the rest at once. The
highlight is styling only: the words stay plain text, announced nowhere. While it writes, every other letter
blips in the dialogue's own voice (`createSpeechSounds`, the neutral 145 Hz
voice of a speaker with no pitch of their own), with the table's Voices
setting, none on rests, under reduced motion or in a hidden tab. The blips
play once audio is unlocked: a new world from the menu hears them from the
first letter; a first visit, before any gesture, is silent, and the first
tap shows the rest and starts the song, which stops the blips. Every
letter is laid out from the start, so nothing reflows and screen readers have
the whole text at once; written whole, it folds back into plain text. Reduced
motion shows it all at once, with every word's tint and weight still and no glow, and a
hidden tab pauses it. A quiet "click to
continue" line ("tap to continue" on touch screens) fades in once the words
are whole; the panel scrolls when it does not fit. At a large text size
(200% zoom or a 200% root font) the poem wraps in its panel with no sideways
scroll, and while it writes the panel follows the pen a line at a time, so the
newest words stay in view, until the reader scrolls it themselves. The line is a button with no chrome that takes focus, with a ring
only from the keyboard. A tap or click anywhere, or a key (the arrows scroll),
is the gesture browsers ask for before sound: while it writes the first one
fades the rest in over 150 ms and starts the title song, and the next one
goes on.
After it, the world's logo fades in (with the song, if it has not begun)
and lifts over one face-down
card, the game's own card back, with a small Privacy link (`/privacy`) under
it. The card is a button named "Take the box", answering the poem's last
line (the card back is the carved box's lid), and takes focus, with
a ring only from the keyboard; like a hand card it lifts under a pointer
(brightens under reduced motion), and Privacy is a 24 px tap target. Left
alone for 3 seconds, the card breathes a faint warm glow on a slow 3.6-second
cycle; at 6 seconds a quiet "take it" line, the same on every screen,
fades in under it, styled like the acknowledgement's line, never on
the card. On a short screen or at a large text size the card gives up height
so the line and Privacy stay on screen. The line is hidden from screen readers, which hear the card's name,
and a tap on it turns the card too. Any tap, key or pointer over the card
starts the wait again. Reduced motion holds the glow still and shows the line
without a fade. The times are `REVEAL_HINT` in `title-intro.mjs`. A
click, Enter or Space turns it with the hand's reveal (`card-reveal.mjs`) to
the face of the avatar this world opens with (the joining avatar in a shared
world), cloned from the hand and named for screen readers. The turn waits up to
0.4 seconds for the face and back to decode, so it never shows a blank
frame. Its name tops it, as on every card. The face holds for
0.7 seconds; then the song fades out over 1.8 seconds as the title, card and
all, goes to black over 0.9 seconds. Black holds 0.3 seconds, then slowly
opens (2.5 seconds, ease-out) on the scene the world opens in: Vale's lit
attic, or a joining avatar's place. Escape skips in at any step by the same
way, quickly: the song fades over one second and the title over about 1.2.
Reduced motion cuts straight to black, holds 0.3 seconds and crossfades into
the scene over 0.3. The times are `WAKE_FADE` in `title-intro.mjs`.
The title's card is the avatar's own card: as the title leaves, by its turn or
by Escape, that card is uncovered in the hand (`onTitleWake`), face up with no
second flip and announced as a new card. Skipping counts as the reveal. The
first line still waits for the place card (see the hand above), and the
uncovered set is saved, so a reload neither covers the avatar again nor asks
for its first line twice. A joining avatar in a shared world is uncovered the
same way; with no title (a reload, other sites, the local app), the avatar's
card waits for its own tap as before.
Reduced motion crossfades each step, moves the logo up at once and swaps the
face in without the flip. If the logo does not load within 2.5 seconds, the
card shows without it.

The song is _The Attic Keeps Its Lamp × Moonstone Sanctum_
(`assets/music/title-attic-lamp.mp3`, `title-song.mjs`). It follows the saved
music switch and volume: with music off the title and its card work in silence.
It downloads only after that first gesture, and `play()` runs inside it. The
title lasts seconds, so the song comes in over a quarter second, 1.4 times the
saved volume (it is mastered about 3 LU under the room songs); the old 2-second
fade from silence left it near -50 dBFS until the card showed. No room music plays while the
title is up or its song is fading (`titleMusicHold`): the title's own gesture
used to start an avatar's room music under the song. Then room music keeps its
own rules (see Music below): the attic stays silent until the pond reveal.
A new world is the bare address with no save and no last-played world, New
game on the local table, or a shared world this browser just created or joined
an avatar to (`avatar-menu.mjs` stores its id in `cosyworld.title-intro`, and
the title clears it as it starts). A reload, a return to a world, a switch
between your avatars' worlds, `?table=`, `?pack=` and other query links, other
sites' landings (`pack-landings.json`) and the local CosyWorld app never show
it. Storage that cannot be read shows it once per load of the bare address.
The logos are data in `title-logos.json` (file, name, size; all suit a
dark ground): the two wordmarks, then three hand-lettered 16:9 artworks
appended so saved picks keep their indices. Each logo has a hidden `rarity`,
a game tier id that only weights the draw by the card tier weights
(`RARITY_WEIGHTS` in `pack-specials.mjs`): the two teal artworks are common,
Pip and the lantern uncommon, the Black Pond rare and the gold ornate emblem
epic. It is never shown. A legendary logo is never drawn, and a logo marked
`retired: true` is drawn no more but still shows where it was remembered;
append new logos and never reorder or remove one. `title-logo.mjs` picks one
per world: first a weighted draw seeded by the world's id (`?world=`,
`?table=`, `?pack=` or the bare local table), the same for every player,
then the next drawable logo if that was the one shown last, then remembered in `cosyworld.title-logo` so
a reload or a return shows the same one; New game picks afresh. The same
logo replaces the COSYWORLD wordmark in the toolbar, at its own aspect ratio
and as tall as the toolbar buttons (46 px, 40 px at phone width), named by its
`alt`; it is a plain image, not a button. A 16:9 artwork shows its own
lettering there (`toolbar`: a file, size and optional `crop` of the artwork;
`npm run v2:card:images:build` writes a cropped one under
`assets/title/toolbar/`, and a supplied file, such as transparent lettering,
needs no `crop`). The toolbar shows only transparent images: both gold
wordmarks use the owner's transparent toolbar exports
(`assets/title/TRANSPARENT-LOGOS.md`), and until its transparent art is
supplied The Black Pond borrows the teal bell-and-lantern lettering
(`assets/title/PROVENANCE.md`); every intro keeps its own art. `v2/scripts/smoke-card-toolbar-logo.mjs` checks each logo at
desktop and phone widths (`TOOLBAR_LOGO_SHOTS=<dir>` saves screenshots).
Other sites' landings and the local CosyWorld app keep
the COSYWORLD wordmark.
Automated browsers skip it unless the address has `intro=1`;
`v2/scripts/smoke-card-title-intro.mjs` plays it at desktop and phone width,
including after New game, music off, reduced motion and the keyboard, and
for a Rue and a Vale world where room music waits for the song
(`title-music-alone.mjs`)
(`TITLE_INTRO_SHOTS=<dir>` saves its screenshots there).

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
cloth in the lit attic, any traveler's scarf carried by someone there, or a
traveler there wearing their own scarf, also
reveals stairs down to Cosy Cottage. The two ways never open together: lit with
the cloth or a scarf offers only the cottage, lit without either offers neither,
and dark offers only the pond. The lit attic keeps its lit
painting, whose mirror shows only the room. The cloth can lie in the room or
travel with someone or something there. The cottage's
stairs back up stay open after either item leaves or the light goes out.
Taking the stairs before the pond, as a scarf allows from the first turn,
crosses Vale's opening as the pond does: Vale still meets people one by one,
starting with whoever is at the cottage (rules 97).
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

Trades compare each character’s value for both objects, including attached cloth. A grievance raises the requested price. A favour can lower it. Ringing beside the Keeper, spoiling Pip’s light, threats, and repeated requests can create grievances. Only witnesses remember a slight. A useful gift earns a bounded favour. Grievances retain the other avatar, the incident's event id, its turn, strength, and the turn of the latest news between the pair. Strength never decays, but a grievance with no news between the pair for 24 turns goes dormant: it leaves prompts and hostile choices until a new incident wakes it and adds to its strength. Friendly contact keeps an active grievance on mind but never wakes a dormant or repaired one. A gift handed in person to an aggrieved recipient is a witnessed repair only when it answers the incident: it returns what the incident took or damaged (the grievance's `item`), or it meets an item want in the recipient's stack (lit or dark as wanted). It closes only the recipient's grievance (dormant, not deleted); witnesses and those who hear of it keep theirs until they go dormant. Any other gift is an ordinary gift. A gift the aggrieved does not see repairs nothing, and a quiet Wait no longer eases grievances. While a grievance stands, the shared fact store keeps the witnessed account of its incident when older news is dropped, up to half the store (active grievances first, repaired last) ([grievance evidence](../../docs/design/grievance-evidence.md)).

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

A hub thing may name its own `art` (the card and stage image) and a `view` (a larger image). Once its card is uncovered and selected, the action row offers **Look**, a client-only overlay of the view: tap the image to zoom, tap outside it or press Escape to close. Look plays nothing and never reaches the rules. A save written before a hub item existed gains it at its `initialState` holder on load. Every load reconciles the save with the current content: a missing authored thing joins at its authored holder, a place or dock added to a pack gains an empty memory (rules 93), a thing the content no longer defines leaves and whatever it held stays with its holder, and a retired crossing closes. A save that still cannot be read shows its "needs a fresh start" notice and offers New game instead of an error (`node v2/scripts/smoke-card-boot.mjs`, which every pull request's fast check runs).

At the station, Vale can take the bell. The Keeper values the bell more than the oil and accepts that pair. Ring the bell beside the Keeper first and the price rises. Pip values the lamp more than the cloth. These competing tastes let the same objects support several bargains.

The hub cast's tastes, home and item values live in `forest.json` under `people`, beside the pack residents' `tastes` and `values` in their card worlds. Each named avatar also has one authored `want`, `{ "kind": "item" | "place" | "person", "target": id }`, which names what it seeks first: Vale wants the lamp, Pip wants it lit (`"lit": true`), the keeper wants the bell. A lit item want is met only while the item is in the avatar's own hands, lit and uncovered; a resident holding it otherwise takes off the cover, then lights it, so a moth keeps its flame where the stage and the mirror can see it. Pack residents with a `desire` carry a matching `want`, which the pack schema checks against the pack's and hub's items, places and avatars. The rules don't read `want` yet.

Situational worth is data too. A hub thing in `forest.json` may carry `valueRules`, and a person may carry `valueRules` keyed by item: each rule lists facts (`{ "item", "field", "min" | "max" }` or `{ "holds": item }`) and adds to the value or `set`s it. The empty lamp, the oil a dim lamp's holder needs, and the cloth the keeper wants while the bell rings are three such rules. A person's `grievances` list names the plays that offend them (`on`, partial action patterns) and the remembered `reason`; the keeper's ringing and Pip's spoiled light are two. A pack resident's `tastes.noise` is the same rule for a rung bell. The planner has no lamp special case: a resident in the lit attic waits until a play douses the lamp.

## Local play

Run the Rust server with `COSYWORLD_PRIMARY_GAME=cards` and the normal AI provider configuration. It serves both the game and the text route. For the lightweight card server, set `COSYWORLD_CARD_TEXT_ORIGIN` to the Rust server's origin before running `npm run play:cards`. Provider credentials stay in the Rust service. `COSYWORLD_CARD_TEXT_MODEL` selects a registered world-content model for this card table. Both production sites use `openai/gpt-6-luna` with `COSYWORLD_CARD_TEXT_REASONING_EFFORT=none` for short scene text.

The endpoint accepts at most 64 KiB, fixed entity IDs, eight local entities, and bounded facts and memories. It allows four scenes at once and one per client, 30 requests per peer per minute, 240 per peer per hour, and 1,200 requests per process per hour. A full server or a client's unfinished scene answers 429 with `Retry-After: 1`; the minute and hour limits answer with `Retry-After: 10`. The hourly budgets, not the four slots, bound spend: scenes wait on the provider, not the CPU. Same-site browser requests pass the origin check. Model calls have a 25-second deadline. Clients send `Accept: text/event-stream` for live text deltas followed by a validated `complete` event with all entries and the resolved model name. Other clients receive the full JSON response. Disconnects cancel the provider request and release its capacity.

## Learning and inner life

Open **Menu → Memory**: it has no title bar, only a quiet × in the corner
(Escape also closes it). It opens straight onto your avatar's inner life,
**I'm** (the authored name and title, "I'm Vale. The Lamplighter.") and
**I dream** (recent dreams, left out when there are none), signed by the
avatar's name; the remembered visits follow below a divider. The chain still
holds an **I'm becoming** line (one current intention: the newest grounded
thought, else the persona) for other readers, but Memory does not show it. Lines
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
least 24 turns since it. These gaps apply in both modes. Shared publication journals the
reflection in its own `reflect` op after the speech, dated to the speech's
turn. Retrying the publication keeps its original play identity. The server rejects a thought, persona or
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

## Threats and standoffs

Avatar cards offer Talk and Threaten. A threat opens a battle for the whole room: every avatar there, and anyone who arrives while it lasts, is a combatant with four resolve. There are no bystanders and no sides; anyone may strike or guard anyone. During a battle the selection names the play: your own card alone is Brace, your card with another combatant is Cover (their attackers hit you instead until your next play), another combatant alone is Strike (the avatar card's Talk becomes Strike), and this place's card is Wait. Nobody in the room talks. Strength goes by level tier, the card's border colour, not by the exact level: avatars in one tier are equally matched, so levels I and II fight as equals, and only a higher tier is stronger. A strike rolls its damage: 1 or 2 against the same tier, 1 to 3 against a lower tier, and exactly 1 against a higher tier. The roll is seeded from the world's run seed and the play (never `Math.random`), so the browser and the shared server agree and journals replay, and the attack event records the number rolled. Brace softens the next hit by one, with a minimum of one damage, until that avatar's next play. Four resolve now lasts two to four strikes between equals, so fights run longer and less predictably than the old fixed two. Residents compare tiers too: a higher tier is one reason a resident grows bold enough to threaten. The [combat by tier note](../../docs/design/combat-by-tier.md) has the reasoning.

A battle ends after one full round without a Strike: every combatant has played since the last Strike and none of those plays was one, so Brace, Guard and Wait let it end and any Strike starts the round again. Newcomers must play before the round can complete. Releasing the disputed item ends it at once, so handing over the demanded item is still the quick way out. While a battle is open, its whole room is locked: nobody present can talk, threaten, move, accompany, set a course, take, drop an item, give, trade, ask or cover, except that the threatened avatar may hand the demanded item to the challenger. Residents stop wandering until it ends. The hand shows the people, the place (Wait) and the demanded item. Residents answer plays, not sides: they strike whoever struck them or holds what they want (a player who has stopped striking is let be), brace when low, guard a combatant they trust who is being struck, and otherwise wait. In shared play, other humans stay out of battles until #1511. The [standoff endings note](../../docs/design/standoff-endings.md) has the reasoning. At zero resolve, the losing avatar drops the disputed item (or an item the winner needs), retreats along an open path and leaves the battle, which goes on while two combatants remain and the item stays put. Every combatant gets three turns to recover before another threat. Saved levels retain their combat effect.

The cast braces, answers strikes, or steps back. Threats, hits, releases, and retreats enter witnessed memories. A threat also leaves a personal grievance. Earlier saves gain an empty standoff state.

### Repeated defeats

Each avatar counts its defeats in a row in `defeats`. A win clears the count. Only a rest at a sanctuary changes the count: any Wait there clears it, for players and residents alike and at any time. For a player that Wait is a long rest. A Wait anywhere else leaves the count as it is. A resident's rest where it just met a want clears nothing unless that place is a sanctuary. Nobody rests during a standoff.

### Rest and sanctuary

Each world has one sanctuary, marked `"sanctuary": true` on a place in its pack data (the Mirror attic for the reflected shore; Badger's glade is part of the Lonely Forest, whose sanctuary is the Cosy Cottage; the Willows has none). Wait is always one turn, everywhere. Since rules 89, a player's Wait right after a Wait is offered as **Sleep**: the same `wait` play with `sleep: true` and the label "Sleep", never aboard a ship or during a standoff. Sleep is not offered beside a lit lamp with one oil left, so the burnout always comes on a plain Wait. The sleeper (`actor.sleeping = {since, place, present}`) may sleep on or choose any other play, which wakes it first ("Vale wakes."). It wakes after the round's lamp burn at the first change where it sleeps: it is moved, the lit lamp there reaches its last oil or runs dry, someone physically arrives or leaves, a way out opens or closes, a standoff holds it, a ship docks there, dawn or dusk comes, or 24 turns pass. The wake line names the reason (`woke`), as in "Vale wakes as the lamp gutters." A Sleep at a sanctuary that lasts 12 turns or more is a long rest: on waking, defeats clear and the wake event carries `rest: "long"`, which makes a thought and a dream due and may bring the level quest. A shorter Sleep there, like a plain Wait, clears defeats without a dream. Sleeping on at a dock calls no ship. Solo play runs the world on until the sleeper wakes; in a shared world the others' plays move the clock. A sanctuary allows Threaten but never Attack. Resting gives no experience. See [rest and sanctuary](../docs/card-table/rest-and-sanctuary.md) and [#2028](https://github.com/cenetex/cosyworld/issues/2028).

A wake plays on the table (`sleep-presentation.mjs`, `sleep-view.mjs`, `dream-card.mjs`; presentation only). A Sleep that ends across dusk or dawn fades the stage to black (900 ms), holds the black (700 ms) and opens on the new light over 2.5 s: dawn on full daylight, dusk on night, since the stage grade (`stage-light.mjs`) meets the rules' light at 06:00 and 18:00. A Sleep that crosses no light only dims and lifts. A long rest that deals a level quest first shows the dream: the dark keeps only the dreamer, a **DREAM** card (its name at the top in the Common colour) enters as a beat in the dialogue stack, reads "Dreaming…" while the existing reflection is written (two taps cancel it), and its words reveal with the dialogue's letter reveal, or read "…" when none come. The quest is then dealt face down on the stack (behind the dreamer when folded) and the light returns. The dreamer's own spoken line on that wake is not shown, and the DREAM card stays in the stack. An ordinary long rest shows no dream card (owner, 2026-11-04). A tap finishes the current beat but never skips the quest's arrival; reduced motion crossfades. A place with no night painting takes the full night grade with a cool tint. `node v2/scripts/smoke-card-sleep-dream.mjs` drives both wakes at 390 and 1440 px and under reduced motion; `COSYWORLD_SLEEP_FRAMES` saves its frames.

- Defeats one and two: the loser drops the disputed item and retreats, as above.
- Defeat three: the loser drops everything they carry where they fell, their own belonging included. Then they go home. Nothing goes home with them, and the count clears. An avatar without a reachable home retreats instead.

Going home this way crosses nothing. It does not discover a crossing, move a crossing's signal, or anchor the attic during the opening.

Every home has a way out for its own avatar. The attic opens a narrow path to Black pond, and each visitor's home one to the Empty station, when the lamp or belonging is out of reach. Getting back in still needs the lamp or the belonging. A test checks every active home with empty hands.

### Fight events

Strike is the rules action `attack`, Brace is `guard` (no target) and Cover is `intercept` (the covered combatant is its target); the table renames only the words, so saves and the journal keep those kinds. The rules' own journal lines still say "guards" until the next rules version. The attack action (`kind: "action"`, `verb: "attack"`) records the hit:

```js
{
  kind: "action", verb: "attack", actorId, targetId, locationId,
  damage: 2,               // resolve removed
  guarded: false,          // the defender's guard softened the hit
  resolveBefore: 1, resolveAfter: 0,   // the defender's resolve
  outcome: "hit" | "guarded" | "yield" | "sent-home",
  coveredId: "moth",       // only when a Guard took the hit: the one aimed at,
                           // and targetId is then the guard
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

A standoff play is shown beat by beat before the new world is drawn. Each beat opens with a telegraph above the actor (a warning sign for Threaten, a shield for Brace, crossed blades for Strike) and a stage caption such as "Pip strikes Vale…". Before the first frame the two fighters turn to face each other, whoever they were watching, and fighters in an open standoff keep facing each other between plays. The stage pushes in and dims (on phones it only dims, since the step into the wider two-shot is already a camera move), and the place's painting recedes behind the fighters: it fades to 45% over the telegraph (360 ms) and pushes in less than the cast, so the fighters and cards stand forward (`combat-backdrop.mjs`). It stays back while a standoff is open in the player's room and eases back in over 0.9 seconds when the fight ends; after a loss it returns at once under the black, so the lift shows the new place whole. It is an opacity change, cheap on phones, since the painting's filter carries the weather's light; reduced motion cuts to the same dim. The fighter a strike aims at takes a soft gold rim light over the telegraph. An attacker lunges, the target holds for a short hit-stop, recoils and shakes once, the scene shakes by the recorded damage (2, 4 or 7 pixels), and the stage shader brightens the whole scene once toward warm white, more for a harder hit (no red; without WebGL the target's body brightens instead). A slim four-part resolve bar under each fighter drains with a lagging ghost, its fill cooling from gold toward moon blue and pulsing slowly at the last point, an outcome word ("−2 resolve", "Braced −1", "Yields") rises over the target and replaces that fighter's last word, and the step joins the beat stack and Memory as that fighter's beat. Fighters in an open standoff keep their pips between plays. In a battle every combatant shows pips. Each exchange steps forward in turn: the actor, the one it aims at and any guard taking the hit (standing between them) move into the scene's front slots facing each other, while the other combatants step back and dim; between plays the latest exchange keeps the front (`scene.mjs`). On phones each combatant takes its own mark instead of the scene's three-person spots: the exchange at the two sides, any guard between them, and the others smaller and further back in the middle. The exchange's marks keep each fighter on screen, and fighters ease into them over 0.6 seconds. Reduced motion swaps the places without the slide. A Cover telegraphs a shield with an arrow and the caption "Pip sides with Vale"; its redirected hit recoils, drains and floats its word on the guard. A strike at someone the striker had guarded, or who had guarded it, reads "Pip turns on Vale". Nothing about sides is stored: these captions read only the latest plays. Telegraphs carry `data-verb` (`threaten`, `guard`, `intercept`, `attack`) and figures carry `data-battle-row` (`front`, `back`) for the art pack (#1920). Its painted stills overlay the fighters: a `hit-1`/`hit-2`/`hit-3` burst by the recorded damage at impact, `brace-absorb` when a brace soaks a point, `brace-raise` when a Brace commits, and a `swipe` trail that starts at the attacker and runs toward the target, so it stays on screen; the target recoils away from its attacker's centre (a `jab` for a short reach or a fighter without strike art). They fade in and out and, with motion and "Flashes and scares" on, scale; reduced motion shows the still. The brightness flash stays as before. While the beats play, the locked hand tucks straight down to a strip of card tops, so it covers neither the fighters' feet nor the impact, and it rises back to where the player left it, raised or resting, as the beats end. It cannot be tapped until the new scene is drawn; only the player lowers it. The stage caption reads below the top bar, never over the place name or, on phones, the logo and menu button; phones cap it at three lines. It keeps one width at each breakpoint and its words crossfade over 160 ms from beat to beat, so the box never jumps or re-centres (instant with reduced motion). In shared play another player's strike or move locks it only while those beats lock the hand anyway. The dialogue steps out of the fighters' way and returns for the speech that follows: above a raised hand it fades out in place, beside a resting desktop hand it sinks to a strip at its foot, and on phones and tablets it stays in its box over the hand's foot. During a fight's beats it fades out at every width, so the beat from before the fight never covers the fighters' feet. Captions lowercase a name's leading article mid-sentence ("Vale strikes the keeper…").

Published brace (`guard`), strike (`attack`) and hit paintings follow those beats and preserve the player's plain or scarf wardrobe. A committed brace keeps its raised-arm portrait until consumed or cleared. Beat images preload before playback; unavailable art keeps the existing portrait. A cast painting whose canvas pads its figure differently from the plain portrait drops and scales by its measured fit in `assets/combat/pose-fit.json`, so its feet stay on the floor and its figure keeps the plain portrait's size; run `node v2/scripts/build-combat-pose-fit.mjs` after adding or replacing paintings. The Keeper uses his unmirrored right-facing neutral portrait when the scene faces him right, since his combat paintings face left. Combatants fit inside the phone frame throughout a beat: each figure keeps its own painting's framing, and on phones the two fighters of the exchange share one scale, so a strike painting swapping in never resizes its fighter. Those behind the exchange turn to face it; Pip and the Keeper keep that framing between plays too. Carried props stay in their cards while combat arms are raised, and the normal portrait and framing return when playback ends or is cancelled.

When the player loses, their figure slumps and greys, and the scene fades slowly to black, like losing consciousness (1.4 seconds at 1×, half that at 2×; reduced motion cuts to black). On the black, the loss screen (`defeat-view.mjs`) shows who drove the player off and what they lost as full-art cards, the winner first, as the hand draws them. Under the cards, never on them, the dialogue's reveal writes "Pip drove you off." with its caret, then inscribes each change as a plain caption, with no icon: dropped items, "Sent home." on the third loss, and "You wake at <place>." It is worded from the rules' committed fields, never by AI, and announced once. It has no buttons and no modal. A tap, Enter, Space or Escape shows the words whole, and the next moves on; left alone, it moves on 2.6 seconds after the words are whole. The words fade, black holds a breath, and the black lifts slowly and wordless (2.5 seconds at 1×) onto wherever the rules put the player. There the hand plays on as usual, and the player's beat repeats "You came to at <place>." The arrival line comes from one voice: a resident at the new place, or the player's avatar when nobody else is there. Its brief is one short fact: "Vale was beaten by Pip and came to at Empty station." Its song, Moonstone Sanctuary, comes in after three beats of silence and fades out fully before the lift (see the music section). Local and shared tables show the same screen from the same committed beats.

Tapping the stage finishes the current beat; its outcome text still shows. Settings › Fight speed switches between 1× and 2×. A full fight stays under three seconds at 1×. Reduced motion replaces the cut, lunge and shake with outlines and fades and keeps all text. The flash follows "Flashes and scares". Local and shared tables play the same beats from the committed log (`combat-beats.mjs` reads the rules' structured attack and retreat fields, falling back to standoff state and the rules' lines; `combat-view.mjs` draws them).

Each beat has a light, storybook sound made in the browser (`combat-sfx.mjs`; no sample files): a whoosh when a fighter swings, squares up or steps in to guard someone, a bam when a hit lands, a bigger pow for a hit of 2 or more, a wooden block when a brace commits or soaks the blow, and a low thud when someone is beaten. Each is a few Web Audio voices: filtered noise sweeps and pitched thumps. Pitch varies by up to 5% and filter by up to 10%, seeded by the beat's sequence number and phase, so the same beat always sounds alike. They play through the bell's player (`sfx.mjs`) only after a gesture unlocks audio. They follow the Voices switch, like the letters' blips, and the shared volume, at 0.4 of it, under the battle song. A hidden tab or open Settings silences them, and a beat tapped through lands silently.

Run `node v2/scripts/smoke-card-combat.mjs` for a lost battle at desktop, phone and reduced motion, two-handed against Pip and three-way against Antigone with Pip behind the exchange; it checks that the two fighters stand apart, the strike trail stays on screen, and the loss screen has no buttons and moves on to the new place.

Card selection keeps the current card elements in place and leaves keyboard focus on the tapped card. The hand opens over 220 milliseconds; held items slide out from their owner. A play leaves the hand where it is: a raised hand stays raised and keeps its scroll, and a play in the same place refreshes the cards in place. A thing the player's own play puts in their hands (a Take, or the other side of a trade) is in the hand at once, face up: the row scrolls just far enough to show it beside its new holder, without waiting for the play's words (`node v2/scripts/smoke-card-reply-wait.mjs`). Travel changes the cards while the scene veil is down. Rapid taps reverse the current motion. Reduced motion applies the final layout at once. Menu and Memory keep the selected cards and open items, and Escape closes the active panel before lowering the hand. Only a click on empty table space (the stage, outside the cards and the dialogue; not the toolbar or action beat) or Escape folds the hand to its resting row; a play never does. Both clear the selection, held items included, so the action beat fades and the full dialogue card comes back; a play already chosen keeps its Thinking card. A tap on the dialogue steps its beat and leaves a raised hand raised. Nothing but the player's own action moves the hand: new beats, shared updates and another tab's save leave it, and its scroll, as they were (a card that leaves the table drops out of the selection). Selecting, changing the pair and deselecting keep it open, as does a tap on empty hand space. The hand has no scroll arrows: a swipe, drag or wheel reaches cards past its faded edges. A held item stays raised with its plays, and any tap on the folded hand opens it again. Short landscape screens keep the hand inside the viewport.

A ready play is an action beat, shown only while the player is choosing (`presentation.mjs`, [dialogue beats](../docs/card-table/dialogue-beats.md#what-is-in-front)): never over a line still being written, which keeps its full-size card, and never over the rest of an exchange. A choice made meanwhile comes forward once the lines are read. A ready play's beat is a card in front of the dialogue with small cards of who acts and what it acts on (the chosen cards, or the place for Wait), what the play will do ("Vale gives the Burial Decree to Creon.") and its buttons, square-cornered like the beat cards, as on any screen width. The plain Wait is offered only when the selection has nothing else to do: the Forest Clearing's card rings the Steam Clock, Vale's own card still waits, and Sleep or "sleep on" is never dropped. Aboard a ship under way (course set or at sea), choosing the ship's card, alone or with Vale's, reads **Sail** ("Vale sails on."), the words the pack gives the transport (`waitVerb`, `waitSentence`), because each round passed carries the voyage on. Vale's card alone still reads Wait ("Vale waits one turn."), and Sleep is never offered aboard. A docked ship keeps Wait for every selection, and the rules action and journal stay `wait` either way ([#2027](https://github.com/cenetex/cosyworld/issues/2027)). The spoken beat fades into the slot behind it, one dimmed line, and comes back to the front when the play is chosen, which leaves the beat for its Thinking card; a held item's next plays return when the player raises the hand or chooses again. Nothing lies between the dialogue and the hand, and the hand never moves for the beat. A strike or journey hides it while the dialogue steps aside. The status line (#1725) sits in the action beat, above the buttons; a shared refusal that lands while a line is being written waits for the line. Captions name a thing with one article: "Vale took the Burial Decree". `node v2/scripts/smoke-card-action-spot.mjs` checks the beat at 1440, 1900, 765, 390 and 844 px, with reduced motion at 390 and 844.

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
   visitor's home keeps its rescue path to the Empty station.

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

The new-world title plays its own song between the acknowledgement and the card reveal (see New-world title); room music waits until the title is gone and its song has faded.

Music loading starts when playback is ready: after the first accepted play
(in the attic opening, the pond reveal), with music enabled and the page visible. A place triggers a song when music
is idle. Each song follows the player through travel until it ends. The current
place chooses the next song. A quiet place lets the player hear the landscape.
Mute and hidden tabs pause the same song for a later resume.

Switching tabs or apps on a phone keeps the song's place. A hidden tab pauses
the room song (after a one-second fade) or the title song (at once) in place.
Phones also put Web Audio to sleep: Chrome reports `suspended`, iOS Safari
`interrupted`, which plays the song silently. On `visibilitychange` or
`pageshow` the player wakes its context (`audio-wake.mjs`) and fades back in
from the same moment over 0.4 seconds. It resumes only what was playing, with
music still on; the title song stays quiet once the intro has ended. iOS can
refuse to wake audio without a gesture, so the next tap or key does it, with
the same fade and no error. A call or Siri that interrupts audio in view is
woken the same way. The hum and the bell wake their contexts too.
`test/card-music.test.mjs` and `test/card-title-song.test.mjs` cover the
return.

A cue (`music.cue(name)`, `music-cues.mjs`) takes over from the room song,
which fades out over a second, pauses in place and returns from there on
`music.cue(null)`. Cue songs loop seamlessly, follow the music switch, volume,
hidden tab and opening wait, and never restart while their cue holds.
`"battle"` (_The Attic Keeps Its Lamp_, 1:18, in over 1 second, out over 1.5)
plays while the player's room holds an open standoff, from the threat to a
round without a Strike, the item's release or a defeat that leaves one
fighter, and while a fight's beats play (`battleMusicDue`). When the player is
driven off, the battle song fades out over 1.5 seconds under the fade to
black, three of its beats of silence follow (1.9 seconds at its measured 95
beats a minute; the presentation has no beat unit of its own), and then
`"battle-loss"` (_Moonstone Sanctuary_, 2:59) fades in over 5 seconds on the
loss screen. When the player leaves the loss screen, the song fades out fully
over 2 seconds on the black (the `"hush"` cue, which keeps the room song
waiting) before the slow lift onto the next scene, where the room song returns.
A loss screen left inside the silence never starts it. `test/card-music-cues.test.mjs`
covers the transitions.

River Camp chooses
one of four supplied acid jazz songs during the day. An active camp song keeps
playing through dusk and night. Run `node v2/scripts/smoke-card-music-network.mjs`
for the throttled request and first-sound checks. `test/card-music.test.mjs`
covers songs that follow travel.

Room music starts with the first accepted card play in a new game. In the Vale attic opening it waits longer: the lamplit attic stays silent until the lamp goes out (doused or run dry) and the mirror first shows the Black pond; the music fades in at that moment. The browser remembers that world's reveal (`cosyworld.music-revealed`), so a reload keeps the music even if the lamp is lit again. A world without the attic opening, an avatar other than Vale, or Vale outside the attic plays music from the first play as before (`openingRevealed` in `music.mjs`). In a shared world, each avatar starts in silence until their own first accepted play, such as picking up or using their item. The saved play journal keeps that choice across reloads. The opening scene and menu wait for that play. Music off stays off at the reveal. Starting another new game resets this wait and keeps the saved music and volume settings. `smoke-card-music.mjs` checks the silent attic, the reveal fade, reload, a new world and music off (`music-reveal-check.mjs`).

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
The top of **Memory** shows the playing avatar's own. Every avatar
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
one requested speaker succeeds. In a local save, `POST /card-game/text` answers
with lines only. Once the line is shown, the browser asks
`POST /card-game/reflections` for the due thought, persona and dream, so a
reflection never delays the line or turns it into a failed scene
([#2016](https://github.com/cenetex/cosyworld/issues/2016)). A scene with no
one due is answered at once without a model call. That request has its own
capacity and one slot per client. The client's next scene cancels it, and a
late reply for an older turn is ignored. A failed reflection is simply
skipped. Omitted cards keep their saved words. Shared
play requires both selected voices and journals the committed text through the
existing shared dialogue event. Shared speech uses the same transcript and
visible-state checks. From rules v88, shared reflections are generated after
the line is journaled and saved in a later `reflect` journal op, so they never
delay or fail the line
([shared worlds](../docs/card-table/shared-worlds.md#learning-and-private-reflection)).

Optional voice tiers are enabled with exact model IDs in
`COSYWORLD_CARD_REFLECTION_MODEL` and `COSYWORLD_CARD_ESCALATION_MODEL`.
Both settings start unset. The reflection tier writes an avatar's lasting
persona in local play. Public speech, thoughts, and dreams use the character's
own model. The escalation tier speaks when the selected model fails
(`card_narrative/fallback.rs`): a provider error, an empty reply, or a timeout
moves to it at once, and a reply the validator blocks moves on after the
voice's attempts (two by default). It is also the voice's fallback
while the character's own model route is open after repeated provider faults
([runtime readiness](../docs/ai-capability-registry.md#runtime-readiness-and-account-probes)):
the own attempts fail at once without a provider call, and the escalation
attempt runs with up to one call timeout. A model whose route keeps opening, or
whose voices keep ending with no usable line, is benched for six hours and is
treated the same way
([model bench](../docs/ai-capability-registry.md#the-model-bench)).
Neither Fly site sets an escalation model today, so an open route or a bench
still leaves that voice "…". All tier models must qualify for
world content in the current registry and data policy. Equal selected models,
including two IDs for the same concrete model, share the original attempts.

Each model gets the scene's remaining time split over the models still to try,
up to one call timeout per attempt, and a quick failure passes its share on. A
voice starting the hosted twenty-two-second scene with an escalation model has
eleven seconds on each. A lone model keeps all its attempts. Queue waits use the same deadline. Every returned line
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

`weather-shader.mjs` paints the weather, and on the stage the hour's grade,
with one WebGL fragment shader. The
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

### Light and time of day

The rules keep two light settings of twenty-four plays each. The stage reads
the same committed turn as a game hour (`stage-light.mjs`): turn 0 is 06:00,
each play is thirty game minutes, the painted night begins at 18:00 and
midnight is turn 36 of each 48-play day. Eight visual periods blend smoothly:
dawn, morning, noon, afternoon, golden hour, dusk, night and midnight. The
hour's shade and edge vignette darken the painting and its desaturation
greys it. The stage shader draws the shade and vignette on the stage's one
WebGL canvas, which now stays on the stage with clear skies too: it blends
hard-light, so the grade multiplies while rain and mist still brighten, and
weather tones darken continuously toward midnight. With nothing to draw it
hides; with clear skies it draws one frame at half resolution. Without WebGL,
`.stage-grade` in `weather.css` multiplies the same grade. Figures and props on the stage take
the same light as a filter, while lit lamps keep their glow. The hand,
dialogue and place cards are never graded. A place without night paintings,
such as the Lonely Forest, takes the full grade, so its midnights are dark. A
painted night keeps only a quarter of it so its art is not darkened twice
(#1696). `stage-light.json` (client data the rules never read) gives a place
its own share (`grade`: the attic and station 0.6, the dark Black pond 0.4,
the already moonlit Moonlit Trail 0.25), whether it is open to the sky (`sky`), and light pools that stay warm
as the room darkens: the attic's lamp, lit only while the lamp shines there,
and the cottage hearth. Pools glow from dusk and ease as a lamp is lit or
doused. The shader draws up to four; the CSS fallback lifts the first. A
place's `stars` box marks its painting's open sky, where stars come out from
dusk, and `moon` places a soft moon; cloud hides both. Only the Rain-Soft
Garden has them so far. Painted nights keep their own stars and moon. Every play eases the light over four
seconds; a jump of more than four plays (a long rest) is a three-second
time-lapse through the hours between. Travel and
reduced motion cut. It is presentation only: the rules, saves, journal and
shared engine never read it, and every viewer of a world sees the same hour.

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
speech says it. The speaker is offered it as something to mention if it fits the
conversation; a reply without it is still spoken, with no retry, and the lane
stays for another Talk. A gated lane is told with what opens it ("…only with Travel
Provisions aboard."). A story choice that is ready at the port is told first, so a
new lane never holds up an authored scene. Lanes are saved as `sea:` edges in route knowledge.

See the Greek pack README and `test/card-theban-release.test.mjs`; the scene
journey is `v2/scripts/smoke-card-theban-scenery.mjs`. The weather journey is
`node v2/scripts/smoke-card-weather.mjs`.
