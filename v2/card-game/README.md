# Card world text and memory

## Shipping engine

`world.mjs` owns the card game's state, legal actions, resident turns, and save
format. `forest.json` holds the forest catalog, starting state, and authored
quests for the station and attic openings. `createWorld()` copies that data
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
smoke read that list. Generate the Rust server's embedded list with:

```sh
npm run v2:card:assets:build
```

Commit `v2/orchestrator-rust/src/card_assets.rs` with each asset-list change.
`npm run v2:card:pack:build` rebuilds both pack data and the Rust asset list.
`npm run v2:card:pack:check` checks both during CI and release gates.

## Collected quest cards

Each avatar keeps a collection of quest cards after their carried items. The
active quest sits on top. Select it to spread the collection, then select a
card to read its purpose. A player's pending cards offer **Pursue**.
That action changes the active quest through the usual local or shared turn.
Browsing cards is free. Residents expose their own collections for reading.
Fulfilled cards remain at the bottom as part of the avatar's history.

Run `node v2/scripts/smoke-card-quest-collection.mjs` to check the stack,
browsing, focus changes, and resident cards at desktop and phone sizes.

## Image-first presentation

Card faces contain the illustration and a small name. Tapping a card toggles
its selection. Selecting a card or pair shows named actions in the row below.
Tapping an action button plays it. The current place leads the hand, followed
by items lying there, avatars with their carried items, and travel destinations.
Arrival starts the hand at the new current place. Selection keeps its scroll position.
Selection, cancellation,
drag pairing and keyboard navigation spend no turn; only a committed play does.

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

Black Pond now offers a card for **The Wine-Dark Harbor**. Play it to cross
with Vale's current belongings, then take the courtyard road to **Before the
Burial**. The Black Pond card at the harbor returns to the same shore save.
The lamp reflection and the bell's Steam Clock crossing keep their rules.

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

Story cards sit with the player's belongings beside the personal quest.
Each has its own art, selection, first reveal, and closing moment. They stay
with the traveler through a trip home and the rest between personal quests.
Existing saves derive cards from their recorded meetings, choices, and flags.
Completed stories remain complete after reload. The opening release remains
focused on Thebes; the wider repertoire is the next content stage.

## Personal quests and lasting hopes

The browser enables `personalQuests` alongside motives. The first quest gives
each avatar a starting purpose. A completed quest earns a level and starts
three quiet turns. This is internal simulation state. After this rest, useful
gifts and lamp care earn two Inspiration points; conversations, trades and
accepted shared trips earn one. Both people in a social action can earn points.
Each person earns at most two points per round. The same exchange earns again
after six turns. Failed requests, solo waiting and inspecting cards leave the
saved inspiration unchanged. Five points unlock one new personal quest at the end of the
round. The new quest can first advance on the following turn.

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

These mechanics remain internal; cards and menus do not display Inspiration,
hope milestones or task checklists. Personal relationships may inform speech.

Schema 6 saves gain optional, validated `life` state. Loading an earlier save
adds this state while keeping its active quest, earned steps, items, memories
and levels. New-game and cross-tab save updates use the same setup. The action
history is bounded independently from the saved Inspiration and attachments.

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

Speech receives visible facts, current wants, and witnessed results. Entity profiles describe appearance and personality. Quest purposes and hidden interaction rules stay in the simulation. A revealed path joins the location cards; travel happens when its card is played. Earlier opening expressions stay in saved history while fresh speech uses observations until the first light.

When a play calls for speech, the browser sends the current local entities and departing avatars, their facts, avatar interests, and eight recent memories, witnessed events, and the four latest spoken lines to `POST /card-game/text`. The Rust service adds the authored profiles and uses the existing AI gateway. The deployed character map sends each avatar to its own exact OpenRouter model. Items and places each have their own voice call. These calls run together inside one bounded scene request. Each call returns a brief plain-text reply, which the service validates before publication. Each entry carries its own model attribution. Raising a card prepares a play and keeps the current conversation. Playing a card commits the action; social actions and travel can start an exchange, while ordinary object manipulation can remain silent. The place, played item, and chosen speakers also receive scene beats. A quiet turn with departures gives the farewell to the moving cast, without an automatic Vale recap. A Stay without departures keeps Vale available. Direct interactions, combat, travel and introductions retain their relevant speakers. A departing avatar says where they are going and why; their recorded farewell belongs to the source scene. The prompt includes the completed card play so their lines form a question and answer or a shared reaction. A separate resolved-turn record gives the played verb and outcome, every avatar's final location and holdings, exact travel companions, and final item ownership. Accepted accompany plays record both travellers; independent trips record an empty companion list. Current results take priority over desires and remembered speech. When Vale speaks on a wait play, the words stay at the place where Vale stayed. A solo farewell frames desired company as a hope for later.

