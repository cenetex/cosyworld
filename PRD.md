# CosyWorld 2.0 PRD

## Current MVP Amendment

As of the current MVP direction, humans do not type or choose dialogue lines. The human presses `Chat`; the server authors an in-character line for the player's generated avatar using the configured LLM, or deterministic fallback text when no model is configured. That avatar line and the resident reply are committed as shared room events.

Branching dialogue is no longer part of the MVP interaction model. Future branch support may return as contextual world actions, but the current product path is the one-button, server-authored avatar chat loop.

## Summary

CosyWorld 2.0 is a shared, room-based MUD chat experience where locations are channels, avatars are residents, humans arrive as generated avatars, and play happens through conversation.

The first release is intentionally small: one canonical location, The Cosy Cottage, with three resident NPC avatars:

- Rati, a mouse fond of knitting scarves and telling stories.
- Whiskerwind, who only speaks using emoji.
- Skull, the silent wolf.

The product should feel like entering a living room in a tiny online fantasy world, not like opening an admin dashboard, wallet interface, quiz app, or one-on-one chatbot.

## Product Thesis

CosyWorld works when the user believes the room is real enough to return to.

The player should first become someone in the world. After generating a human avatar, they see a location, sense who is present, and press one clear action. The system responds as a shared place with server-authored avatar chat, resident replies, movement, memory, items, autonomous avatar behavior, and constraints. The UI should recede so the channel and its inhabitants carry the experience.

## Goals

- Replace the existing multi-panel prototype UX with a single-room chat server experience.
- Gate chat behind human avatar generation.
- Keep one primary action surface in the resting UI. It usually says "Chat", but can become "Create Avatar", "Give Item", "Travel", or another context action.
- Treat avatars, items, and locations as card-backed world entities, with NFT metadata and card art as the canonical presentation layer when available.
- Treat locations as channel-backed places with shared history.
- Treat the world as one shared global state, not a private per-user simulation.
- Treat avatar movement, entrances, exits, idle beats, and failed movement as room events.
- Replace branching dialogue with server-authored avatar chat generated from room context.
- Allow players to connect their own OpenRouter account for Orb-free Chat while keeping all AI output in the shared world.
- Charge Orbs for server-paid Chat when the player has no connected OpenRouter payer.
- Replace Ruby High-style quiz answer loops with CosyWorld encounters using `Attack`, `Defend`, `Flee`, and `Use`.
- Support item discovery and avatar evolution through unique world items.
- Preserve the cozy fiction of The Cosy Cottage while designing for future locations.
- Reuse the stronger existing CosyWorld primitives for avatars, locations, memory, map position, response coordination, and turn scheduling.
- Borrow the best Ruby High patterns: one primary action, room-first framing, and separation of durable dialogue from volatile room events.

## Non-Goals

- Do not build a general dashboard, collection browser, wallet flow, leaderboard, or admin surface into the main experience.
- Do not expose all backend concepts as visible UI controls.
- Do not make the experience feel like a one-on-one assistant.
- Do not make branching dialogue feel like school quiz questions or grading.
- Do not expose OpenRouter connection as a private DM or one-on-one resident chat mode.
- Do not make avatar evolution a generic XP grind.
- Do not let users chat before they have generated a human avatar.
- Do not have every resident reply to every user message.
- Do not let characters invent open exits before the engine unlocks them.

## Users

### Primary User

A player who wants to enter a cozy AI world, speak naturally, and see the room respond.

Before chatting, this user creates a human avatar. The avatar is their embodied identity in the shared world, not just a display name.

### Secondary User

A returning player who expects continuity: the same room, resident personalities, recent history, and remembered facts.

This user expects their avatar, inventory, relationships, and known world progress to persist.

### Internal User

A developer or world designer who needs a small, durable seed world that can expand into channels, exits, NPC behaviors, and tools without rewriting the product.

This user needs data-driven locations, items, resident behavior, and evolution requirements.

