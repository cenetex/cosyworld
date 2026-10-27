# Shared worlds

Open **Share** in the current game. Sign in with a passkey and choose **Share this
world**. Friends enter that saved world through its invitation. The host keeps
Vale, the current place, belongings, resident state, quests, and conversation.

The original card table remains the game screen. Black pond, Empty station,
Mirror attic, Pip, the keeper, Badger, mounted story packs, and their rules belong
to this same world. Each account claims one of eight human avatars. Each room
holds four present humans. Residents can share a room with those humans.

The seven new humans start in their homes with their signature items on the floor.
Picking up the item opens the path to Black pond. Putting it down closes that
path. At the pond, the item reveals the home's entrance when it rests there or
is carried by a present human. Full destination cards disappear
from the hand. The server checks room space again when a play reaches its turn.

The existing Play buttons add an action to the room queue. A room holds four
pending plays, including the current play. Each person has one pending play.
Waiting plays can be withdrawn. Nudge asks a present human for attention. People
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

## One world model

The browser and server use the authored rules in `world.mjs` and its rule modules.
`human-cast.mjs` adds the new homes through the existing pack registry.
`shared-world.mjs` exposes the save, join, view, play, and speech operations.

The server runs a checked-in bundle of those modules in QuickJS, a C interpreter.
Rust supplies JSON and handles authentication, storage, queues, and provider IO.
The interpreter has bounded memory and execution time. Its runtime exposes only
the saved game and the authored rules. A C session guard checks claims, presence,
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

## Saving, replay, and earlier worlds

Sharing validates the host's current save. It keeps the source browser save and
records its shared-world link separately. Later visits can continue the shared
world through **Worlds** or **Continue shared world**. Starting a new local game
starts a new source slot association.

Full worlds use an append-only journal and a checkpoint in the existing SQLite
store. Each action is checked against the current world as it executes. Unique
play keys make retries safe. Removing a checkpoint rebuilds the world from its
seed and recorded operations.

Rule version 3 introduced the home-item floor start. Version 4 added Greek
story cards and saved bard visits. Versions 5–8 added collected and shared quests,
shared journeys, quieter offers, and the first-signal ship gate. Published rule
versions 2–9 retain their exact interpreter bytes for replay.

The current rules version is reported by `/meta.card_game.shared_rules_version`
and comes from the shared engine constant.

Version 9 adds a two-card quest hand and explicit Drop actions. Loading an earlier
world first replays its accepted history with the recorded interpreters, then
records an upgrade to version 9. The upgrade preserves the world turn, item
positions, ship access, conversation, quest progress, and earned receipts.

Version 10 adds The Open Door. One traveler can accept Dione’s invitation
and open five places for everyone in that world. Greek pack revision 3 adds
eight residents and nine objects. The upgrade keeps earlier possessions,
choices, memories, and poem. Tests load real version 9 worlds from both a
checkpoint and the journal alone, then check the shared invitation.

Earlier shared invitations keep their IDs and account claims. Their first full
world load records an explicit migration seed. It maps the old rooms and items
onto the full game and keeps the old counters as migration evidence. Existing
single-player saves continue through the normal save upgrader.

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

## Collected quests

Each personal quest has a stable card key, its own steps, and the experience
that led to it. Each avatar carries at most two quest cards across personal,
shared, and story goals. The saved hand controls which cards appear. Existing
saves keep the focused purpose first, then meaningful progress and participation,
with stable ordering for remaining choices. Other records remain in the saved
collection and history.

Quest cards offer **Drop**. Dropping a card removes it from that avatar's hand
and focus while retaining its record, progress, participants, receipts, and earned
rewards. The saved drop keeps that identity out of the avatar's hand. Automatic
personal offers wait eight turns after a drop. New offers and joins respect the
two-card limit.

Generated experience offers keep one unfinished offer per situation family and
an eight-turn gap. Each collection pass chooses at most one offer and consumes
skipped experiences, so reloading preserves the gap. Distinct goals keep their
exact requirements and identify their companions when needed.

Each round captures matching cards before applying consequences. Each card
advances by at most one step in that round. Matching completions share one world
effect while each card keeps its own receipt: key, step, turn, and witnessed hand.
A fulfilled card fades from the hand after two world turns. Its completion
record stays available to saved history and the bard.

Completing the active quest begins a rest at a place marked `sanctuary: true`.
The station and attic are sanctuaries. Human rest counts that person's own turns
in a shared world. Resident rest counts world rounds.

The shared interpreter builder writes `engine-v10.js`. Earlier interpreters stay
frozen. Upgrade tests cover checkpoints, journal-only rebuilds, saved drops,
quest hand limits, and completion receipts.

## Shared words

The server records the action before requesting speech. Each play receives a shared
exchange. A conversation can include the resident who was addressed. A saved
turn-based choice occasionally adds a short atmospheric location line. Light,
weather, sound, and texture guide those lines. Repeated reads and retries keep
the same choice. The server records the lines
and their reading times so people in the room see the same exchange. The
conversation panel shows the current room's history.

Shared lines reveal letter by letter with the same voice sounds as solo play.
The line arrows review the conversation. Reaching its latest line resumes live
playback. Readers who advance early keep their place while the shared clock
catches up. The voice setting and reduced-motion setting apply to shared play.
A thinking animation marks speech preparation. The hand, avatars, and held props
use the same presented world while speech is pending. A circular portrait follows
the two line arrows. It shows the next queued player
or upcoming speaker, and keeps the latest speaker's portrait while the room is
quiet. Tapping it returns straight to the live dialogue.
Figures shrink in order of their most recent completed play in the room. Their
areas follow the Fibonacci steps 13, 8, 5, 3, 2, 1, so their heights change gently.
The two most recent players stand in front. On phones, they move lower into a
bust view as more people enter. Smaller figures sit higher behind them.
Repeated plays by one person keep the others in order. Changes move smoothly.
Reviewing older words keeps the figures and belongings in their current places.
Queued plays appear as small profile circles beside the dialogue. Their order
runs from top to bottom. A player can select their waiting circle to withdraw
their play; hover text and screen-reader labels name the player and queue state.

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
| Nell   | Growing gate                    | Wild glasshouse                |
| Tavi   | Wind path                       | Wind hill                      |
| Rue    | Carriage door                   | Between-hours carriage         |
| Orin   | Game-tile bridge                | Games pavilion                 |
| Ada    | Open seam                       | Sail loft                      |

A future Paris journey can depart from the existing station. Rue's carriage opens from
the station while her route board is present there. Carrying the board inside
the carriage opens the way back to the station. The saved crossing IDs stay
stable across the version 5 upgrade; earlier journals retain their pond route.

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
accents. Rue has close-cropped dark hair and a blue coat. Orin is tall and wiry,
with auburn hair, spectacles, and an indigo waistcoat. Ada has white hair and a
wooden wheelchair; Ash has a broad build and a grey beard.