The conversation shows the current spoken line; earlier words are available in the optional Conversation panel. The browser buffers each exchange until it passes validation, then reveals complete letters on a local clock with short pauses at punctuation. The selected speakers take their turns in order. Each exchange advances after a reading pause. Tap the text to finish a line, then tap again to hear the next speaker. The hand pauses for up to 2.5 seconds while words are generated. A slow request can be replaced by another play. Once a complete reply arrives, the hand locks through scene preparation and every speaker, then becomes ready after the last reply. A blinking cursor marks the end. Earlier scene lines can be replayed with the line controls and History. A replayed line stages the avatars present now; a speaker who has left keeps the words and stays off the stage. Each speaker has a soft, pitched voice sound; the menu toggles it. Reduced motion shows full lines at once. Hidden tabs and open menus pause playback, including the rest of a punctuation pause. Text reveals on browser paint frames. Each visible line keeps its own height, and portraits stay mounted when the speaker changes. Empty prior replies and speech rows collapse. A scene with no words shows a compact loading line. A spoken card play immediately shows its first speaker with a loading mark. Ask and Talk show Vale while the reply is being written. The browser saves complete text before playback begins. Fresh tables request an opening exchange. Reloading resumes saved dialogue from the current turn. Action records remain in the saved world and scene export.

The stage holds up to three avatars. Vale stands in the foreground, with the other two farther back. The composition mirrors when Vale returns from the other side of a route. Seats and sizes stay fixed throughout an exchange. The speaker and listener face each other; another witness looks toward the speaker. The keeper has a separate right-facing cutout, so the clock face keeps its painted detail. A soft lean and light change mark the speaker. Carried item symbols follow recorded custody, including covered items. Actual arrivals fade in together for an accepted accompany play. A farewell finishes before its avatar fades out of its seat. Quiet actions update the stage cast immediately to match the hand and current locations. Reduced motion uses still poses. The scene script exports each actor's position, depth, scale, facing, gaze, pose, travel companions, and carried items for each beat. The browser uses `portrait-facing.mjs` to match each painted portrait to that gaze. This presentation-only map covers the human cast, pack portraits and Keeper variants; add new portrait files here with their native direction. Hand thumbnails keep their native artwork.

A raised card keeps the current conversation in place. Playing a destination starts the new visit. Room memories and the previous response follow that visit; earlier visits stay available through History and the line arrows. Fresh dialogue waits for the backdrop, avatar images, and entrance motion to settle. The travel screen fully covers the source before the destination is drawn. Arrivals begin after that screen clears, and dialogue begins after the arrivals finish. Agreed companions enter together; independent followers enter a moment after Vale. A short caption distinguishes followers, companions, waiting residents, and departures, including with reduced motion. The same order applies when reopening a saved game. Media waits have a time limit. A reset or a save update cancels the travel screen and its waiting entrances.

The card rules still commit movement, trades, quest progress and inventory. The text response updates memories and scene lines. Revision checks discard old replies. Each ready exchange finishes before the next card action. Selecting cards prepares a single play or a combination. The scene and both conversation lines stay on the completed play until the next play is committed. Departure captions use the existing speaker heading, and the cutout fades after the farewell. A temporary speech failure retries the same completed turn once after a short pause. Both attempts share a thirty-second limit, allowing the server its full twenty-five-second deadline. The hand becomes available during a slow request after its 2.5-second pause. Reset and save updates cancel the active attempt and retry pause. Completed replies reach playback as soon as they are validated, while stream cleanup finishes separately. A retained line follows its event ID when the history window trims older events. The window keeps the latest 100 game events and, separately, the latest 100 generated lines, so generated text never shortens the history the rules read. The latest arrival also stays on the world, so the stage keeps Vale's entrance side after that event leaves the window. After both attempts fail, the hand becomes playable and the failure remains visible even if the scene has no earlier words. Retry dialogue requests the same completed scene without spending a turn or moving anyone; a later card play also tries again. Incomplete responses remain failures, and stale or cancelled replies cannot overwrite the current scene. A new game or a save update from another tab cancels the old request.

Schema 6 saves include location changes, favours and lasting memories. Earlier saves keep their positions, items, current programs, earned steps and generated speech. Conversation exports include only the speaker and text of spoken lines.

## Opening in the attic