## Shared Global World

CosyWorld is one shared global world.

Requirements:

- Locations, room timelines, avatar positions, discovered items, and evolution state are global.
- Autonomous NPC movement and world events affect everyone.
- Human players enter the same global room state, though their private inventory, avatar details, and relationship memories can be personal.
- The system must avoid duplicating "private copies" of The Cosy Cottage unless a future product mode explicitly creates private rooms.
- Public world history should be moderated before wider release; the MVP replay surface is bounded by default and by explicit cap.

Design consequence:

- A player does not "start a chat with Rati." They enter a room where Rati may or may not be present, and the room has already been changing.

## Card-Backed World Objects

CosyWorld 2.0 should use the Ruby High card/NFT system as inspiration and infrastructure.

Avatars, resident NPCs, items, and locations are not merely database rows with optional images. They are cards first: stable ids, roles, names, art aspect, flavor text, rarity, provenance, and eventually chain-backed ownership or reveal data.

Requirements:

- Every visible avatar, item, and location has a card identity.
- Card records expose role, display name, title, blurb, art aspect, image URL, asset status, and optional chain metadata.
- Known Ruby High cards, such as Rati, should resolve through the existing First Bell catalog and on-chain image metadata.
- CosyWorld-only seed objects can start as local or pending cards, then graduate into the same pipeline when art and metadata are minted.
- The UI shape follows card aspect: avatars are round portrait crops, items are square, and locations are wide rectangles.
- Card ownership is additive by default: identity, cosmetics, collection, provenance, community status, and sharing. It must not accidentally become required progression.

### Free Core And Official Expansions

The free game must feel complete. CosyWorld Core includes the avatar gate, The Cosy Cottage, public nearby rooms, listening, Orbs, seed items, resident evolution, and the public practice/combat loop. A free player should feel like they live in the world, not like they are waiting in a storefront.

Official NFTs unlock official expansions inside the shared world. The first official expansion is **Ruby High: First Bell**, tied to Ruby High ownership from the trusted official feed. Its school rooms, such as Science Class and Library, require matching Ruby High location cards on the official shard.

Expansion ownership never creates private copies. If Alice and Bob both own the Science Class card, they enter the same Science Class channel, see the same shared timeline, and share the same AI residents. The system must not create one-on-one teacher DMs or per-user room instances for card owners.

Self-hosted shards may define their own public rooms, gated rooms, collection adapters, and content manifests. Those custom gates are valid for that shard, but the official hosted shard only trusts official collection configs and feeds.

Resident placement should come from aggregate card overlap:

- Everyone can enter The Cosy Cottage by default; no NFT is required for the lobby.
- Public CosyWorld Core rooms are accessible without NFTs.
- Official expansion rooms can require matching official collection ownership.
- A wallet holding an avatar card contributes the set of location cards also held by that wallet.
- For each resident avatar, the world scores locations by counting those wallet-location overlaps.
- The resident appears in the highest-scoring shared location.
- If multiple locations tie, the resident rotates through tied locations on a daily deterministic schedule.
- If there is no overlap for that resident, the resident defaults to The Cosy Cottage.
- Cottage access and Cottage gravity are separate. The Cosy Cottage is always public, but a future `cosy-cottage` card may still count as a location overlap vote for wallets that also hold a resident avatar card.

Example: if wallets holding `rati` mostly also hold `location-science-lab`, Rati spends the day in Science Class. Players who also hold Science Class can enter that room and see the same Rati/chat as everyone else there. Players without that location card still have the cottage, not a private fallback Rati DM.

This keeps the world extensible. Adding Whiskerwind art, Skull art, cottage variants, or evolution items should be a content pipeline operation, not a bespoke UI rewrite.

## Orbs, Boxes, And Packs

CosyWorld has two economy resources:

- Orbs are fungible in-world currency.
- Intricately Carved Wooden Boxes are wallet-owned NFTs.

