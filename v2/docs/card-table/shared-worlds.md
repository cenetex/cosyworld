# Shared worlds

Open **Share** in the current game. Sign in with a passkey and choose **Share this
world**. Friends enter that saved world through its invitation. The host keeps
Vale, the current place, belongings, resident state, quests, and conversation.

The original card table remains the game screen. Black pond, Empty station,
Mirror attic, Pip, the keeper, Badger, mounted story packs, and their rules belong
to this same world. Each account claims one of eight human avatars. Each room
holds four present humans. Residents can share a room with those humans.

The seven new humans start in their homes with their signature items. Each home
leads to the existing Black pond. Its item reveals the entrance when it rests at
the pond or is carried by a present human there. Full destination cards disappear
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

Earlier shared invitations keep their IDs and account claims. Their first full
world load records an explicit migration seed. It maps the old rooms and items
onto the full game and keeps the old counters as migration evidence. Existing
single-player saves continue through the normal save upgrader.

## Shared words

The server records the action before requesting speech. Each play receives one
shared two-line exchange. A conversation can include the resident who was
addressed. Other plays can include a room detail. The server records the lines
and their reading times so people in the room see the same exchange. History is
local to the room.

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

A future Paris journey can depart from the existing station. Rue's carriage can
arrive there for boarding. Its route board reveals the door to her home at the
pond while that item is present there.

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
