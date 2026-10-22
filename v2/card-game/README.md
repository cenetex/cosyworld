# Card world text and memory

## Personal quests and lasting hopes

The browser enables `personalQuests` alongside motives. The first quest gives
each avatar a starting purpose. A completed quest earns a level and starts
three quiet turns. Its checklist leaves the card. After this rest, useful
gifts and lamp care earn two Inspiration points; conversations, trades and
accepted shared trips earn one. Both people in a social action can earn points.
Each person earns at most two points per round. The same exchange earns again
after six turns. Failed requests, solo waiting and inspecting cards leave the
meter unchanged. Five points unlock one new personal quest at the end of the
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

Avatar cards show Inspiration during the quiet and seeking phases. The Menu
shows each hope, its milestones, and the current quest when one is active.
Item cards explain attachments. Personal facts also enter the story context.

Schema 6 saves gain optional, validated `life` state. Loading an earlier save
adds this state while keeping its active quest, earned steps, items, memories
and levels. New-game and cross-tab save updates use the same setup. The action
history is bounded independently from the saved Inspiration and attachments.

Run `npx vitest run test/card-personal-quests.test.mjs` for the quest cycle,
repeat limits, attachment and company rules, hope selection, save migration,
validation and deterministic mixed-play checks.

## The bell crossing to the Steam Clock

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

The Black pond card in the clearing returns Vale and their belongings to the
shore. It works even if the bell has been left behind or stopped ringing.
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

After a card play, the browser sends the current local entities and departing avatars, their facts, avatar interests, and eight recent memories, witnessed events, and the four latest spoken lines to `POST /card-game/text`. The Rust service adds the authored profiles and uses the existing AI gateway. The deployed character map sends each avatar to its own exact OpenRouter model. A separate narrator call covers items and places. These calls run together inside one bounded scene request, which requests JSON-object output and validates every entry before publication. Each entry carries its own model attribution. Raising a card prepares a play and keeps the current conversation. Playing a card commits the action and starts the next exchange. The place, played item, and chosen speakers also receive scene beats. A quiet turn with departures gives the farewell to the moving cast, without an automatic Vale recap. A Stay without departures keeps Vale available. Direct interactions, item plays, combat, travel and introductions retain their relevant speakers. A departing avatar says where they are going and why; their recorded farewell belongs to the source scene. The prompt includes the completed card play so their lines form a question and answer or a shared reaction. A separate resolved-turn record gives the played verb and outcome, every avatar's final location and holdings, exact travel companions, and final item ownership. Accepted accompany plays record both travellers; independent trips record an empty companion list. Current results take priority over desires and remembered speech. When Vale speaks on a wait play, the words stay at the place where Vale stayed. A solo farewell frames desired company as a hope for later.

The conversation shows generated text, with the prior spoken line and speaker portrait above the current line. The browser buffers each exchange until it passes validation, then reveals complete letters on a local clock with short pauses at punctuation. The selected speakers take their turns in order. Each exchange advances after a reading pause. Tap the text to finish a line, then tap again to hear the next speaker. The hand cools down during generation and playback, then becomes ready after the last reply. A blinking cursor marks the end. Earlier scene lines can be replayed with the line controls and History. A replayed line stages the avatars present now; a speaker who has left keeps the words and stays off the stage. Each speaker has a soft, pitched voice sound; the menu toggles it. Reduced motion shows full lines at once. Hidden tabs and open menus pause playback, including the rest of a punctuation pause. Text reveals on browser paint frames. Each visible line keeps its own height, and portraits stay mounted when the speaker changes. Empty prior replies and speech rows collapse. A scene with no words shows a compact loading line. A card play holds the current spoken line while the next exchange is written. The browser saves complete text before playback begins. Fresh tables request an opening exchange. Reloading a turn whose words are still pending requests that turn again. Action records remain in the saved world and scene export.

The stage holds up to three avatars. Vale stands in the foreground, with the other two farther back. The composition mirrors when Vale returns from the other side of a route. Seats and sizes stay fixed throughout an exchange. The speaker and listener face each other; another witness looks toward the speaker. The keeper has a separate right-facing cutout, so the clock face keeps its painted detail. A soft lean and light change mark the speaker. Carried item symbols follow recorded custody, including covered items. Actual arrivals fade in together for an accepted accompany play. A farewell finishes before its avatar fades out of its seat. Reduced motion uses still poses. The scene script exports each actor's position, depth, scale, facing, gaze, pose, travel companions, and carried items for each beat.

A raised card keeps the current conversation in place. Playing a destination starts the new visit. Room memories and the previous response follow that visit; earlier visits stay available through History and the line arrows. Fresh dialogue waits for the backdrop, avatar images, and entrance motion to settle. The same order applies when reopening a saved game. Media waits have a time limit, and a reset clears the waiting exchange.

The card rules still commit movement, trades, quest progress and inventory. The text response updates memories and scene lines. Revision checks discard old replies. Each play finishes its exchange before the next card action. Selecting cards prepares a single play or a combination. The scene and both conversation lines stay on the completed play until the next play is committed. Departure captions use the existing speaker heading, and the cutout fades after the farewell. A temporary speech failure retries the same completed turn once after a short pause. Both attempts share a thirty-second limit, allowing the server its full twenty-five-second deadline. A stalled stream releases the hand when the shared limit expires. Reset and save updates cancel the active attempt and retry pause. Completed replies reach playback as soon as they are validated, while stream cleanup finishes separately. A retained line follows its event ID when the history window trims older events. The window keeps the latest 100 game events and, separately, the latest 100 generated lines, so generated text never shortens the history the rules read. The latest arrival also stays on the world, so the stage keeps Vale's entrance side after that event leaves the window. After both attempts fail, the hand becomes playable and the failure remains visible even if the scene has no earlier words. Retry dialogue requests the same completed scene without spending a turn or moving anyone; a later card play also tries again. Incomplete responses remain failures, and stale or cancelled replies cannot overwrite the current scene. A new game or a save update from another tab cancels the old request.

