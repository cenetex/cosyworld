# Card world text and memory

## Shipping engine

`world.mjs` owns the card game's state, legal actions, resident turns, and save
format. `forest.json` holds the forest catalog, starting state, and authored
quests for the station, attic and pond openings. `createWorld()` copies that data
for each game. `app.mjs` uses the engine in the browser. The modules beside it provide quests,
motives, life, memory, pack rules, and presentation. Both the local server and
the Rust asset server publish this same game.

[lonelyforest.com](https://lonelyforest.com/) receives deliberate versioned
releases. [cosyworld.fly.dev](https://cosyworld.fly.dev/) tests changes from
`main` through automatic deployment.

Build new game rules in these shipping modules and check them through
`test/card-*.test.mjs`. The [generated-world backlog](../../docs/backlog/generated-world-core.md)
keeps the useful ideas from the retired standalone engine, with its source
revision for reference. Existing player saves use `world.mjs` and
`legacy-saves.mjs`; keep their migrations with changes to the save format.

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

Stage images use full-size WebP copies. Hand cards and small portraits use
512-pixel copies. Transparent parts keep their original alpha values. Authored
image paths keep their identity in saves and rules.

`media-manifest.json` records the SHA-256 of each published image and audio
response. `mediaUrl()` adds that hash to the URL. Browsers can retain those
bytes across visits. A changed file receives a new URL. Other static requests
use content validators for a short revalidation reply.

Music stream URLs expose the original MP3 audio frames after the leading ID3
metadata. The original MP3s keep their metadata and remain available at their
published paths. Each stream has its own hash and byte range support.

Commit the generated image map, WebP files, music stream map, media hashes, and
`v2/orchestrator-rust/src/card_assets.rs` with their source changes.
`npm run v2:card:pack:build` rebuilds this set and the pack data.
`npm run v2:card:pack:check` checks it during CI and release gates.

## Character voices

Pack residents can set `expression` to `speech`, `movement`, or `emoji`.
Speech is the default. Movement replies describe a small visible gesture and
appear as narration. Emoji replies use two to five symbols from
`emoji-symbols.json`; their English names supply the accessible reading.
The server reads the expression type from the authored character profile.
Spoken audio and letter sounds follow speech replies.

Spoken character voices use the player's OpenRouter credits and account routing
settings. Written dialogue uses the game's account. Provider retention follows
the chosen account settings and provider policy. Temporary provider errors can
retry; request, account, and routing errors return control to the player
immediately.

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

## Quests through Talk

Cards choose things; the world chooses the verb. The hand therefore holds only
people, items and places. Quests have no cards, stack, buttons or reveal
dialog. Each avatar still keeps its saved quest collection, focus, hand of at
most two carried quests, progress, receipts and history. Old saves load with
all of it.

The cast tells the player about quests in conversation. `quest-talk.mjs` reads
saved state and adds up to three first-person facts to each avatar's Talk
context:

- **What I want most now** — the carried quest the speaker most recently
  advanced or heard news about (a learned topic that its step asks for). With
  no such quest, the rules' saved focus leads, then the newest card.
- **I also want to pursue** — the other carried quest, and any quest the
  speaker finished in the last two turns with its outcome.
- **Help needed here** and **Open story here** — unfinished help, story and
  shared quests whose holder is at the speaker's place. A person holding one is
  named.

Talk keeps two learned facts per speaker. A fact that is about to be told
leads, then a known fact that an open quest asks about (a `knows` topic in its
steps), then the newest news. The speaker's spark ("It started with …") and
missing items, places and company still come from the motive and desire facts.

These facts use the public card wording from `quest-cards.mjs`. Step lists and
authored purposes stay in the rules. The text is narration context only: the
rules still decide legality, progress, focus and rewards, and building the
context never changes the world.

The rules keep their quest actions (`pursue`, `join-quest`, `share-quest` and
`drop-quest`) for residents, journal replay and shared play. Residents still
choose them. Ordinary plays advance every matching carried quest, so the
player needs no focus control.

Run `node v2/scripts/smoke-card-quest-collection.mjs` to check that the hand
has no quest cards, that saved quests survive reload, and that Talk sends the
quest facts at desktop and phone sizes. `test/card-quest-talk.test.mjs` checks
the facts, their order and their bounds.

## Image-first presentation

Card faces contain the illustration and a small name. Tapping a card toggles
its selection. Selecting a card or pair shows named actions in the row below.
Tapping an action button plays it. The current place leads the hand, followed
by items lying there, avatars with their carried items, and travel destinations.
Arrival starts the hand at the new current place. Selection keeps its scroll position.
On wide screens, the resting hand occupies two card widths at the right. Dialogue
sits at the left. Selecting a card opens the hand across the screen and moves
dialogue above it. Swipe, use the wheel, or use the arrow keys to reach more cards.
Play stays available during an exchange. A waiting play shows **Queued**;
tapping it again cancels it. Selecting another card clears the waiting play.
Shared play waits for the player's current turn to finish, then checks the
chosen action against the current table before sending it.
Selection, cancellation,
drag pairing and keyboard navigation spend no turn; only a committed play does.
The latest selected carried item appears in the player's avatar hand.
Clicking the scene keeps that item selected and held. Tap its card again or
press Escape to clear it.
The preview follows the figure's facing and movement and shows the item's light,
ringing, and covering. Lowering that card returns to the other selected item;
clearing the selection clears the preview. Giving or dropping the item clears it
as soon as custody changes.

No card face or hover text exposes quest checklists, levels, hope fractions,
Inspiration, fuel arithmetic, ringing deadlines, or ritual phases. Each newly
met card appears briefly over the scene, then flies into the hand. Held items
fly toward their owner's stack. A glow marks the new card until selected.
A tap or Escape advances the reveal; reduced motion uses a brief still reveal.
Travel and arrivals finish first, and dialogue follows the discoveries.
Saved discovery records keep each reveal to the first encounter. Observable changes
belong in the scene and art; hidden conditions never become a progress indicator.
Accessible descriptions report the same observable facts, not extra puzzle clues.

Lamp and cloth manipulations need no generated commentary. Social exchanges,
travel and the existing authored bell echo retain their speech. The optional
Conversation panel and export contain spoken lines, not an objective journal.
Basic controls are available on request in Menu, without combination recipes.

This presentation change preserves the existing simulation and save fields;
it does not erase saved levels or replace the resident motivation system.
Forest owns crossing mechanics. No new gate format is introduced here.

Run `node v2/scripts/smoke-card-image-first.mjs` for real desktop, phone and
short-landscape checks. It exercises keyboard, scrolling, selection, drag,
ritual reload, visible state, travel and conversation without paid model calls.

## World packs and the Wine-Dark Sea

At quiet Black Pond, the fueled Lamp and Black cloth can summon a ship.
Board it, then disembark at **The Wine-Dark Harbor**. The local path leads
to **Before the Burial**. The ship keeps its dock and passengers in the same
saved world. Once summoned, it remains available for later crossings.

After a public Theban response, Dione offers the next journey at her table.
Accepting opens **The Open Door**: the Athenian Agora, Piraeus Quays, Colonus
Grove, Eleusinian Sanctuary, and Marathon Altar. The invitation opens the
roads for every traveler in the shared world. Athens Harbor and Piraeus join
the ship’s stops. Athens Harbor connects directly to the grand Agora through city streets.

Seven shared road scenes connect the towns. Each road has two fixed ends,
shown by destination cards in a fixed order. Avatars come first in the hand,
followed by the first end, the road, and the other end. Its entry card names the place ahead.
Travelers can meet, wait and carry objects on the road. Myrine’s coast walk
passes through the same road scene in two Accompany plays.

Run `npm run v2:card:travel:smoke` for desktop and phone trips through Athens
Harbor, the Agora, inter-town roads, Piraeus and the return to Dione. The check
also tests the destination cards, a reload on the road and waiting for the ship.

Athens Harbor shows the ship at its berth when it is docked there, and open
water while the ship travels elsewhere.

At an open port, Wait lets the empty ship continue its circuit. Resident
passengers use the same vessel. The first human passenger ashore chooses the
arrival port for the company. Other passengers can step off there; boarding
at that port starts the next voyage. The lamp signal still calls the ship to
Black Pond. Existing saves keep their positions, belongings, stories and poems.

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

## Greek story cards

Three story cards follow the saved Theban outcomes. Each shows one line:
**A place beside the bread.**, **Her brother waits for earth.**, and
**What words will you bring home?** Their completion labels follow the
chosen outcome: **Fulfilled**, **Declined**, **Reported**, or **Shared**.

The Bard appears in the next room the player enters after a quest ends.
His conversation context holds the earned poem in order. Talking to him
invites an earned couplet. Permission, burial, refusal, and warning each
keep their own verses. A later permitted burial opens the return to Dione
again. The [exact copy list](../content/greek-drama/OPENING-POEM.md) records
every verse and the three card lines.

Story quests have no card in the hand. Their lines reach the player through
Talk: the people who carry a story, or stand where it is held, mention it in
conversation. Saved story records stay with the traveler through a trip home
and the rest between personal quests. Existing saves derive them from their
recorded meetings, choices, and flags. Completed stories remain complete after
reload.

The Open Door adds six story cards with one short line each. The mothers’
petition leads from Eleusis to Athens and the quay. The keepers at Colonus
and Marathon name the earlier and later generations of their tales. Current
gifts, heard reports, and chosen endings earn distinct verses. The final card
leads back to Dione. The [scene and source guide](../content/greek-drama/OPEN-DOOR.md)
records the full path and each original adaptation.

Run `node v2/scripts/smoke-card-open-door.mjs` for the complete desktop and
phone journeys, alternate choices, object care, reloads, cards, and Bard.

The completed Athenian stories and a return to Dione open the Ajax chapter.
Its shield, spoken plea, three burial routes and signed return account are
described in the [chapter guide](../content/greek-drama/AJAX.md).
Run `node v2/scripts/smoke-card-ajax.mjs` for all three desktop and phone journeys.

## Personal quests and lasting hopes

Personal and shared quest programs use `quest-progress.mjs` to capture evidence,
advance one step per turn, apply each shared effect once and save completions.
Pack stories use `storyQuests` in their authored data. The
[story quest guide](../docs/card-story-quests.md) explains how another pack can
use the same rules.

Talk can share one saved fact. Authored topics and witnessed deeds supply those
facts; each listener keeps the source and teller. A checked spoken reply teaches
the fact and can unlock an authored scene or a quest step. Later Talk can pass
heard news to another person. Greece's spoken clues now use this path, including
the mothers' plea, the decree and the returning reports.

The browser enables `personalQuests` alongside motives. The first quest gives
each avatar a starting purpose. A completed quest earns a level. The avatar then
heads to a sanctuary and rests there for three turns. Shared human avatars count
their own turns; residents count world rounds. A meaningful experience can seed
the next purpose after rest. A long quiet spell also gives the avatar a fresh
purpose. The new quest can first advance on the following turn.

Each avatar has a lasting hope and three milestones. Generated quests favour
the next feasible milestone, then recent experiences and variety. A quest
that fulfils the next milestone records its completion turn. The hope and its
completed milestones stay with the avatar through later quests. Earlier
authored quests keep their order as the opening story.

Favourite belongings have lasting value. A received gift gains a saved
attachment to its giver. These reasons affect gifts, prices and autonomous
handover choices. An explicit delivery quest can give an attached item a new
purpose. Talking, giving, trading and accepted invitations create three turns
of shared time. Residents can tend items or talk during this time. A grievance
still lets them seek space. The player chooses Vale's actions throughout.

Talk carries the current purpose. Personal relationships and lasting hopes may
inform speech.

Schema 6 saves gain validated `life` state. Life version 2 records experiences,
rest, hopes and attachments. Loading an earlier save keeps its active quest,
earned steps, items, memories and levels. New-game and cross-tab save updates use
the same setup. The action history and lasting experiences have separate bounds.

Run `npx vitest run test/card-personal-quests.test.mjs` for the quest cycle,
repeat limits, attachment and company rules, hope selection, save migration,
validation and deterministic mixed-play checks.

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

Every avatar, item, and location has a profile in `entity-profiles.json` and a saved memory in the browser world. A memory holds the latest 16 witnessed events, six lasting encounters, and the latest generated text. Gifts, trades, threats, shared trips and quest effects can become lasting encounters. Card plays record events for the actors and objects present, the item used, and both places during travel. Generated speech and descriptions are marked as expressions, so the next prompt can distinguish them from game events. Speech receives recent facts and a few lasting encounters. Earlier quest counters stay in saved history. Each avatar's voice, beliefs and fears give its request or response a personal reason.

Speech receives visible facts, current wants, and witnessed results. Entity profiles describe appearance and personality. Quest step lists, authored purposes and hidden interaction rules stay in the simulation; each avatar's facts include the public quest lines described in [Quests through Talk](#quests-through-talk). A revealed path joins the location cards; travel happens when its card is played. Earlier opening expressions stay in saved history while fresh speech uses observations until the first light.

When a play calls for speech, the browser sends the current local entities and departing avatars, their facts, avatar interests, and eight recent memories, witnessed events, and the four latest spoken lines to `POST /card-game/text`. The Rust service adds the authored profiles and uses the existing AI gateway. The deployed character map sends each avatar to its own exact OpenRouter model. Items and places each have their own voice call. These calls run together inside one bounded scene request. Each call returns a brief plain-text reply, which the service validates before publication. A short unpunctuated reply can pass when the provider confirms it finished. A trailing continuation mark or an unfinished first line triggers the usual retry. Complete sentences and voluntary quotations keep their wording. Each entry carries its own model attribution. Raising a card prepares a play and keeps the current conversation. Playing a card commits the action; social actions and travel can start an exchange, while ordinary object manipulation can remain silent. The place, played item, and chosen speakers also receive scene beats. A quiet turn with departures gives the farewell to the moving cast, without an automatic Vale recap. A Stay without departures keeps Vale available. Direct interactions, combat, travel and introductions retain their relevant speakers. A departing avatar says where they are going and why; their recorded farewell belongs to the source scene. The prompt includes the completed card play so their lines form a question and answer or a shared reaction. A separate resolved-turn record gives the played verb and outcome, every avatar's final location and holdings, exact travel companions, and final item ownership. Accepted accompany plays record both travellers; independent trips record an empty companion list. Current results take priority over desires and remembered speech. When Vale speaks on a wait play, the words stay at the place where Vale stayed. A solo farewell frames desired company as a hope for later.

The conversation shows the current spoken line; earlier words are available in the optional Conversation panel. The browser buffers each exchange until it passes validation, then reveals complete letters on a local clock with short pauses at punctuation. The selected speakers take their turns in order. Each exchange advances after a reading pause. Tap the text to finish a line, then tap again to hear the next speaker. The hand pauses for up to 2.5 seconds while words are generated. A slow request can be replaced by another play. Once a complete reply arrives, the hand locks through scene preparation and every speaker, then becomes ready after the last reply. A blinking cursor marks the end. Earlier scene lines can be replayed with the line controls and History. A replayed line stages the avatars present now; a speaker who has left keeps the words and stays off the stage. Vale, Mara, Pip, the Keeper, Badger, and Dione speak with their original cloned voices when OpenRouter is connected. Settings toggles voices. Other speakers keep their soft, pitched voice sounds. Reduced motion shows full lines at once. Hidden tabs and open menus pause playback, including the rest of a punctuation pause. Text reveals on browser paint frames. Each visible line keeps its own height, and portraits stay mounted when the speaker changes. Empty prior replies and speech rows collapse. A scene with no words shows a compact loading line. A spoken card play immediately shows its first speaker with a loading mark. Ask and Talk show Vale while the reply is being written. The browser saves complete text before playback begins. Fresh tables request an opening exchange. Reloading resumes saved dialogue from the current turn. Action records remain in the saved world and scene export.

The stage holds up to three avatars. Vale stands in the foreground, with the other two farther back. The composition mirrors when Vale returns from the other side of a route. Seats and sizes stay fixed throughout an exchange. The speaker and listener face each other; another witness looks toward the speaker. The keeper has a separate right-facing cutout, so the clock face keeps its painted detail. A soft lean and light change mark the speaker. Carried item symbols follow recorded custody, including covered items. Actual arrivals fade in together for an accepted accompany play. A farewell finishes before its avatar fades out of its seat. Quiet actions update the stage cast immediately to match the hand and current locations. Reduced motion uses still poses. The scene script exports each actor's position, depth, scale, facing, gaze, pose, travel companions, and carried items for each beat. The browser uses `portrait-facing.mjs` to match each painted portrait to that gaze. This presentation-only map covers the human cast, pack portraits and Keeper variants; add new portrait files here with their native direction. Hand thumbnails keep their native artwork.

A raised card keeps the current conversation in place. Playing a destination starts the new visit. Room memories and the previous response follow that visit; earlier visits stay available through History and the line arrows. Fresh dialogue waits for the backdrop, avatar images, and entrance motion to settle. The travel screen fully covers the source before the destination is drawn. Arrivals begin after that screen clears, and dialogue begins after the arrivals finish. Agreed companions enter together; independent followers enter a moment after Vale. A short caption distinguishes followers, companions, waiting residents, and departures, including with reduced motion. The same order applies when reopening a saved game. Media waits have a time limit. A reset or a save update cancels the travel screen and its waiting entrances.

The card rules still commit movement, trades, quest progress and inventory. The text response updates memories and scene lines. Revision checks discard old replies. Each ready exchange finishes before the next card action. Selecting cards prepares a single play or a combination. The scene and both conversation lines stay on the completed play until the next play is committed. Departure captions use the existing speaker heading, and the cutout fades after the farewell. A temporary speech failure retries the same completed turn once after a short pause. Both attempts share a thirty-second limit, allowing the server its full twenty-five-second deadline. The hand becomes available during a slow request after its 2.5-second pause. Reset and save updates cancel the active attempt and retry pause. Completed replies reach playback as soon as they are validated, while stream cleanup finishes separately. A retained line follows its event ID when the history window trims older events. The window keeps the latest 100 game events and, separately, the latest 100 generated lines, so generated text never shortens the history the rules read. The latest arrival also stays on the world, so the stage keeps Vale's entrance side after that event leaves the window. After both attempts fail, the hand becomes playable and the failure remains visible even if the scene has no earlier words. Retry dialogue requests the same completed scene without spending a turn or moving anyone; a later card play also tries again. Incomplete responses remain failures, and stale or cancelled replies cannot overwrite the current scene. A new game or a save update from another tab cancels the old request.

Schema 6 saves include location changes, favours and lasting memories. Earlier saves keep their positions, items, current programs, earned steps and generated speech. Conversation exports include only the speaker and text of spoken lines.

## Opening in Mirror attic

New browser tables and shared worlds use `createWorld({ opening: true })`.
Vale starts alone in the dark attic with an unlit lamp. The first purpose
asks for light in the attic. Lighting the lamp reveals the path through
the mirror. Vale reaches Black pond by playing that path card, meets Pip,
and can follow the shore to Empty station and the keeper.

Empty station connects to Black pond. Mirror attic connects to the pond through
the reflection. A lit, fueled, uncovered lamp at either end opens that mirror
in both directions. A stranded traveler in the attic finds a narrow path to
the pond when the room's resources have run out.

Each newly met card joins the hand through its discovery reveal. Travel loads
the destination scene before its discoveries and dialogue. Reduced motion uses
a brief still reveal.

New attic openings carry version 1. Saved pond openings carry version 2 and
retain their original purposes and discovery records. Saved positions, belongings, meetings
and earned progress survive loading. The current routes apply to every save.
`createWorld()` retains the station seed used by older simulation fixtures.

## Shore experiment

The browser starts and loads worlds with `enableMotives` and `personalQuests`.
Vale, Pip, and the Keeper use the same cards, locations, items, ownership rules,
and turn order. Their quests, motives and saved progress remain internal;
the player encounters people and their observable actions, not task dashboards.

Pip values warm light and fine clothes. The Keeper values quiet, the bell, and returned belongings. Vale likes interesting routes and a decent bargain; the player chooses Vale’s actions. Fuel, oil, ownership, and recent slights change what matters now. A cast member scores legal actions to seek an object, trade, ask, tend a lamp, or travel. Its preferred place becomes attractive once its main interest is met.

Trades compare each character’s value for both objects, including attached cloth. A grievance raises the requested price. A favour can lower it. Ringing beside the Keeper, spoiling Pip’s light, threats, and repeated requests can create grievances. Only witnesses remember a slight. A useful gift softens the receiver’s grievances toward its giver and earns a bounded favour. Grievances retain the other avatar, incident, turn, and strength across reloads.

Accompany requests use current interests, the items carried by the requester, favours, and grievances. An agreed trip moves both avatars and their belongings through the usual rules. A refusal leaves both in place for that exchange. The other cast member takes its own turn.

Schema 6 gains optional `motives` state. The browser activates this state for both fresh games and restored games. Earlier progress, earned levels, inventory, and memories remain in the save. The browser enables quest programs alongside personal motives at every new-game and load entry point. Saved progress continues from its recorded step. Completing a program earns a level and starts three quiet turns. Meaningful experiences and the avatar’s lasting hope shape the next purpose after sanctuary rest. Tastes shape prices; a remembered grievance can raise a price, refuse company, or prompt a retreat. Quest items also carry value in a fair exchange. The interests-only simulation remains available through `enableMotives()` for comparison; the browser passes `questPrograms: true`. Generated speech receives current interests, exact outcomes, and witnessed grievances.

At the station, Vale can take the bell. The Keeper values the bell more than the oil and accepts that pair. Ring the bell beside the Keeper first and the price rises. Pip values the lamp more than the cloth. These competing tastes let the same objects support several bargains.

## Local play

Run the Rust server with `COSYWORLD_PRIMARY_GAME=cards` and the normal AI provider configuration. It serves both the game and the text route. For the lightweight card server, set `COSYWORLD_CARD_TEXT_ORIGIN` to the Rust server's origin before running `npm run play:cards`. Provider credentials stay in the Rust service. `COSYWORLD_CARD_TEXT_MODEL` selects a registered world-content model for this card table. Both production sites use `openai/gpt-6-luna` with `COSYWORLD_CARD_TEXT_REASONING_EFFORT=none` for short scene text.

The endpoint accepts at most 64 KiB, fixed entity IDs, eight local entities, and bounded facts and memories. It allows two model requests at once, 30 requests per peer per minute, and 1,200 requests per process per hour. Same-site browser requests pass the origin check. Model calls have a 25-second deadline. Clients send `Accept: text/event-stream` for live text deltas followed by a validated `complete` event with all entries and the resolved model name. Other clients receive the full JSON response. Disconnects cancel the provider request and release its capacity.

## Learning and inner life

Open **Menu → Inner life** to read your avatar's persona, thoughts, dreams and
measured attempts. Each avatar keeps up to 32 completed plays for item and
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
one point. Exploratory gifts preserve items needed by the current quest program. Up to four linked plays share a
later result with a 0.7 discount per step. A changed recorded situation or a
completed goal ends that link. Human choices and resident choices use the same
measurement path. The panel shows measured attempts and how often an approach
helped reach the goal. Earlier lessons remain readable in existing saves.

Solo and shared avatars reflect on witnessed events. A new thought informs the
persona revision; the revised persona then informs an optional dream. Each
accepted revision keeps its source events, previous persona and the model used
for each part. Four revisions stay in the save. The six-turn thought gap and
twelve-turn dream gap apply in both modes. Shared publication commits the
reflection with its speech through the world journal. Retrying the publication
keeps its original play identity.

The server sends a player their own inner life and lessons. Resident inner life
stays in the simulation. Other characters' public words remain on their cards.
Conversation prompts include each line's witnessed audience, so a later arrival
learns an earlier exchange through a new conversation. Older prompts use that
avatar's recorded expressions as their witness evidence.

Shared rules version 18 adds measured action values and exploration. Versions
2–17 retain their released interpreter bytes. An explicit upgrade keeps the
existing world, possessions, quest progress, memory and persona.

## Your OpenRouter account

Hover over the CosyWorld title to reveal the video camera. Keyboard focus also
reveals it. Phones show the camera beside the title. Click it to film the last
two displayed dialogue lines. The video uses the current place, character
appearances, visible items, their holders, light, and other visible states.
The current stage supplies a reference frame where the model supports one.
The clip aims for ten seconds and uses the nearest supported model duration.
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

## Threats and standoffs

Avatar cards offer Talk and Threaten. A threat opens a standoff between the two avatars and adds Guard and Attack to their cards. Each has four resolve. An attack removes two resolve between equal levels, three against a lower level, and one against a higher level. Guard softens the next hit by one, with a minimum of one damage, until that avatar's next play.

Talk and item trades stay available during a standoff. Travel ends it; releasing the disputed item settles it. At zero resolve, the losing avatar drops the disputed item (or an item the winner needs) and retreats along an open path. Both avatars get three turns to recover before another threat. Saved levels retain their combat effect.

The cast guards, responds to attacks, or leaves. Threats, hits, releases, and retreats enter witnessed memories. A threat also leaves a personal grievance. Earlier saves gain an empty standoff state.

Card selection keeps the current card elements in place and leaves keyboard focus on the tapped card. The hand and action row open together over 220 milliseconds; held items slide out from their owner. A play in the same place refreshes the cards as the hand lowers, with each name moving into its resting position. Travel changes the hand under the scene veil. Rapid taps reverse the current motion. Reduced motion applies the final layout at once. Menu and Conversation keep the selected cards and open items, and Escape closes the active panel before lowering the hand. Short landscape screens keep the hand inside the viewport.

Run `node v2/scripts/smoke-card-actions.mjs` for Chromium controls, or `CARD_BROWSER=webkit node v2/scripts/smoke-card-actions.mjs` for WebKit. The checks cover desktop, phone, short landscape, reduced motion, fast taps, panel dismissal, and save updates.

When the lamp or oil is trapped beyond the attic, a narrow path can open from Black pond. It appears after reachable lamp remedies are exhausted. A traveler inside can still tend the lamp through the usual item plays. Every object keeps its holder until a play changes it. The Black cloth still opens the cottage from the attic.

## Accompany requests

Pair a nearby avatar with an open location card to ask them to accompany Vale. Either card order works. Tap the Accompany button beneath either raised card to play the request. Pairing Vale with a location offers travel there. Pairing a carried item with the current place offers to put it down; pairing a lamp or bell lying here with the current place offers to light, put out or ring it where it lies.

The invited avatar weighs its own interests, the requester’s belongings, remembered grievances, and favours. Standoffs and recovery also shape the answer. Accepted requests take one round. The pair resumes its own choices on the next play. An invited resident can use an open crossing back to their own part of the world. Their belongings stay with them on that return.

Requests record the destination and the answer in the scene script. Both places, witnesses, avatars and carried items remember an agreed trip. The same model request writes Vale's invitation and the invited avatar's reply from the completed result, desires, personas and memories.

## Action, travel and fresh goals

The dialogue service gives the model a plain account of every recorded trip and a direction for Vale's chosen action. Threats keep their pressure, attacks keep their commitment, and guards hold a defensive stance. A later player choice can change that stance. Separate trips to the same destination remain separate arrivals in avatar speech, item descriptions and location narration.

New programs rotate recent purposes and consider the purposes already active across the cast. Feasible alternatives take priority over repeated bell quests; scarce worlds retain a reachable fallback. Pond quests restore oil when the flask needs it, or establish a refuge when the shore needs quiet. Current programs and their completed steps remain saved.

Run `node v2/scripts/smoke-card-pond-access.mjs` to check lamp custody, quiet departures, both mirror directions, reload and relighting at desktop and phone widths. Run `node v2/scripts/smoke-card-dialogue-timing.mjs` to check the first loading speaker, card locks through each reply, and the cast after quiet actions. Run `node v2/scripts/smoke-card-movement.mjs` to check visible entrances, the travel screen, movement captions, and reset during travel with fast and delayed replies. The card table still keeps its rules and inventory in the browser; `/card-game/text` only generates validated text and does not authorize movement.

Run `node v2/scripts/smoke-card-dialogue-recovery.mjs` to check visible service failures, same-turn retry, incomplete responses, later plays and reload at desktop and phone widths. It uses local fixture responses and makes no model calls.

Music loading starts when playback is ready: after the first accepted play,
with music enabled and the page visible. Muted or hidden travel keeps the
current source for a later resume. A repeated ship song starts again from its
buffered beginning. Run `node v2/scripts/smoke-card-music-network.mjs` for the
throttled request and first-sound checks.

Room music starts with the first accepted card play in a new game. In a shared world, each avatar starts in silence until their own first accepted play, such as picking up or using their item. The saved play journal keeps that choice across reloads. The opening scene and menu wait for that play. Starting another new game resets this wait and keeps the saved music and volume settings.

## Character models and inner life

Both Fly configurations set `COSYWORLD_CARD_CHARACTER_MODELS_JSON`:

| Character     | Stable OpenRouter model                    |
| ------------- | ------------------------------------------ |
| Vale          | `openai/gpt-4.1-mini`                      |
| Pip           | `google/gemini-2.5-flash`                  |
| The keeper    | `anthropic/claude-haiku-4.5`               |
| Grumpy Badger | `mistralai/mistral-small-3.2-24b-instruct` |

The map covers the authored cast. Each model also has an explicit world-content
entry in the operator registry. The narrator keeps `COSYWORLD_CARD_TEXT_MODEL`.
Assignments depend on the character ID, so they survive turns, saves, reloads,
restarts and changes in who is present. Operators can change an assignment by
editing the map and its registry entry together. Hosts with the character map
unset use the default world-content model for each voice. Mounted pack avatars
inherit that default unless their ID has an explicit model assignment.

Each avatar call receives the public scene plus that avatar's own witnessed
memories, current persona, thoughts and dreams. Other avatars' inner lives stay
with their own calls. Authored personas and voice profiles remain the roots of
identity; current actions, possessions, travel and relationships come from the
resolved simulation.

A character can reflect after a new witnessed event. The first reflection is
available after the first turn; later reflections are at least six turns apart.
A reflection supplies a thought and an evolved persona. The first reflection
also supplies a symbolic dream or daydream; later dreams are at least twelve
turns apart. Sleeping and waking state still comes from game facts. Each field has its own brief completion. Public lines enter the queue first.

The browser saves the current persona and the latest four thoughts and four
dreams per avatar beside the existing witnessed memories and landmarks.
`History` → `Inner life` shows them for discovered characters. Existing saves
start with their authored personas and gain inner lives as play continues.
Dreams and thoughts are marked as private impressions. They are separate from
witnessed events and public conversation.

Each voice receives a short first-person transcript and completes one plain-text
line. Optional `idiolect` and `lines` profile fields supply style and examples;
existing pack `persona` and `voice` fields remain supported. The server checks
visible state, including lamp state, before accepting each line. Supplied quest
facts remain part of the transcript. A bard receives the complete earned poem
as structured context, with the newest lines marked separately. The poem data
keeps its authored words and attribution. The bard speaks in its own voice and
may quote, paraphrase, or comment on that context. Ordinary factual, custody,
observation, and speech checks apply to local and shared replies.

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

The seven Theban places, the Theban Harbor Road, Athens Harbor and Piraeus Quays
share day and night. Each light setting lasts twenty-four accepted world turns.
Each place has its own night painting. All three harbors have matching day and
night views for the ship at the berth and the open berth. The saved ship dock
selects the painting. The Theban Harbor Road has its own coast and town painting
in both light settings. Its approach cards use the same light as the road scene.

Greek weather follows one cycle per region. Each period lasts twelve accepted
world turns. Clear skies, cloud, rain, and mist appear in the scene and on place
cards. Coasts, courtyards, open ground, groves, and shelters each have their own
view of the regional weather. The Underworld has low mist above its water.
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

New Greek games expose the harbor and six Theban places, each with a distinct
painting. The Open Door adds five paintings and eight resident portraits.
Old Greek saves retain later routes and histories. The ship uses
a painted transparent layer over the unchanged pond and a card crop from
that same scene. Both worlds now share Forest’s crossing implementation and
one compiled `packs.json`. The new art prompts and hashes are saved in
`assets/greek-drama/open-door-art.json`.

Boarding keeps the ship at its departure shore so other players can join.
The first passenger to disembark moves it to the arrival shore. Passengers
still aboard can step off there. A new boarding starts the return leg, so a
passenger can stay aboard through several trips. A lamp recall waits until
the ship is empty. Older occupied saves retain their destination and regain
the departure dock. Shared rules version 8 records this change; older journal
actions replay with their original rules.

See the Greek pack README and `test/card-theban-release.test.mjs`; the scene
journey is `v2/scripts/smoke-card-theban-scenery.mjs`. The weather journey is
`node v2/scripts/smoke-card-weather.mjs`.

## Introduction quests

**Get these two together** is a generated quest type for the cast. The card
names two people. Their meeting completes it. BoardyAI favours connected human
pairs and also chooses ordinary quests. He takes the normal break after a quest.
Later introduction quests favour a new pair.

An avatar pursuing an introduction remembers people seen in a shared scene.
Boardy travels through open routes to the last place he saw each person. He
searches other rooms when the trail goes cold. Turns, sightings, search history,
and quest progress belong to the save. Human players choose their own actions.
The online list shows names and levels; encounters reveal locations.