New browser tables use `createWorld({ opening: true })`. Vale starts alone in Mirror attic with the lamp in hand and its flame off. The first target hand asks for the lamp alight in the attic. Playing Light completes that hand and reveals a Black pond location card. Vale stays in the attic until the player plays that card, then meets Pip at the pond. A lit, fueled, uncovered lamp at either Mirror attic or Black pond opens the mirror in both directions. The lamp can rest on the ground or be carried by someone at either end. When the lamp goes dark, is covered, or leaves both ends of the mirror, the destination card and travel offers disappear. Vale can become stranded in the attic when the fuel runs out. Previously selected moves and accompany requests are checked against the current state again at play time. Saved discovery records keep the same light requirement after reload.

Newly encountered cards join the hand without a modal or tutorial. Travel still
fades between locations and loads the next scene before revealing it. Reduced
motion skips the fade. The opening route stays the same: attic, pond, then station.
The `v2:card:unveil:smoke` command checks discovery reveals, flights, glow,
travel order, held items, reload, cancellation, and reduced motion.

The next program introduces company at the pond, then leads Vale to the station and the keeper. Each cast member joins the simulation when Vale first meets them and takes their first autonomous action on the following turn. Their introduction, quest progress, and route rules survive a reload. The menu and speech request use the discovered cast. The Light play records the fulfilled hand and revealed path in the attic. The later Travel play records the trip to the pond, so the scene and dialogue follow each card’s result.

Existing saves keep their station start, original routes, authored programs, and earned progress. `createWorld()` retains the station start for existing fixtures; the browser chooses the attic opening for fresh tables and New game.

## Shore experiment

The browser starts and loads worlds with `enableMotives` and `personalQuests`.
Vale, Pip, and the Keeper use the same cards, locations, items, ownership rules,
and turn order. Their quests, motives and saved progress remain internal;
the player encounters people and their observable actions, not task dashboards.

Pip values warm light and fine clothes. The Keeper values quiet, the bell, and returned belongings. Vale likes interesting routes and a decent bargain; the player chooses Vale’s actions. Fuel, oil, ownership, and recent slights change what matters now. A cast member scores legal actions to seek an object, trade, ask, tend a lamp, or travel. Its preferred place becomes attractive once its main interest is met.

Trades compare each character’s value for both objects, including attached cloth. A grievance raises the requested price. A favour can lower it. Ringing beside the Keeper, spoiling Pip’s light, threats, and repeated requests can create grievances. Only witnesses remember a slight. A useful gift softens the receiver’s grievances toward its giver and earns a bounded favour. Grievances retain the other avatar, incident, turn, and strength across reloads.

Accompany requests use current interests, the items carried by the requester, favours, and grievances. An agreed trip moves both avatars and their belongings through the usual rules. A refusal leaves both in place for that exchange. The other cast member takes its own turn.

Schema 6 gains optional `motives` state. The browser activates this state for both fresh games and restored games. Earlier progress, earned levels, inventory, and memories remain in the save. The browser enables quest programs alongside personal motives at every new-game and load entry point. Saved progress continues from its recorded step. Completing a program earns a level and starts three quiet turns. Shared actions then fill Inspiration and unlock a fresh purpose from the current world and the avatar’s lasting hope. Tastes shape prices; a remembered grievance can raise a price, refuse company, or prompt a retreat. Quest items also carry value in a fair exchange. The interests-only simulation remains available through `enableMotives()` for comparison; the browser passes `questPrograms: true`. Generated speech receives current interests, exact outcomes, and witnessed grievances.

At the station, Vale can take the bell. The Keeper values the bell more than the oil and accepts that pair. Ring the bell beside the Keeper first and the price rises. Pip values the lamp more than the cloth. These competing tastes let the same objects support several bargains.

## Local play

Run the Rust server with `COSYWORLD_PRIMARY_GAME=cards` and the normal AI provider configuration. It serves both the game and the text route. For the lightweight card server, set `COSYWORLD_CARD_TEXT_ORIGIN` to the Rust server's origin before running `npm run play:cards`. Provider credentials stay in the Rust service. `COSYWORLD_CARD_TEXT_MODEL` selects a registered world-content model for this card table. Both production sites use `openai/gpt-6-luna` with `COSYWORLD_CARD_TEXT_REASONING_EFFORT=none` for short scene text.

The endpoint accepts at most 64 KiB, fixed entity IDs, eight local entities, and bounded facts and memories. It allows two model requests at once, 30 requests per peer per minute, and 1,200 requests per process per hour. Same-site browser requests pass the origin check. Model calls have a 25-second deadline. Clients send `Accept: text/event-stream` for live text deltas followed by a validated `complete` event with all entries and the resolved model name. Other clients receive the full JSON response. Disconnects cancel the provider request and release its capacity.

## Threats and standoffs

