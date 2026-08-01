::: {.chapter}

# Part III: Running a Scene {#part-running-scenes}

## 10. Read the Scene Through Actions {#read-scene}

A scene is the meeting point of a location, the people and objects present,
the active rules profile, the avatar's cards, and the world's remembered
state. The scene does not grant ownership. It makes existing things relevant.

The server composes one finite deck of legal action offers. The ordinary
interface shows exactly **two cards**. A player may commit one or use certified
**Think** (called **Pass** in a focused turn): it yields the turn and deals the
next two cards.

::: {.rule}
**CORE RULE - The current hand is the playable limit.** Search, Travel, Help,
items, and combat choices must be in the current pair. Certified Think/Pass
cycles toward other legal cards; prose commands cannot bypass the hand.
:::

An offer should answer five questions before commitment:

1. What will I do?
2. What is my exact target?
3. What must I have or be able to do?
4. What will it cost?
5. What important risk or consequence is attached?

"Search" is too broad when several subjects are unresolved. "Search the ash
beneath the stove" is an offer. "Use" is too broad when several objects and
mechanisms are present. "Use the brass key on the pantry door" is an offer.

The action hand is not the carried deck. An item card records an actual item,
its possession, condition, and provenance. An action card is a temporary
offer. A carried lantern may produce **Raise the lantern toward the scratched
arch**. Choosing the action does not create another lantern, and entering the
room does not grant ownership of the arch.

### Presenting a scene {#present-scene}

Present information in this order:

1. **Place:** where the avatar is and whether it is safe, exposed, or
   immediately dangerous.
2. **Obvious truth:** visible people, open routes, loose items, threats, and
   sensory Signs.
3. **Shared questions:** up to three pressing situations.
4. **Suggested actions:** the two current offers.
5. **Choice access:** certified Think/Pass, which yields the turn and deals two cards.
6. **Commitment detail:** target, cost, likely effect, and named risk.

Do not begin with hidden lore, internal state names, or a list of every rule.
The player first understands a place.

::: {.example}
**Example - Rain-Soft Garden**

Rain beads on broad leaves. A narrow print crosses the mud beneath the old
wall, and the eastern path is open. Rowan ties canvas over a cracked cold
frame.

The two cards are **Follow the small print** and **Help Rowan cover the cold
frame**. Travel, Study, and Take remain elsewhere in the deck. Rowan can play
one current card or Think/Pass and yield the turn. Moderated `say` and `/me`
remain turn-exempt room speech; they do not replace a card mutation.

Before the print action is confirmed, its detail says: target, the print
beneath the wall; cost, one turn; risk, rain may blur the trail; likely
result, learn where it leads.
:::

If free-form intent matches an existing offer, map it to that offer. If no
offer matches, explain the blocking fact or the change required. Persuasive
wording never creates permission.

Recompose after movement, transfer, equipment or exhaustion changes, actor
arrival or departure, relevant clock changes, or changed access. Reject a
stale offer without spending a turn, then show the new scene.

## 11. Played Time and Other Players {#played-time-concurrency}

A committed gameplay action normally consumes a turn. Travel, Search, Study,
Use, Help, Rest, conflict actions, and Think/Pass are examples. Reading the scene,
examining a card, and opening menus are turn-exempt.

CosyWorld uses the lightest concurrency policy that preserves a clear result.

| Policy            | Use                                                                     | Resolution                                                                   |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Concurrent        | Speech, observation, independent movement, exploration, compatible work | Commit in canonical journal order without room-wide waiting                  |
| Target-serialized | Same item, claim, container, lock, or scarce slot                       | One valid write wins; stale attempts recompose without duplicate effect      |
| Scene-turn        | Combat or another procedure explicitly authored as ordered              | Only the named participant commits a mechanical turn                         |
| Governed choice   | Lasting communal decisions                                              | A named chooser, vote, delegation, Covenant rule, or authored policy decides |

Concurrent does not mean unprotected. Every mutation still passes possession,
capacity, access, world-lock, and stale-offer checks.

If two avatars Take the same silver button, both may attempt without waiting
for a room queue. The journal accepts one first. The other learns that the
button is gone. No duplicate is created, and the losing attempt does not
secretly become another action.

### Ordered scenes {#ordered-scenes}

Combat and other explicitly authored ordered procedures name the current
participant. Speech and read-only inspection remain available.

The current participant may **Pass** or ask for more time. Passing is a
committed choice. More time is nonpunitive coordination and does not advance
world time. A visible countdown can help people coordinate, but its expiry is
not a world event. It cannot spring a trap or move a pursuer.