Schema 6 saves include location changes, favours and lasting memories. Earlier saves keep their positions, items, current programs, earned steps and generated speech. Scene exports include entity memories and generated beats.

## Opening in the attic

New browser tables use `createWorld({ opening: true })`. Vale starts alone in Mirror attic with the lamp in hand and its flame off. The first target hand asks for the lamp alight in the attic. Playing Light completes that hand and reveals a Black pond location card. Vale stays in the attic until the player plays that card, then meets Pip at the pond. The mirror keeps the exit from the attic available after discovery, including when the lamp runs dry. Entry to the attic from Black pond requires a lit, fueled, uncovered lamp physically at the pond, on the ground or carried by someone there. When that carrier leaves, the attic card and travel offers disappear. Previously selected moves and accompany requests are checked against the current state again at play time; old saves keep discovery but cannot bypass the pond requirement.

Every card the player meets for the first time is unveiled: it appears large over the scene with a line about it, then flies into the hand and stays marked new until it is used. Several new cards unveil one at a time, people first, then items, then places. A tap, Escape, or five seconds adds the card to the hand, and the conversation waits meanwhile. The cards on the table when a game starts count as met, and a reload never unveils a card again; the browser stores the met cards beside the save. Any change of Vale's place, by a played card or by retreating from a fight, dips the scene to dark and names the destination before the new place appears. Reduced motion skips the flight and the fade. `npm run v2:card:unveil:smoke` checks the attic flow in a browser. The shore path joins the pond and station. The attic and station connect through the pond.

The next program introduces company at the pond, then leads Vale to the station and the keeper. Each cast member joins the simulation when Vale first meets them and takes their first autonomous action on the following turn. Their introduction, quest progress, and route rules survive a reload. The menu and speech request use the discovered cast. The Light play records the fulfilled hand and revealed path in the attic. The later Travel play records the trip to the pond, so the scene and dialogue follow each card’s result.

Existing saves keep their station start, original routes, authored programs, and earned progress. The core's `createWorld()` remains the legacy fixture; the browser explicitly chooses the new opening for fresh tables and New game.

## Shore experiment

The browser starts and loads worlds with `enableMotives` and `personalQuests`.
Vale, Pip, and the Keeper use the same cards, locations, items, ownership rules,
and turn order. During a personal quest, an avatar card shows its target hand
and progress. Between quests it shows Inspiration. Menu shows lasting hopes,
milestones, and the active quests of the discovered cast.

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

## Accompany requests

Pair a nearby avatar with an open location card to ask them to accompany Vale. Either card order works. Tap either raised card, or drag the pair into the scene, to play the request. Pairing Vale with a location travels there directly. Pairing a carried item with the current place puts it down; pairing a lamp or bell lying here with the current place lights, puts out or rings it where it lies.

The invited avatar weighs its own interests, the requester’s belongings, remembered grievances, and favours. Standoffs and recovery also shape the answer. Accepted requests take one round. The pair resumes its own choices on the next play.

Requests record the destination and the answer in the scene script. Both places, witnesses, avatars and carried items remember an agreed trip. The same model request writes Vale's invitation and the invited avatar's reply from the completed result, desires, personas and memories.

## Action, travel and fresh goals

The dialogue service gives the model a plain account of every recorded trip and a direction for Vale's chosen action. Threats keep their pressure, attacks keep their commitment, and guards hold a defensive stance. A later player choice can change that stance. Separate trips to the same destination remain separate arrivals in avatar speech, item descriptions and location narration.

New programs rotate recent purposes and consider the purposes already active across the cast. Feasible alternatives take priority over repeated bell quests; scarce worlds retain a reachable fallback. Pond quests restore oil when the flask needs it, or establish a refuge when the shore needs quiet. Current programs and their completed steps remain saved.

Run `node v2/scripts/smoke-card-pond-access.mjs` to check lamp custody, departure speech, stale hand removal, reload and return travel at desktop and phone widths. The card table still keeps its rules and inventory in the browser; `/card-game/text` only generates validated text and does not authorize movement.

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
unset use the shared narrator route for local development.

Each avatar call receives the public scene plus that avatar's own witnessed
memories, current persona, thoughts and dreams. Other avatars' inner lives stay
with their own calls. Authored personas and voice profiles remain the roots of
identity; current actions, possessions, travel and relationships come from the
resolved simulation.

A character can reflect after a new witnessed event. The first reflection is
available after the first turn; later reflections are at least six turns apart.
A reflection supplies a thought and an evolved persona. The first reflection
also supplies a symbolic dream or daydream; later dreams are at least twelve
turns apart. Sleeping and waking state still comes from game facts. The model
writes these fields in the same call as the character's speech.

The browser saves the current persona and the latest four thoughts and four
dreams per avatar beside the existing witnessed memories and landmarks.
`History` → `Inner life` shows them for discovered characters. Existing saves
start with their authored personas and gain inner lives as play continues.
Dreams and thoughts are marked as private impressions. They are separate from
witnessed events and public conversation.

The scene remains one publication unit. Provider calls have a twelve-second
limit and the complete group has a fourteen-second limit. Each avatar gets one
call and the narrator gets one call, for at most five calls per scene. The
existing scene admission, concurrency and retry limits still apply. Provider
failure, incomplete output or invalid reflection keeps the last saved scene.
