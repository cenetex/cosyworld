# CosyWorld: a card game about a life

Status: archived exploration, reviewed October 16, 2026. The next design starts from avatars, items, and locations in a whimsical cosmic horror world. Research into V1 CosyWorld, card games, OSR play, and world simulation will guide that design. The prototype below records an earlier experiment.

**Play a card into someone else's plans. See what they do. Build a hand shaped by the life you lead.**

The player guides one avatar's intentions while the whole cast acts on its own. Each card expresses a concrete intention: reach out to someone, offer an item, explore a place, or keep an agreement. The player chooses the card and its target. The avatar carries out that attempt. The other people choose their own replies and next steps.

The purpose is to build a life worth caring about. A friendship gives you someone to ask for help. A repaired lantern opens an evening walk. A garden brings new visitors. These changes create future cards and uses for the cards you already have.

## The core problem

The earlier proposal placed intentions, a suggested action, entity tiles, and a journal around an approval button. That made the player manage a character through panels. The user's key correction is that the game should be playable through its cards.

This revision puts the choice inside the hand. The table holds people, places, and active situations. Chat carries the voices and consequences. The player's question is **“What can I make happen with these cards?”**

## A turn

1. Read the short exchange. Notice what the people on the table want.
2. Choose a card from your hand. Its valid targets show their possible uses.
3. Choose a target. Read the exact attempt, the cost, and what depends on the recipient.
4. Play the card. Spend or move it according to its type.
5. Each eligible person takes one turn. Read what changed and receive any new cards.

One play costs one turn. Inspection, target selection, and putting a card back are free. Every card shows its cost and where it goes after play. Tap a card, tap a target, then confirm. Keyboard controls use the same sequence. Dragging can become a shortcut after this sequence works well on phones.

The avatar's wishes and personality shape the hand and its wording. Playing **Reach out** on Pip means “spend a moment with him.” Briony's voice supplies the story she tells. Pip's needs and history shape his answer. A wider personal wish may stay in the journal as context for future opportunities.

## The hand and the table

| Kind | Example | What happens when played |
| --- | --- | --- |
| Approach | Reach out, Look closer | Spend it for this hand. A rest brings it back. |
| Item | Mint sprig, Brass ring | Give, trade, plant, or use the real item. The card follows ownership. |
| Invitation or agreement | Supper invitation | Ask for the named commitment. Acceptance uses the invitation; a request to wait leaves it in hand. |
| Rest | Take a breath | Recover spent approaches. The cast takes its turns. |
| Table card | Rati, Pip, Garden | Show the person, place, or situation that receives a play. Its state changes with events. |

Begin with four cards: **Reach out**, **Look closer**, **Mint sprig**, and **Take a breath**. Keep the first scene to four table cards. Cards gained during play join the hand immediately. An item has one card per usable stack; the runtime can show a quantity when a stack holds several.

The small set of approaches gives each choice weight. A player who uses Reach out on Pip must rest before using it on Rati. The cast advances during that rest. Items offer other ways to spend the next turn. This creates a choice between using what is already in hand and giving the scene time to change.

New cards come from the world. A trade brings a ring. Exploration brings seeds. Rati's welcome brings an invitation. Each arrival has a visible source in chat. Future growth can add a new approach earned through practice, a friend's permission, a recipe, or access to a place. The player's life becomes the source of their hand.

Approach recovery is a proposed game rule. It needs a shared runtime rule for both direct and autonomous actors. Its effect on pace and repeated actions is a playtest question. Start with the two approaches in the prototype and measure how often players choose a rest.

## The first evening

Briony arrives with one sprig of mint. Rati is cooking soup. Pip has a brass ring and wants mint tea. Mara wants to read outdoors, and the ring fits her lantern. The garden has fireflies, seeds, one more full mint sprig, and an old wind chime.

The situation supports several connected choices:

| Play | Immediate result | New possibility or trade-off |
| --- | --- | --- |
| Mint → Pip | Pip agrees to trade. Draw Brass ring. | Use the ring for Mara's lamp or the garden's chime. |
| Mint → Rati before serving | The shared soup gains mint. | The first sprig goes to the meal. Another sprig takes time to find. |
| Mint → Rati after serving | Briony makes tea for Rati. | The same card fits the changed scene. |
| Brass ring → Mara | Mara receives a useful part. | She repairs her lamp on her own turn. Rati can then serve outdoors. |
| Brass ring → Garden | Briony repairs the wind chime. | Mara can make a wooden brace for her porch lamp. |
| Reach out → Pip | They share stories and become friends. | Pip welcomes company and may plant gifted seeds with Briony. |
| Reach out → Rati | Draw Supper invitation. | Choose whom to ask and when to ask them. |
| Look closer → Garden | Draw Moonflower seeds. | Plant alone or let Pip choose their home. |
| Take a breath → Briony | Recover spent approaches. | Rati cooks, Mara repairs, and Pip pursues his own plans. |

The soup has a visible serving time. Mara's repair changes according to the parts she receives. Pip can ask to finish his acorn before supper. These are small, understandable pressures. The player can choose whom to help and what kind of evening to create.

The scene settles into a shared memory. A later visit begins with its results: an outdoor supper spot, a porch reader, a working chime, or a patch planted with a friend. Further scenes should reuse these facts. A lantern can support a night walk. A friendship can support a joint project. A garden can yield an ingredient.

## What makes a good card

A card has a clear verb, a readable target, and a useful effect. Its rules fit in two short sentences. The preview names the exact use in the present scene. **Mint → Pip: trade for his ring** is enough to plan around.

Where several uses make sense, show them on their targets. A ring can support a lamp or a chime. A seed packet can become a personal garden or a gift. Items, relationships, timing, and place should connect in ways the player can learn and reuse.

Social cards show the boundary of the attempt. A known offer can promise a trade. An invitation can explain that someone is busy. The recipient makes the decision at resolution. A refusal advances time, preserves the invitation, and gives a useful reason. That reason can suggest a different time or approach.

Every lasting gain should change a later play. Friendship should affect an answer or open an agreement. A new feature should have a use. A remembered deed should change whose help is available. Test the next use alongside the reward that creates it.

## Chat is the voice of the table

Keep the hand and table visible during play. Above them, show the current exchange: the player's play, the cast's useful reactions, and any cards gained. A brief factual line states ownership or place changes. Character speech gives those events meaning.

The journal holds the full conversation and lasting memories. Card inspection brings a public motive into focus for free. Future free text can express a thought to another avatar; a request with a world effect becomes a visible card offer for the player to approve.

The prototype shows all events from the last turn. Runtime presentation should group routine events into a short line and let the player open the full exchange. Give each meaningful card arrival, transfer, and changed table card a brief motion. Keep the same information available when reduced motion is enabled.

## A living cast

Each avatar has values, current desires, beliefs, commitments, and a short plan. These supply reasons for its choices. Actors receive legal actions from the same rules. Their plan chooses an action that fits their current circumstances.

A character may revise a plan when a resource moves, a promise is made, or a need changes. Mara's reading goal can lead to a portable lantern or a sheltered porch lamp. Pip can pursue a planting plan while also wanting supper. These separate aims make the table interesting to read.

The player guides Briony through each card play. Other avatars retain their items, decisions, and commitments. Shared projects require their agreement. The language model may propose a choice or express a voice. Certified actions establish the resulting world changes.

The local prototype uses authored lines and explicit rules. It proves the card interaction and a small set of connected outcomes. The runtime slice must also demonstrate those outcomes through the shared action system and live actor choices.

## Shared time and saved play

Quiet worlds rest. Reading and preparing a card preserve time. A confirmed play uses the guided avatar's initiative seat. Each eligible autonomous actor uses its own seat once. Each action resolves against the current state. Another directly controlled human seat pauses automatic advancement until that player acts.

In the local prototype, a turn includes Briony and one activation for each of the three cast members. The runtime shows whose turn is active and names another player when the scene is waiting for them. Local inspection remains available throughout.

A resource can change between preview and play. The server checks the action certificate and ownership again. A stale play refreshes the table and returns the card to the player's control. Commit the card cost and the world effect together. This includes spent approaches, item transfers, and recipient consent.

Persist the hand through its real sources: owned items, earned approaches, approach recovery state, and live agreements. A save restores the same available plays and table facts. Leaving suspends owner delegation by default. Any future stay-active option uses the existing action, speech, and scope limits.

The conversation preview can restore a bounded visit from up to 120 card choices. The standalone file starts a fresh evening on reload. Long-term saves and shared rooms belong to runtime adoption.

