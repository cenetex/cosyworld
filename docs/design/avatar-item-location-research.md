# Research: avatars, items, and locations

Date: October 16, 2026. Status: research and proposed experiments.

The brief is a simple game of avatars, items, and locations in a whimsical cosmic horror world. The player guides one avatar's intentions. The cast pursues its own aims. Cards and chat remain the interface.

Three research agents examined V1, card games, and OSR play. Follow-up work examined world construction, noun-card controls, and V2 reuse. The main review added physical simulation, character simulation, and writing. Source facts and proposed adaptations are separated below.

## What V1 actually did

The historical review used the initial release `2a3b645825ccf3786b373bda3c484df3b0b15cf3` and late V1 at `1f8b46bb7aac9f3f672837a4bc2cc5a47dc4544e`. V2 began at `43d67c17`; legacy source was removed at `928b9668`. These are source findings. Live behavior and player enjoyment would need separate evidence.

| Finding | Evidence at late V1 | Design value |
| --- | --- | --- |
| Human and generated avatar messages passed through the command system. The first emoji action reached ToolService. | [Command handler, lines 27–46](https://github.com/cenetex/cosyworld/blob/1f8b46bb/src/services/commands/commandHandler.mjs#L27); `chat/messageHandler.mjs:208–248`; `chat/conversationManager.mjs:803–888,1127–1139` | Speech, intentions, and acts shared one scene. |
| Avatars, items, and locations had saved identities and profile cards. Locations showed their cast and objects. | `src/schemas/avatarSchema.json:10–47`; `itemSchema.json:10–75`; `locationSchema.json:11–35`; `social/discordEmbedLibrary.mjs:184–239` | The three nouns already form a useful world model. |
| Travel searched known places, then found or created a named place. A visit was saved. | [MoveTool, lines 81–145](https://github.com/cenetex/cosyworld/blob/1f8b46bb/src/services/tools/tools/MoveTool.mjs#L81); `location/locationService.mjs:225–372`; `map/mapService.mjs:125–169` | Seeking, discovering, and returning can belong to the same loop. |
| An avatar had a selected item and a stored item. Storing swapped them. | [ItemTool, lines 72–139](https://github.com/cenetex/cosyworld/blob/1f8b46bb/src/services/tools/tools/ItemTool.mjs#L72) | Two carried objects provide a small, readable choice space. |
| Crafting joined two items of the same level. Success saved a new object and its source IDs, then consumed the inputs. A poor roll destroyed an input. | [ItemService, lines 378–445](https://github.com/cenetex/cosyworld/blob/1f8b46bb/src/services/item/itemService.mjs#L378) | Creation had material inputs, risk, and ancestry. |
| Item use saved nearby context under the item's ID. Its next reply spoke as the item's spirit and read its memories. | [ItemService, lines 174–182 and 281–298](https://github.com/cenetex/cosyworld/blob/1f8b46bb/src/services/item/itemService.mjs#L174) | Objects can carry stories between people and places. |
| Locations could speak about local events under their own name and image. | [LocationService, lines 563–595](https://github.com/cenetex/cosyworld/blob/1f8b46bb/src/services/location/locationService.mjs#L563) | A place can be a witness with a history. |
| Scheduling, replies, mentions, memory, and reflection shaped independent activity. A small planner used a held item for injury and sometimes chose a camera. | `chat/turnScheduler.mjs:110–169`; `chat/responseCoordinator.mjs:253–399`; `tools/ToolPlannerService.mjs:72–89`; `reflectionService.mjs:16–39` | Preserve character initiative and situational behavior. |
| Combat had initiative, attacks, defense, hiding, life loss, and autonomous turns. The active policy defended below 30% health and otherwise chose a living opponent. | [Combat policy, lines 646–663](https://github.com/cenetex/cosyworld/blob/1f8b46bb/src/services/battle/combatEncounterService.mjs#L646); `combatEncounterService.mjs:1030–1056`; `battleService.mjs:126–194` | Danger and survival were part of the world. |

The retained `items_export.csv` includes the Heart of the Quantum Lock, Starpetal Amulet, Grimoire of Whispers, and Elven Truffle Box. Their descriptions connect peculiar objects with forbidden knowledge, lost memories, and fickle gifts. Their elaborate powers have the evidence status of saved fiction. The ordinary item-use path mostly generated a spirit response; healing consumables also changed health and charges. `CreationTool.mjs:22–47` generated a custom ability's result as text. A future design should give every printed power an executable effect.

Tone varied across V1. Generic generation prompts asked for fantasy characters and places. `foundation/configService.mjs:64–70` later defaulted to a cosy tavern, while `BreedTool.mjs:87–90` asked for down-to-earth offspring. The user's current genre choice is the design authority. Historical object content supplies useful material for it.

The state review also found work for a future implementation: atomic pickup and transfer, stable item IDs, slot cleanup after failed crafting, and tests through the real action path. The two-slot idea and object ancestry are reusable design ideas; the old storage code needs fresh validation.

## What card games contribute

| Source | Source finding | Proposed use in CosyWorld |
| --- | --- | --- |
| [Stacklands](https://sokpop.itch.io/stacklands) | Card stacks express work with visible inputs. Resources, workers, and places share the table. | A combination should express a concrete act. The result should move or change something in the world. |
| [Cultist Simulator: recipes](https://weatherfactory.biz/cultist-simulator-recipes-and-bumping-brains/) | Recipes can accept common properties. The creator also describes the risk of arbitrary trial and error. | Let several objects provide light, weight, sound, or a container. Give unusual uses a clue. |
| [Book of Hours: Where Knowledge Goes](https://weatherfactory.biz/book-of-hours-where-knowledge-goes/) | An early design aim was for books to reward repeated consultation as understanding grew. | Keep objects useful across visits. Their history can change what an avatar knows. |
| [Book of Hours: Alchemy & Metallurgy](https://weatherfactory.biz/alchemy-metallurgy/) | Familiar objects create expected uses. The developer discusses crafting hints and repeating known actions. | Support a cup's ordinary use. Save a discovered strange use on its card. |
| [Card Survival](https://store.steampowered.com/app/1694420/Card_Survival_Tropical_Island/) | Cards take part in linked material, food, health, and environment systems. | Start with a few shared effects that apply to the whole cast. |
| [The 7th Continent rules](https://the7thcontinent.seriouspoulp.com/documents/t7c/The7thContinent_rulebook_ENfriendly.pdf) | World cards build the map; a separate deck supplies effort and success. | Treat location discovery and action cost as separate design choices. |
| [Dominion rules](https://www.riograndegames.com/wp-content/uploads/2016/09/Dominion2nd.pdf) | A small instruction language creates varied sequences. Deck building improves later hands. | Use few common operations. Test deck building if shaping future hands becomes part of the desired game. |
| [Magic: New World Order](https://magic.wizards.com/en/news/making-magic/new-world-order-2011-12-05) | Reading a card, tracking the board, and choosing a strategy impose different kinds of complexity. | Test the whole scene as well as the wording of each card. Keep common powers short. |

The strongest fit is a persistent card for each relevant world thing. A card enters view when the avatar sees or acquires it. It leaves the carried hand when it is given, dropped, consumed, or destroyed. A busy state can mark an avatar's current act. The scene itself supplies limits through reach, ownership, carrying space, time, and danger.

A separate deck could serve several purposes: cycle available acts, let players build stronger future hands, or spend effort for better odds. The 7th Continent provides an example of the last use. Each purpose deserves its own test if the world rules create a need for it.

A proposed rule sentence is: **An avatar acts on something nearby, with one optional item. The act takes time. The cast then acts.**

## What OSR play contributes

**Goals and information.** Cairn gives players responsibility for their goals and encourages creative use of resources. Its referee guidance gives NPCs memory and self-interest. McDowall's action procedure starts from the described circumstances and makes stakes clear. For CosyWorld, a player may pursue a rumor, steal an object, help someone, flee, or change their aim as the scene changes. [Cairn rules](https://cairnrpg.com/first-edition/cairn-srd/), [A Procedure for Play](https://www.bastionland.com/2017/01/a-procedure-for-play.html)

**Carrying space.** Mausritter puts equipment and conditions in a shared slot system. This makes treasure, tools, and trouble compete for space. CosyWorld can compare that approach with V1's two carried slots. The useful question is whether players can understand and value each carried object. [Mausritter inventory](https://mausritter.com/srd/inventory/)

**Time and consequences.** Cairn's exploration cycle resolves intended acts and ongoing activity, then records resource and condition changes. Detailed searches take time. CosyWorld can make card inspection free while travel, use, searching, and serious bargains advance one scene beat. [Cairn procedures](https://cairnrpg.com/second-edition/players-guide/procedures/)

**Creatures with choices.** Cairn provides reaction and morale rules. A creature can bargain, help, withdraw, or fight. In CosyWorld, known relationships and current wants should guide the response; a new uncertain encounter can use a bounded reaction rule. [Cairn reactions](https://cairnrpg.com/first-edition/cairn-srd/#reactions)

**Activity and warning.** Mausritter's encounter procedures include omens and encounters already doing something. CosyWorld should reveal signs of an actor's current plan: wet footprints, a moved lamp, or a covered cart. These give the player something to investigate or interrupt. [Running Mausritter](https://mausritter.com/srd/running-mausritter/)

**Goals with resources.** Mausritter factions have resources and short progress tracks. Player acts can change both. For CosyWorld, a group's plan can refer to actual carriers, objects, and routes. Moving one object then changes what the group can do. [Mausritter factions](https://mausritter.com/srd/hexcrawl-toolbox/#factions)

**Strange tools.** Cairn's paired goblets exchange liquids; other relics have short powers and specific limits. The useful pattern is one clear effect with many applications. An object that draws water can expose a doorway, fill a cistern, float a boat, or endanger a room. [Cairn Reliquary](https://cairnrpg.com/second-edition/wardens-guide/reliquary/)

These lessons support clear facts, chosen risks, and reusable tools. Exact inventory size, encounter rates, and dice formulas remain playtest choices.

## How to construct a world

The following procedure is one proposed site template. Its map shape and counts are choices for the first test. It adapts [Cairn pointcrawls](https://cairnrpg.com/second-edition/wardens-guide/pointcrawls/), [Cairn dungeon seeds](https://cairnrpg.com/second-edition/wardens-guide/dungeon-seeds/), [Cairn setting seeds](https://cairnrpg.com/second-edition/wardens-guide/setting-seeds/), and [Mausritter adventure sites](https://mausritter.com/srd/adventure-site-toolbox/).

1. Give the place an ordinary purpose and one strange change. A station once carried passengers. Its abandoned platform now receives trains from reflections.
2. Make a small connected map with a loop, a refuge, and a second approach to its main danger. Give each route a visible clue and travel cost.
3. Place avatars with concrete aims, possessions, and current activity. Let two aims compete over the same object or route.
4. Place ordinary tools and one strange object. Give each power a clear range, limit, and sign. Give the important tools useful applications in several places.
5. Add a changing hazard through the same world rules. Record its sign, trigger, effect, and ways to alter the facts that drive it.
6. Connect the contents: a former owner, a delivery route, a source of fuel, a sound heard next door, or a creature following food.
7. Run a few world turns before the player arrives. Keep the changed positions and traces as opening clues.

The generator should produce entities and their links first. Descriptions should follow those facts. A generated power selects from a small tested rule vocabulary. A new rule joins that vocabulary through a separate design and test step. This makes future generated objects consistent with things the player has learned.

Use these checks for the first site: three visible reasons to care; two approaches to an important aim; a useful interaction that also works elsewhere; one independent cast act that changes an opportunity; and one lasting result another visitor can find. Later site templates can set their own counts and layout checks.

## Simulation and tone

**Common physical rules create room for invention.** Qud's developers describe player and NPC bodies using the same simulation. Their example walls can be dug through, corroded, or melted. For CosyWorld, a small set of shared properties can make tools useful in several contexts. Begin with a few interactions that every actor can use and observe. [Caves of Qud developer description](https://cavesofqud.com/press-kit/)

**A reply can be a chosen act.** Versu's creators describe characters using the same planner to choose social responses and other actions. Reactions depend on preferences, relationships, mood, and witnessed events. For CosyWorld, being offered an object creates an opportunity for its recipient. Its reply follows its own aim and evidence. [Versu conversation design](https://emshort.blog/2013/02/26/versu-conversation-implementation/)

**Memory can support plans.** The Generative Agents paper studies observation, memory, reflection, and planning as parts of believable behavior. Those results support a character architecture. Player agency, useful choices, and fun still need game playtests. [Generative Agents](https://arxiv.org/abs/2304.03442)

**A few shared facts travel further.** Failbetter's parsimony guidance favors a small set of reusable qualities. For CosyWorld, a condition such as a light being lit should affect visibility, creatures, and local powers wherever it occurs. One special flag for every object pair would make the world costly to extend. [Narrative parsimony](https://www.failbettergames.com/news/narrative-snippets-parsimony-2)

**Tone can live inside the rule.** McDowall favors short rules with effects that belong to the imagined world. Failbetter favors short, observable descriptions and clear action wording. For CosyWorld, whimsy can come from a creature's ordinary concern; horror can come from the scale or price of the object it handles. A polite porter wants to finish a delivery. The parcel casts a shadow of a different city. Each concrete detail should help the player perceive, predict, or act. [Bastionland Manifesto](https://www.bastionland.com/2020/04/the-bastionland-manifesto.html), [Fallen London writing guidance](https://www.failbettergames.com/news/fallen-london-writer-guidelines-part-iii)

## A small experiment

This is an original test arrangement. The numbers and powers are proposals.

Use a station, an attic, and a pond, with an ordinary route between each pair. Give the player one avatar. Add a moth that seeks light and a keeper who seeks quiet. Place a lamp, fuel, bell, blanket, cup, and loose key.

| Rule | Predictable effect |
| --- | --- |
| A lit lamp uses fuel each beat | Light reveals details in its place. |
| A moth sees light in a linked place | It moves one link toward it. |
| A bell rings | Nearby listeners can hear its location. |
| The tired keeper hears a bell | The keeper seeks its source. It carries a loose bell to the attic. It asks a holder to hand over a carried bell. |
| A blanket covers an object | It blocks that object's light. |
| A cup holds a small object or liquid | Its contents move with the cup. |
| Light touches a marked reflection | A route opens through that reflection while it stays lit. |

The last rule is the first strange law. A clue shows a reflected door opening before its real door. Teach it once, then let it work at the pond and at a mirror elsewhere. An avatar can explore, rescue the moth, hide the lamp, steal a key, trade with the keeper, or leave. A third party can move the lamp and change the route.

Give the guided avatar the aim “reach the reflected platform.” With a known lamp on the ground and a lit-path clue in memory, it chooses to pick up the lamp. A player can then direct a different step or let the avatar pursue the aim. Each step uses the same action rules. The keeper's bell transfer tests independent activity: a useful object changes place, and the player must respond to that fact. Playtests should establish how much action players want to delegate.

The scene succeeds when players infer a useful combination, care about an actor's next move, and carry something learned into another place. The next experiment can add V1-style item fusion and object memory. Its generated result must carry a clear power, a cost, and its source objects.

## Controls that make intent clear

The current [Story Hand](../../v2/docs/story-hand.md) already uses location, avatar, and item nouns. It resolves a selected set to one verb through a fixed order. Its exact preview and server validation are useful foundations. The next control test should add the player's intent to that resolution.

| Candidate | How it works | Useful trade-off |
| --- | --- | --- |
| Nouns, then intent | Select cards, choose a short legal verb, then confirm the sentence. | Clear for giving, using, threatening, and attacking; adds a small local choice. |
| Nouns plus chat | Select cards and type what the avatar should attempt. Confirm the resulting sentence. | Supports broad intentions; common moves require more typing and language interpretation. |
| Direct placement | Move an object to the ground, another avatar, or a destination. Confirm the act. | Clear for transfers and travel; a weapon aimed at an avatar still needs an intent choice. |

The research recommendation is nouns followed by a short intent choice, with chat for a longer aim or an unusual proposal. Use specific words such as Drink when the item supports them. The guided avatar stays the subject. The preview names the actor, act, item, and recipient. Known exits appear together in the current place's details.

Test all candidates on the same frozen scene: one guided avatar holds a knife and tonic, another avatar is nearby, and three exits are known. Ask players to give, threaten, attack, drink, drop, inspect all exits, and choose the third exit. Reading spends zero beats. Each task must be reachable. The confirmed result must match the preview. An unintended attack rejects the control grammar. These are proposed tests; player sessions are still to come.

## What V2 can supply

The V2 trace used `83f551c1`, whose runtime source matches the reviewed base `54a21ee7`. Paths below start at `v2/orchestrator-rust/src/`, except the C kernel paths.

| Foundation | Evidence | Proposed use |
| --- | --- | --- |
| Avatar, location, and item records | `v2/core-c/include/cosy_kernel.h:437–479` | Keep stable identity, position, custody, conditions, and charges. |
| Typed actions and committed events | `cosy_kernel.h:593–622`; `main.rs:10771–10791,27794–27831` | Resolve every cast member's act through common rules. |
| Pickup rules | `v2/core-c/src/cosy_kernel.c:1584` | Preserve checks for reach, custody, capacity, and current state. |
| Active motives and memory | `residents/needs.rs:42–117`; `residents/continuity.rs:4–29,323–345`; `autonomy.rs` | Reuse desires, attachments, beliefs, promises, and current intent. |
| Bounded activity | `actor_jobs.rs:535–589`; `avatar_autonomy.rs:18–27,108–116` | Keep saved jobs, local turns, and explicit action limits. |

Four current rules shape the design problem:

- `composition.rs:2797–2803,481–522` limits the hand to one noun of each type and checks membership during action submission. `index.html:18853–18870` chooses a matching offer by rank. A complete set of relevant nouns and an explicit intent can make those choices easier to understand.
- `first_tale.rs:224–265,374–398` advances a staged opening guide. `composition.rs:3183–3207,455–464` pins and prioritizes an advancing offer. The new experiment can use those characters and clues as an opening situation.
- `autonomy.rs:399–430` and `composition.rs:3084–3102` filter resident choices through the hand. `avatar_autonomy.rs:841–894` can keep a nearby item goal in a seeking state. A future planner should choose from legal world actions, while the UI presents a readable view of them.
- `autonomy.rs:714–740` keeps the last nearby resident in the room during a ripple. Other movement rules reflect gifts and jobs. Explicit commitments can remain reasons to stay; a resident's own motive should guide its other travel.

`residents/drives.rs:33–37` describes a prepared foundation awaiting integration. The current active motive path is `needs.rs`, `continuity.rs`, and `autonomy.rs`. Start there when testing independent plans.

Keep V2's world records, transfer consent, shared rules, action receipts, memory sources, and replay. Change the presentation and selection rules in a small isolated scene. Broader drive systems and world expansion can follow evidence from that scene.

## Decisions still open

- Compare V1's two carried slots with a small visible pack. Measure how many item powers players remember.
- Test the recommended short intent choice against the other control grammars. Use ambiguous plays such as a knife and another avatar.
- Choose how far a player's intention may delegate action. Show the next risky step before it happens.
- Decide how distant actor activity advances. The first slice can keep activity local and bounded by scene turns.
- Prove a small set of reusable effects before expanding generation, factions, or long-term progression.

The companion [design direction](avatar-simulation-redesign.md) records the proposed next slice and its acceptance tests.