Avatar cards offer Talk and Threaten. A threat opens a standoff between the two avatars and adds Guard and Attack to their cards. Each has four resolve. An attack removes two resolve between equal levels, three against a lower level, and one against a higher level. Guard softens the next hit by one, with a minimum of one damage, until that avatar's next play.

Talk and item trades stay available during a standoff. Travel ends it; releasing the disputed item settles it. At zero resolve, the losing avatar drops the disputed item (or an item the winner needs) and retreats along an open path. Both avatars get three turns to recover before another threat. Saved levels retain their combat effect.

The cast guards, responds to attacks, or leaves. Threats, hits, releases, and retreats enter witnessed memories. A threat also leaves a personal grievance. Earlier saves gain an empty standoff state.

Card selection keeps the current card elements in place and leaves keyboard focus on the tapped card. The hand and action row open together over 220 milliseconds; held items slide out from their owner. A play in the same place refreshes the cards as the hand lowers, with each name moving into its resting position. Travel changes the hand under the scene veil. Rapid taps reverse the current motion. Reduced motion applies the final layout at once. Menu and Conversation keep the selected cards and open items, and Escape closes the active panel before lowering the hand. Short landscape screens keep the hand inside the viewport.

Run `node v2/scripts/smoke-card-actions.mjs` for Chromium controls, or `CARD_BROWSER=webkit node v2/scripts/smoke-card-actions.mjs` for WebKit. The checks cover desktop, phone, short landscape, reduced motion, fast taps, panel dismissal, and save updates.

## Accompany requests

Pair a nearby avatar with an open location card to ask them to accompany Vale. Either card order works. Tap the Accompany button beneath either raised card to play the request. Pairing Vale with a location offers travel there. Pairing a carried item with the current place offers to put it down; pairing a lamp or bell lying here with the current place offers to light, put out or ring it where it lies.

The invited avatar weighs its own interests, the requester’s belongings, remembered grievances, and favours. Standoffs and recovery also shape the answer. Accepted requests take one round. The pair resumes its own choices on the next play.

Requests record the destination and the answer in the scene script. Both places, witnesses, avatars and carried items remember an agreed trip. The same model request writes Vale's invitation and the invited avatar's reply from the completed result, desires, personas and memories.

## Action, travel and fresh goals

The dialogue service gives the model a plain account of every recorded trip and a direction for Vale's chosen action. Threats keep their pressure, attacks keep their commitment, and guards hold a defensive stance. A later player choice can change that stance. Separate trips to the same destination remain separate arrivals in avatar speech, item descriptions and location narration.

New programs rotate recent purposes and consider the purposes already active across the cast. Feasible alternatives take priority over repeated bell quests; scarce worlds retain a reachable fallback. Pond quests restore oil when the flask needs it, or establish a refuge when the shore needs quiet. Current programs and their completed steps remain saved.

Run `node v2/scripts/smoke-card-pond-access.mjs` to check lamp custody, quiet departures, both mirror directions, reload and relighting at desktop and phone widths. Run `node v2/scripts/smoke-card-dialogue-timing.mjs` to check the first loading speaker, card locks through each reply, and the cast after quiet actions. Run `node v2/scripts/smoke-card-movement.mjs` to check visible entrances, the travel screen, movement captions, and reset during travel with fast and delayed replies. The card table still keeps its rules and inventory in the browser; `/card-game/text` only generates validated text and does not authorize movement.

Run `node v2/scripts/smoke-card-dialogue-recovery.mjs` to check visible service failures, same-turn retry, incomplete responses, later plays and reload at desktop and phone widths. It uses local fixture responses and makes no model calls.

Room music starts with the first accepted card play in a new game. The opening scene and menu wait for that play. Starting another new game resets this wait and keeps the saved music and volume settings.

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
visible-state checks; reflections belong to local play.

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
`COSYWORLD_LOCAL_MODEL` defaults to `gemma3:4b`; `OLLAMA_URL` and
`COSYWORLD_CARD_LOCAL_PORT` select the server and table port. The local profile
allows ninety seconds per call and four minutes per scene, with one call in
flight. `COSYWORLD_CARD_TEXT_PROFILE=local` selects this profile on another
server. The served page receives the matching wait budget. Operators can set
`COSYWORLD_CARD_STORY_BUDGET_MS` for a separately served card page.

## Seven-place painted opening

New Greek games expose the harbor and six Theban places, each with a distinct
painting. Old Greek saves retain later routes and histories. The ship uses
a painted transparent layer over the unchanged pond and a card crop from
that same scene. Both worlds now share Forest’s crossing implementation and
one compiled `packs.json`. Weather/night alternates remain unfinished.

See the Greek pack README and `test/card-theban-release.test.mjs`; the scene
journey is `v2/scripts/smoke-card-theban-scenery.mjs`.
