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

Rule version 3 introduced the home-item floor start and opened the home-to-pond
path when the item is carried in the home. Version 4 added Greek story cards
and saved bard visits. Released versions 2, 3, and 4 stay frozen for replay.
Recorded upgrades use the exact interpreter named by their target version.
Current version 5 combines those rules with collected personal quests.

Loading an earlier world first replays its accepted history with the recorded
rule versions, then records one upgrade from its latest version to version 5.
A direct version 2-to-5 upgrade settles unused items in unclaimed homes on the
floor. Upgrades from versions 3 and 4 preserve existing item positions. Each
upgrade advances the view revision and preserves the world turn and conversation.
The normal save migration adds collections and any missing recital records.

Earlier shared invitations keep their IDs and account claims. Their first full
world load records an explicit migration seed. It maps the old rooms and items
onto the full game and keeps the old counters as migration evidence. Existing
single-player saves continue through the normal save upgrader.

Migration preserves each held item, the lamp's state, and up to 80 saved
exchanges with their original text and times. An avatar carrying more than the
current limit keeps those items. That allowance shrinks as items are put down;
new pickups and gifts use the normal limit.

## Collected quests

Each personal quest has a stable card key, its own steps, and the experience
that led to it. The active card guides the next action. Other pending cards add
bounded weight to an NPC's item choices. The player chooses a focus with the
ordinary `pursue` action; NPCs choose from their circumstances and memories.
Switching preserves the progress on every card.

Each round captures all matching cards before applying their consequences.
Each card advances by at most one step in that round. A shared world effect
runs once for matching completions, while each card keeps its own receipt.
The receipt includes the card key, step, turn, and witnessed hand.

An avatar can hold eight unfinished cards. Matching suggestions coalesce.
The collection keeps up to 256 identities; new suggestions pause at that limit.
The latest 24 fulfilled cards keep their complete programs. Older fulfilled
cards keep their key, title, purpose, art kind, origin, completion turn, and
step count in an archive deck. Older saves keep their prior completion count
as migration evidence when the original card identity is unavailable.

Completing the active quest begins a rest at a place marked `sanctuary: true`.
The station and attic are sanctuaries. Human rest counts that person's own
turns in a shared world. Resident rest counts world rounds. A pending quest
can finish while another remains active, preserving the chosen focus.

The shared interpreters in `engine-v2.js`, `engine-v3.js`, and `engine-v4.js`
retain their released bytes. New commands use `engine-v5.js`. Replay works
with a checkpoint or with the seed and journal alone, including histories with
recorded 2-to-3, 2-to-4, and 3-to-4 upgrades. The bundle builder updates version 5.

Greek story cards join the same visible stack beneath the active personal
quest. Their saved pack receipts preserve the one-line text, art, and completion
labels. Completed cards remain in the collection; the first courtyard report
stays there when a later report adds another card. Story choices continue to
use the pack's ordinary actions.

## Shared words

The server records the action before requesting speech. Each play receives one
shared two-line exchange. A conversation can include the resident who was
addressed. Other plays can include a room detail. The server records the lines
and their reading times so people in the room see the same exchange. The
conversation panel shows the current room's history.

Shared lines reveal letter by letter with the same voice sounds as solo play.
The line arrows review the conversation. Reaching its latest line resumes live
playback. Readers who advance early keep their place while the shared clock
catches up. The voice setting and reduced-motion setting apply to shared play.
Figures shrink in order of their most recent completed play in the room. Their
areas follow the Fibonacci steps 13, 8, 5, 3, 2, 1, so their heights change gently.
The two most recent players stand in front. On phones, they move lower into a
bust view as more people enter. Smaller figures sit higher behind them.
Repeated plays by one person keep the others in order. Changes move smoothly;
reviewing older words uses the plays up to that point in the conversation.
Queued plays appear as small profile circles beside the dialogue. Their order
runs from top to bottom. A player can select their waiting circle to withdraw
their play; hover text and screen-reader labels name the player and queue state.

The approved OpenRouter request contains fictional profiles, scene facts,
visible people and belongings, and the completed play. Passkey and account data
stay with the account service. Provider errors leave the completed action saved
and show a scene error. Per-person and shared play budgets bound usage.

## Entrances and future journeys

| Person | Entrance | Home |
| ------ | -------- | ---- |
| Vale | Existing shore and mirror paths | Empty station and Mirror attic |
| Mara | Parted curtains | Paper theatre |
| Ash | Diving bell | Sunken belfry |
| Nell | Growing gate | Wild glasshouse |
| Tavi | Wind path | Wind hill |
| Rue | Carriage door | Between-hours carriage |
| Orin | Game-tile bridge | Games pavilion |
| Ada | Open seam | Sail loft |

A future Paris journey can depart from the existing station. Rue's carriage opens from
the station while her route board is present there. Carrying the board inside
the carriage opens the way back to the station. The saved crossing IDs stay
stable across the version 5 upgrade; earlier journals retain their pond route.

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
