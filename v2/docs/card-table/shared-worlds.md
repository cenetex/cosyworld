# Shared worlds

Open **Share a world** on the card table. Sign in with a passkey, create a world,
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
The journal rebuilds the world after restart. Queue requests have unique keys.
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

## Art

The built-in image generation tool created the sheets in `v2/card-game/assets/`.
The cast is Vale in black and Mara, Ash, Nell, Tavi, Rue, Orin, Ada in rainbow
order. The cast atlas uses Mara/Vale/Ash/Nell above Tavi/Rue/Orin/Ada. The place
and item atlases use Vale/Mara/Ash/Nell above Tavi/Rue/Orin/Ada.

The revised place prompt calls for eight equal square panels in a 4-by-2 sheet,
quiet watercolor and gouache, natural wood, stone, paper and mist, with a small
complementary accent in each room. Vale's station is ivory; Mara's theatre sage;
Ash's belfry dusty blue; Nell's glasshouse violet; Tavi's hill brick red; Rue's
train apricot; Orin's pavilion ochre; Ada's sail loft pale yellow-green.

The item prompt calls for eight centered, readable, hand-painted objects on ivory
paper: black railway lamp, red theatre mask, orange diving float, yellow watering
can, green signal kite, blue route board, indigo game board, violet sewing shears.

Source image IDs: cast `385b3536-dfb2-4525-8d46-c70b683fa6d4`, places
`f77ac620-de5c-4743-af6e-07fb5b54cb95`, items
`0e9a8022-fcf1-49d7-9afd-63f47307fead`.