A **watch** is an authoring scale for a camp, long search, night crossing, or
patrol cycle. It is not a wall-clock interval. If a procedure consumes a
watch, name who commits, what occurs, which clocks can move, which event is
tested, and whether anyone may withdraw.

## 12. Safe Actions, Checks, and Consequences {#checks-consequences}

The first question is not "What is the difficulty?" It is "Why would this
need a roll?"

Use this procedure:

1. Name the intent, method, and exact target.
2. Decide whether the method can accomplish the intent.
3. Identify current danger, opposition, or costly uncertainty.
4. If none exists, resolve certainly.
5. If danger exists, state what the check avoids and what each outcome means.
6. Commit only after the player can understand the stakes.

The engine uses Strength, Dexterity, Constitution, Intelligence, Wisdom, and
Charisma. Player surfaces group them as Body, Grace, Mind, and Heart; Wisdom
contributes to Mind and Heart through a fixed engine mapping. The server
supplies rolls, modifiers, Advantage or Disadvantage, and the result. Clients
and narration cannot grant bonuses.

Risk describes what is endangered. Effect describes what success can
accomplish.

| Risk  | Meaning                                      |
| ----- | -------------------------------------------- |
| Safe  | No harmful consequence contests the action   |
| Risky | A meaningful consequence may follow          |
| Dire  | The consequence is severe or hard to reverse |

| Effect   | Meaning                                     |
| -------- | ------------------------------------------- |
| Limited  | Helps but cannot settle the whole objective |
| Standard | Achieves the expected result                |
| Great    | Has unusual reach or leverage               |

Labels are summaries, not substitutes for concrete stakes. Prefer: "You can
pry the swollen door open. The noise may advance the patrol, and the frame
will no longer relock."

### Consequence-first resolution {#consequence-first}

::: {.rule}
**CORE RULE - Consequence-first discovery.** In
`discovery-procedure-v2`, safe Focused Notice and Search resolve their frozen
truth without an ability roll. Under Pressure, the check determines only
whether the already-frozen named consequence is avoided. Legacy records keep
their historical meanings; bind new authored discovery to the versioned
procedure.
:::

| Situation                         | Certain truth                    | Possible pressure                                  |
| --------------------------------- | -------------------------------- | -------------------------------------------------- |
| Exact key in a simple lock        | It opens                         | None unless a separate hazard exists               |
| Lockpicks with quiet time         | It opens after the stated turn   | None                                               |
| Lockpicks as a patrol approaches  | The lock is resolved             | Delay, noise, tool wear, or patrol progress        |
| Search a stocked safe cupboard    | Its fixed result is resolved     | None                                               |
| Search while smoke fills the room | Its fixed result is resolved     | Tired, strain, harm, lost time, or fire progress   |
| Force a brittle door              | It breaks if the material allows | Noise, evidence, damage, or loss of a return route |

Put drama in the actual pressure, not in an arbitrary roll against certainty.

Read-only examination is free. Under the versioned discovery procedure,
Focused Notice, Search, and Study use their declared costs; forcing,
disarming, opening, taking, and crossing remain separate authored actions. If
a Sign is needed to understand danger, show it for free. If the player wants
hidden mechanism, exact provenance, exhaustive certainty, or a safer method,
offer a focused action.

## 13. Clocks as Shared Questions {#clocks}

A clock records an unresolved question changed through play. It is not a timer
or a substitute for authoring a situation.

Prefer: **Can the travelers brace the bridge before the flood reaches it?**

Avoid: **Bridge task: 2 of 6.**

The exact segments still exist. Presentation explains the present situation,
stakes, possible approaches, and latest meaningful change.

Use clocks for multi-beat progress, danger, relationships, projects,
exploration, or broad frontier change. Every tick needs a causal committed
event. Sanctuary clocks move only from chosen relevant work. Frontier danger
can react to relevant frontier turns, but it remains local to that situation.

For each promoted clock, show:

- the question and present situation;
- what is at stake;
- the next legible threshold;
- legal approaches and targets;
- recent meaningful contributors; and
- a completion memory once settled.

A place may have many questions but should promote no more than three at once.
Do not expose internal mutation copy.

Do not give every door, drawer, or conversation a clock. A simple lock with a
valid method is one action.

::: {.target}
**ACCEPTED TARGET - Bounded Pressure.** Use paired progress and danger clocks
when a situation genuinely has several beats, such as a chase, opening a vault
under pursuit, following a trail in rain, or holding a passage during a flood.
Author outcomes for progress first, danger first, simultaneous completion, and
voluntary withdrawal.
:::
:::