Orbs should behave like MMO play energy, not like an external payment rail. They are earned by completing challenges, solving puzzles, advancing room goals, or resolving encounters. Chat costs Orbs because `Chat` asks the server to author a player-avatar line, commit it to the shared room, and potentially trigger resident AI. If the player has no Orbs, the primary command should become a world action that can earn them, such as `Challenge`, `Listen`, `Practice`, or `Notice`, rather than opening a shop.

OpenRouter account connection is an alternate payer for AI actions. If a player connects their own OpenRouter account or key, `Chat` costs no Orbs because the model call is paid by that player. The resulting avatar line and resident reply are still public shared-room events. The connection changes who pays, not who can see the world event.

Product requirements:

- `Chat` is available when the player either has a verified player OpenRouter payer or enough Orbs for server-paid Chat.
- The player OpenRouter payer covers the explicit action they initiated, normally the player-avatar line plus the immediate resident reply.
- The player's OpenRouter payer is not used for ambient residents, autonomous swarm jobs, or admin content generation.
- If the player has no connected OpenRouter payer and insufficient Orbs, the primary command should route them toward earning Orbs through a world action.
- "Unlimited" means no CosyWorld Orb cost; OpenRouter credit limits, rate limits, and model availability still apply.

Boxes are collectible NFT objects. A Box can be burned in a Ruby High card-pack style flow to create an avatar card pack. Opening the pack reveals avatar cards from the CosyWorld/Ruby High world catalog. The burn is irreversible and wallet-verified; the reveal is a shared provenance event.

Product requirements:

- Orbs are off-chain in the first production slice and live in the v2 account ledger.
- Orbs are non-transferable until there is a separate bridge design.
- Chat affordability is server-derived; the client must not decide that a player can spend Orbs.
- Boxes come from the trusted wallet ownership feed, not query params.
- Burning a Box requires a signed wallet transaction and an idempotent server receipt.
- Opening a Box or pack can be exposed as a contextual account/inventory command, but it must not replace the transcript as the main experience.
- Revealed avatar cards influence global shared-world systems, including resident placement and future cosmetic/evolution affordances.
- Revealed avatar cards do not spawn private NPC copies.

The legacy CosyWorld `orbGate` claim policy is not the new Orb economy. It is an ownership gate for a collection. The new Orbs are a game ledger tied to committed world play.

## Human Avatar Gate

The human must generate an avatar before they can chat.

Requirements:

- First entry shows The Cosy Cottage as a visible destination, but the primary action is "Create Avatar".
- Avatar creation should feel like being welcomed into the world, not filling out a settings form.
- Generated avatar output should include at least name, portrait or visual identity, short description, and starting location.
- Avatar names are public room identity and must be server-sanitized; unsafe, reserved, overlong, or prompt-injection-like names fall back to a neutral traveler name.
- A signed wallet should recover its linked human avatar instead of creating duplicate people when local browser storage is lost.
- The generated avatar starts in The Cosy Cottage.
- Client-authored chat is unavailable; after avatar creation, `Chat` asks the server to author the avatar's line.
- After creation, the primary action becomes "Chat" unless the room has a higher-priority contextual action.
- Returning players skip creation and arrive as their existing avatar.

Avatar generation should be lightweight in the first slice. The goal is embodiment before chat, not a deep character creator.

## First Location

### The Cosy Cottage

Canonical room facts:

- Firelit cottage.
- Rain-soft windows.
- Shelves of storybooks.
- Hearth with warm stones.
- Kettle near singing.
- Blue scarf on Rati's needles.
- Low doorway waiting for future paths.
- No open exits at launch.

The cottage is a place, a channel, and a state container. Its facts are engine-owned. Characters may interpret them, but they may not contradict them.

## Resident Contracts

### Rati

Rati is the primary host of The Cosy Cottage.

Requirements:

- Speaks in first person.
- Warm, observant, gently storylike.
- Fond of knitting scarves and telling stories.
- Keeps replies short by default, ideally under 45 words.
- Welcomes travelers and asks for one more detail when a player is vague.
- Never speaks for Whiskerwind or Skull.
- Does not reveal system, model, prompt, or tool details.

### Whiskerwind

Whiskerwind is a symbolic resident.

Requirements:

- Emoji only.
- No words, letters, punctuation-heavy prose, markdown, or explanation.
- Normally 3 to 6 emoji.
- Reacts symbolically to player intent, room state, weather, doors, stories, danger, tea, and movement.
- Should be selected sparingly so the emoji language remains charming rather than noisy.

### Skull

Skull is the silent wolf.

Requirements:

- Never speaks quoted dialogue.
- Uses third-person emotes only.
- Communicates through posture, attention, protection, movement, and silence.
- Watches the doorway and protects the hearth.
- No inner monologue.
- No gore escalation.

## Core User Experience

### Resting State

The resting UI shows:

- The current location name.
- The shared room timeline.
- Subtle resident presence.
- One primary action surface.

The resting UI does not show:

- A permanent send button.
- A permanent refresh button.
- A permanent name input.
- A permanent locations sidebar in the one-location release.
- Multiple competing primary actions.

Primary action labels by state:

- `Create Avatar` before the human has a generated avatar.
- `Chat` during normal room exploration.
- `Give Item` when the player can satisfy an avatar evolution or quest request.
- `Travel` when a valid exit or movement target is selected.
- `Attack`, `Defend`, or `Flee` when the current location explicitly allows combat.
- `Continue` when the room is resolving an event or reveal.

### Chat Flow

1. User lands at The Cosy Cottage threshold.
2. The room shows enough presence to make the world feel alive.
3. User presses "Create Avatar".
4. The system generates the user's human avatar and places them in The Cosy Cottage.
5. The primary action becomes "Chat".
6. User focuses a resident, item, exit, or the room itself through the compact world chips.
7. User presses the one primary command.
8. If the command is `Chat`, the server authors one in-character line for the player's avatar. The human operator never types or selects dialogue text.
9. The avatar line is committed as a shared room event.
10. The system selects zero or one primary resident response and commits it as another shared room event.
11. A small chime, emote, item reveal, movement event, or contextual command may appear only when strongly triggered.

The visible resting action returns to "Chat".

### Primary Action Surface

The one-button rule becomes a stronger product rule: there is one primary action surface in the default room view.

In normal play, the primary action is `Chat`. In gated or contextual states, the same surface changes label and behavior. This keeps the Ruby High clarity while allowing CosyWorld to support avatar creation, item handoff, travel, listening, and explicit combat-room actions.

Allowed exceptions:

- A secondary command may appear only for a temporary two-option future scene. It is not part of the current MVP path.
- Browser-native keyboard activation of the focused command.
- Hidden accessibility controls when they are not visually competing primary actions.
- Future drawers or menus only after the one-room product proves the core loop.

Ruby High's relevant lesson is not its full school UI. It is the stateful single bottom action that hides when another input owns the turn.

### Future Branching Dialogue

Branching dialogue is not in the current MVP. If it returns, it should support world choices rather than quiz questions or typed human dialogue.

Future requirements:

- Branches are authored or generated as in-world choices, not tests with right answers.
- A branch can be opened by an NPC request, a discovered item, a room event, or an exit.
- Branch options should be short, diegetic, and limited, usually 2 to 4 options.
- The player still does not type dialogue. Branch choices are command options only.
- Branches can reveal item hints, unlock room facts, change relationship state, invite travel, or request an item.
- Branches should expire or resolve cleanly so stale options do not remain active.

Example branch:

```text
Rati looks up from the blue scarf. "If you are going toward the low doorway, choose what you carry with you."

Options:
- Ask Rati for a story about the doorway.
- Offer to find warmer yarn.
- Sit with Skull and listen.
```

When a future branch is pending, the primary action may temporarily expose one or two diegetic command choices. The choices are not persistent navigation chrome.