## Design influences

These primary sources support the direction. The rules above are proposed CosyWorld choices.

- **Stacklands:** cards interact with other cards to produce resources and change a village. Use that direct relationship between the player's gesture and a world change. [Sokpop's game description](https://sokpop.itch.io/stacklands)
- **Book of Hours:** books, visitors, furnishings, and weather have places in a world handled through cards. Give each card a stable meaning and a visible source. [Weather Factory's world and interface notes](https://weatherfactory.biz/shutter-the-windows-against-the-sea/)
- **Wildermyth:** situations use the cast's traits and relationships, understandable choices, and lasting changes. Let the evening produce facts that matter on another visit. [Story inputs and outputs](https://wildermyth.com/wiki/Story_Inputs_and_Outputs)
- **RimWorld:** people and what they value give events their stakes. Connect every resource to someone who has a reason to care. [Tynan Sylvester's design notes](https://ludeon.com/blog/2022/10/biotech-expansion-announced-update-1-4-on-unstable-branch/)

## Fit with the current code

The source review used main at `54a21ee7`. Runtime adoption needs a review of the current card and rules contracts before implementation.

| Existing part | Planned use |
| --- | --- |
| `composition.rs` and Story Hand | Project available approach, item, and agreement cards; expose exact uses on visible targets. |
| Shared action offers and certificates | Resolve each card play against an authoritative offer; commit its cost with its effect. |
| `residents/drives.rs` and `residents/continuity.rs` | Rank choices from desires, observations, and commitments; remember effects on relationships. |
| `autonomy.rs` and `avatar_autonomy.rs` | Keep bounded activations and the player's ownership of Briony's direction. |
| `first_tale.rs` | Present the opening cast and their needs as a starting situation. |
| Jobs, features, recipes, and clocks | Supply card effects, alternate uses, and visible time pressures. |
| Actor practices, Journal, and replay | Support earned approaches, saved memories, and exact restore tests. |

The current Story Hand resolves selected nouns through a fixed verb order. This proposal gives each hand card an explicit playable purpose and previews each legal target use. Card selection becomes free preparation. Approach recovery becomes an explicit shared game rule. These changes require a rules decision as well as a browser change.

Existing quest content can supply people, desires, resources, and remembered deeds. Contribution credit and return memories from [PR #1050](https://github.com/cenetex/cosyworld/pull/1050) can become sources of future cards. That PR was open at the original source review.

## Delivery and playtest gates

**Stage 1: prove the card game.** Use the included standalone prototype. Test the hand, target choice, card trade, recovery, recipient response, and independent cast. Compare several endings to the evening. This stage is the scope of this PR.

**Stage 2: connect one shared room.** Add the two approaches, rest, and a few items through the authoritative action surface. Implement approach recovery for every actor. Use four avatars and one room. Exercise ownership conflicts, changed targets, and another human's turn.

**Stage 3: make the next visit matter.** Save the changed hand, agreements, relationships, and place features. Give the lantern, garden, and friendship at least one later use. Verify exact restoration and delegation cancellation.

**Stage 4: extend the world.** Add another place and a few new card combinations. Measure how quickly players understand their hand and how often they find a use themselves. Expand the cast after those choices feel clear.

Start with five observed sessions of 15 minutes. Give each player the four-card hand. After three plays, ask what they played, why they chose its target, what they gave up, and what another person wants. Let them tell the story of their evening.

Initial targets: four of five players complete their first play without help; four explain an alternate use for a card; four understand recovery; four identify an independent cast action. Across the sessions, look for at least three different outcomes chosen by players. Record idle time, recovery turns, and invitations that feel confusing. Later sessions test whether the saved changes create a reason to return.

## Prototype review

Open `avatar-simulation-prototype.html` beside this document. Choose a hand card, choose a table card, and confirm the play. Try Mint on Pip or Rati. Try the ring on Mara or the garden. Use Reach out on Rati to gain an invitation. Use Take a breath to recover an approach. Open the journal to see lasting changes.

Run `npx vitest run test/card-game-prototype.test.mjs` for the model checks. They cover item conservation, recovery, refusals, changed offers, distinct outcomes, independent cast turns, replay, and varied play sequences. Browser checks cover the visible controls, keyboard flow, and narrow layouts.
