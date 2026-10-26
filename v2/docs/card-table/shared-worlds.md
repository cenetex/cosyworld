# Shared worlds

Open **Share** on the card table. Sign in with a passkey, create a world,
choose an avatar, and copy its share link. Each world holds eight avatar claims.
Each account claims one avatar per world. Each room holds four present people.
An invitation grants access to the avatar picker. Claims persist until released.

Players start in their own homes with their signature items. Every home leads to
Black pond. An item carried by someone at the pond, or placed there, reveals its
home. The entrance follows the item. People already inside can return to the pond
when it has space. Full destination cards disappear from the current hand.

Select cards and play an action. A room holds four pending plays, including the
current play. Each person has one pending play. Waiting plays can be withdrawn.
The server checks the chosen action again when its turn arrives. A nudge briefly
asks for another person's attention. People can sit quietly while the scene runs.
Presence has a 60-second reconnect grace; the avatar claim remains saved.

## Authority and storage

`card_table.c` owns claims, presence, room capacity, routes, and item custody.
Rust serializes commands in SQLite transactions beside the existing event store.
A saved checkpoint keeps reads small. The journal rebuilds the same world when the checkpoint is removed. Queue requests have unique keys.
A worker records the action before requesting speech. An expired worker leaves
the action saved and records a visible speech error. Shared scene timestamps let
all visitors read the same two lines. Conversation history is local to the room.

Passkeys use the existing account service. Account cookies establish the actor.
The invitation is a private 192-bit random URL. Room views expose local people
and items. The approved OpenRouter request includes the acting character's
profile, visible names/items, room description, and completed fictional play.
The provider returns one character reaction and one scene line. The server
checks their shape and length before publication. Account play budgets and a
shared hourly budget bound provider use.

The new tables are additive. The single-player entry retains its saved game.
Version tags deploy the shared entry to lonelyforest.com through the existing
release workflow.

## Entrances and future journeys

Each signature item reveals a distinct entrance at Black pond:

| Person | Entrance         | Home                   |
| ------ | ---------------- | ---------------------- |
| Vale   | Lit arch         | Empty station          |
| Mara   | Parted curtains  | Paper theatre          |
| Ash    | Diving bell      | Sunken belfry          |
| Nell   | Growing gate     | Wild glasshouse        |
| Tavi   | Wind path        | Wind hill              |
| Rue    | Carriage door    | Between-hours carriage |
| Orin   | Game-tile bridge | Games pavilion         |
| Ada    | Open seam        | Sail loft              |

Entrance cards show the destination and the entrance name. Selecting one describes
how it appears. Item presence and the four-person room limit still control access.

A future Paris journey can depart from Vale's existing station. Rue's carriage is
her home between journeys; her route board could bring it alongside the station
for boarding. This release keeps that connection as a design direction. A later
journey needs its own destination, boarding rules, and shared arrival event.

## Art

The built-in image generation tool created 25 individual paintings under
`v2/card-game/assets/shared/`: eight transparent people, eight transparent items,
and nine wide room scenes. Full prompts and source IDs are in `art-prompts.json`.

Vale wears black. Mara, Ash, Nell, Tavi, Rue, Orin, and Ada follow rainbow order.
Rue has close-cropped dark hair and a crisp blue coat. Orin is tall and wiry, with
auburn hair, spectacles, and an indigo waistcoat. Ada has white hair and a wooden
wheelchair; Ash has a broad build and a grey beard.

Each home uses natural wood, stone, paper, and mist, with a quiet complementary
accent: ivory, sage, dusty blue, violet, brick red, apricot, ochre, and yellow-green.
The station has an empty clock; the theatre unfolds from paper; the belfry holds
a dry room underwater; the glasshouse shelters a signal cabin; the hill rises
above the clouds; the carriage has morning and night windows; the pavilion has
folding panels; the loft has an unfinished sail that opens to the sky.