### Items and Evolution

Items are scattered around the shared world and can be discovered, held, traded, given, or used in branches.

Avatar evolution is item-based:

- Level 2 requires two unique required items.
- Higher levels require additional unique items according to the avatar's evolution track.
- Items should be meaningful to the avatar, not generic currency.
- An item instance can only satisfy one evolution requirement unless explicitly marked reusable.
- Evolution is a world event that can change an avatar's appearance, status, abilities, relationship branches, movement preferences, or dialogue range.
- Evolution should feel like helping a resident become more themselves, not filling a progress bar.

Starter examples:

- Rati might need `moonwool` and `story-button` to evolve her storytelling scarf craft.
- Whiskerwind might need `silver-bell` and `weather-glass` to expand symbolic reactions.
- Skull might need `hearthstone-tag` and `old-collar-charm` to unlock a protective path.

The exact item names can change, but each avatar should have a designed item track.

### Stats and D&D-Inspired Play

CosyWorld 2.0 should have a rules layer under the cozy room fiction. Every avatar, including generated human avatars and NPC residents, has a small stat block inspired by tabletop fantasy games:

- Strength.
- Dexterity.
- Constitution.
- Intelligence.
- Wisdom.
- Charisma.
- Base HP.
- Current conditions.
- Active modifiers.

The product is not trying to implement all of D&D. It should implement a compact CosyWorld ruleset that feels legible to D&D players: ability modifiers, d20 checks, initiative, armor class, hit points, conditions, items, and turn order.

Requirements:

- Stats are generated or assigned before an avatar can perform stat-based actions.
- Ability checks should be auditable as room events when visible to players.
- A stat check should never be hidden inside an AI paragraph if it changes shared world state.
- Base stats are stable. Damage, healing, buffs, debuffs, defending, hidden state, and cooldowns are modifiers or conditions.
- Items and evolution can change an avatar's abilities, contextual actions, or stat modifiers.
- Human-facing UI should surface stats only when relevant; the room should not turn into a character-sheet dashboard.
- The one primary action surface still holds. In combat or a special scene it can become `Attack`, `Defend`, `Flee`, `Use`, or `Continue`.

Starter action set:

- `Chat`: ask the server to author the player's avatar line in the room.
- `Use`: apply a held item such as a potion, charm, key, tool, or evolution item.
- `Challenge`: invite a structured contest or duel when the location allows it.
- `Attack`: make a d20 attack roll against armor class.
- `Defend`: gain a short defensive modifier.
- `Hide`: make a Dexterity check to gain advantage or avoid attention.
- `Flee`: make a check to leave an encounter.

The Cosy Cottage should remain safe by default. Combat and danger must be explicitly entered through a branch, challenge, event, or future location rule. Skull can be protective without forcing combat into the cottage's normal loop.

Ruby High's quiz questions should become CosyWorld's encounter decisions. The player should never see `A/B/C/D` answers or a typed answer box. In an encounter, the compact focus rail can show `Attack`, `Defend`, `Flee`, and `Use`; focusing one changes the single primary command to that action. If a target or item choice is needed, it appears as a temporary action sheet and then collapses back to the one-button rest state.

Combat is the primary Orb faucet:

- Small safe actions such as `Listen` or `Notice` can award 1 Orb on a cooldown.
- Completing a challenge or sparring encounter can award 1 to 3 Orbs.
- Winning or peacefully resolving a dangerous encounter can award 2 to 5 Orbs.
- Fleeing usually awards nothing, or a small survival reward when the encounter was meaningfully risky.
- All rewards come from committed kernel events, not from AI narration.

### Autonomous Avatars

Resident avatars are not static chat responders.

Requirements:

- NPCs can move between unlocked locations.
- NPCs can idle, react, search for items, remember events, and pursue evolution-related needs.
- NPC autonomous actions emit room events in the shared global world.
- Autonomous actions should be rate-limited and legible.
- NPCs should not steal agency from humans by resolving major branches instantly without a chance for player involvement.
- If an NPC moves away, the room should show that absence instead of pretending they are still available.

### Movement

Movement is part of the world model, not plain chat decoration.

For the first release:

- The player and all starter NPCs begin in The Cosy Cottage.
- The low doorway is visible but not open.
- Attempts to leave should create a room event explaining that other paths have not opened yet.
- Failed movement becomes recent room context so residents can react without inventing a new location.

Future movement:

- Exits belong to locations.
- Moving emits departure and arrival room events.
- A room's visible history follows the current location.
- Avatars can move independently between channels.

## Turn Feel

The opening beat may include all three residents so the cast is established.

Normal turns should be quieter:

- Direct mention of Rati, Whiskerwind, or Skull should bias toward that resident.
- Ordinary room speech should produce zero or one resident reply.
- Ambient ticks should be sparse and should not interrupt active conversation.
- Chimes should add texture, not pile on.

The goal is a room with presence, not a chorus answering every line.

## Information Architecture

### Visible IA

For the first release:

- One room.
- One timeline.
- One primary action surface.

### Hidden/System IA

The system still models:

- World.
- Location.
- Channel.
- Resident.
- Player.
- Human avatar.
- Message.
- Room event.
- Movement.
- Memory.
- Exit.
- Item.
- Inventory.
- Branch.
- Evolution.

These concepts power the world. They should not all become chrome.

## Visual Direction

The UI should feel like a place first.

Desktop:

- Full-viewport room presentation.
- Timeline centered over or alongside atmospheric location art.
- Resident presence as compact chips or subtle portrait stack.
- No dashboard sidebars in the default view.

Mobile:

- One vertical timeline.
- Compact sticky location header.
- Bottom sticky primary action.
- Composer as a bottom sheet or focused inline input.
- Resident presence as a compact strip or inline room event.

The first viewport should immediately communicate "The Cosy Cottage", not "CosyWorld admin".

## Accessibility

Requirements:

- New messages use an `aria-live` region.
- The primary action has a stable accessible name that reflects its current state.
- Focus moves predictably between the timeline, world chips, and the primary command.
- Keyboard users can create an avatar, focus world chips, activate Chat, travel, give items, listen, and use explicit combat commands without typing chat text.
- Any future text input must avoid iOS zoom by using at least 16px input text, but the current MVP has no chat composer.
- Reduced-motion users do not receive animated ambient effects.
- Background imagery has sufficient contrast overlays for readable chat.
- Emoji-only output from Whiskerwind includes accessible labeling at the message level, while preserving the visible emoji-only contract.

## Content Safety

CosyWorld should remain cozy, bounded, and non-explicit.

Requirements:

- No sexual content.
- No harassment or hateful conduct.
- No graphic gore.
- No escalation from cozy fantasy into horror unless a future location explicitly supports a darker tone.
- NPCs can set boundaries in voice.
- Engine-owned facts override character improvisation.
- NPCs should not mention AI, prompts, models, policies, tools, or system internals.

## Product Requirements

### P0

- The root experience opens directly into The Cosy Cottage.
- A human must generate an avatar before they can chat.
- The resting UI has exactly one primary action surface.
- The primary action is `Create Avatar` before avatar creation and `Chat` during normal room play.
- The channel timeline renders location, player, resident, emote, and system messages.
- The opening beat introduces The Cosy Cottage, Rati, Whiskerwind, and Skull.
- Posting a message persists it to shared room history.
- A response-selection policy prevents all residents from replying every turn.
- Whiskerwind output is emoji-only.
- Skull output is emote-only.
- Failed movement to unopened paths is represented as a room event.
- The world state is global and shared for room history, NPC positions, and item discoveries.
- Avatar stats exist before stat-based actions occur, and visible checks are logged as world events.

### P1

- Room updates stream in real time.
- Reloading the page preserves recent room history.
- Avatar positions are persisted.
- The player's generated avatar and inventory persist.
- Orbs are visible as a compact account resource and spent only by server-committed actions.
- A connected OpenRouter account makes Chat cost zero Orbs while preserving shared public room output.
- At least one non-typed challenge or listen action can award Orbs.
- Idle room events appear only after quiet periods.
- Direct mentions bias response selection.
- The UI supports mobile and desktop with the same primary action surface rule.
- Future branching dialogue can present temporary command options, but it is outside the current MVP path.
- Items can be discovered and held.
- Level 2 evolution requirements are modeled as two unique items per avatar.
- Avatars have generated or seeded stat blocks.
- The rules layer can resolve at least non-combat ability checks and item use.
- Wallet-owned Boxes can be recognized in account state, even before the full burn/open UX ships.

### P2

- Add more locations and exits.
- Add room summaries and long-term location memory.
- Add world-designer seed tooling; the MVP seed manifest should remain data-backed even before a full editor exists.
- Add moderated public/private room modes.
- Add autonomous NPC item-seeking and evolution behavior.
- Add higher-level evolution tracks beyond level 2.
- Add turn-based encounter support: challenge, initiative, attack, defend, hide, flee, use item, knockout, and recovery.
- Add OpenRouter account connection and key verification for player-paid Chat/media.
- Add verified Box burn, avatar pack reveal, and card grants with Ruby High-style provenance.

## Success Metrics

- First interaction rate: percentage of visitors who press the primary action.
- Avatar creation completion rate.
- First message completion rate.
- Return rate to The Cosy Cottage.
- Average turns per session.
- Percentage of turns with more than one NPC reply; target should stay low.
- Constraint pass rate for Whiskerwind emoji-only and Skull emote-only.
- Branch resolution rate.
- Item discovery rate.
- Evolution completion rate.
- Reload continuity success rate.
- User-reported sense of place.

## Risks

- UI creep could reintroduce dashboard controls and break the primary-action promise.
- Contextual actions could become confusing if the primary action label changes without clear room context.
- In-memory state would make the room feel fake after reloads or deploys.
- Synchronous AI responses could make Chat feel slow.
- Too many NPC replies could make the room noisy.
- Discord-specific backend assumptions could block a clean web-native channel model.
- Prompt drift could cause stale movement or old directives to be treated as current facts.
- A single shared global world needs moderation, protected audit access, actor suspension, and rate limits before broad public traffic.
- Autonomous avatars could make meaningful changes while players are away; the timeline must explain what happened.
- Item evolution could become grindy if requirements are generic rather than story-specific.
- Future monetization or wallet features could overwhelm the core room experience if placed in the main surface.
- If Orbs are treated like USDC payments, the game loop will become brittle and expensive to reason about.
- If Box burns are not idempotent, irreversible NFT actions could duplicate or lose card grants.

## Acceptance Criteria

- A new user can open the app, understand they are at The Cosy Cottage, and see one primary action labeled "Create Avatar".
- The user cannot chat until avatar creation succeeds.
- After avatar creation, the primary action becomes "Chat" during normal play.
- Chat is available through either a connected player OpenRouter payer or server-paid Orbs.
- Pressing "Chat" commits one server-authored in-character line for the player's avatar.
- Humans do not type, submit, or choose dialogue text in the MVP.
- The avatar line is added to the shared room timeline.
- At most one primary resident responds to a normal message.
- Rati, Whiskerwind, and Skull each obey their speech contracts.
- Reloading preserves the recent shared room history.
- The low doorway cannot become an open exit unless the engine state changes.
- The first release works on mobile without exposing sidebars as primary navigation.
- Item discoveries and avatar evolution requirements are represented as world state, not local-only UI state.
- The economy design preserves one shared world: cards influence shared rooms and residents, never private NPC DMs.
- Combat/challenge earning uses `Attack`, `Defend`, `Flee`, and `Use` style actions instead of quiz answers.
