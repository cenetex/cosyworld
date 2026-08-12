# CosyWorld:Dungeons - The Situation Board Motif

- **Status:** Proposed product and authoring motif
- **Issue:** [#742](https://github.com/cenetex/cosyworld/issues/742)
- **Authority:** This document applies existing CosyWorld product law to a
  spatial presentation. It does not authorize an implementation by itself.

## The Idea In One Sentence

**The board shows what is true; the hand asks what you will do about it; the
kernel resolves the choice; the Journal remembers the difference.**

`CosyWorld:Dungeons` names a card-driven narrative board-game motif for
frontier places. It makes rooms, routes, people, items, obstacles, and pressure
spatially legible while preserving the authoritative two-card hand as the only
ordinary action surface.

It is not:

- a second rules engine;
- a free-movement miniature game;
- a promise of complete Dungeons & Dragons or SRD compatibility;
- a client-authored map editor;
- an AI-generated source of topology, legality, or outcomes; or
- a combat-only mode.

The [CosyWorld Pact](cosyworld-pact.md),
[authoritative action-hand decision](decisions/0002-action-hand-is-authoritative-state.md),
[action system](systems/04-action-system.md), and
[threshold and discovery decision](decisions/0005-thresholds-trails-and-strict-referee.md)
remain authoritative. This document gives those contracts a board-game
expression; it does not replace them.

A flooded tollhouse, night market, tangled archive, storm-locked observatory,
pilgrimage road, or dark labyrinth can all use the motif. A dungeon is a
compact situation under pressure, not an architectural style.

## The Experience Promise

A successful CosyWorld:Dungeons scene gives a traveler four things at once:

1. **Orientation.** They can see where they are, what connects, what is
   nearby, and why a route is blocked.
2. **A consequential fork.** The two dealt cards point to different possible
   changes in the visible situation.
3. **A truthful resolution.** The kernel applies one exact offer; text and art
   express that result without inventing it.
4. **A remembered difference.** The board, world, relationship, or Journal is
   observably different after the action.

The isometric treatment is useful because it gives the shared state a
recognizable surface. It is not the source of the state. If every image fails,
the semantic board and exact cards remain fully playable through text and API.

## One Rules Substrate, Four Roles

| Part        | Responsibility                                              |
| ----------- | ----------------------------------------------------------- |
| **Board**   | Shared, currently perceivable situation truth               |
| **Hand**    | The actor's two exact, presently playable intentions        |
| **Kernel**  | Legality, costs, checks, mutations, concurrency, and replay |
| **Journal** | Durable deeds, relationships, discoveries, and open threads |

AI may narrate a certified situation, speak for an authorized resident, or
illustrate a frozen scene. It never chooses the board graph, deals a more
favourable hand, moves a token, opens a route, changes odds, or decides an
outcome.

This motif therefore extends the existing action system by projection. It does
not create board-only controls around the hand.

## Board Grammar

The board uses a small semantic vocabulary:

| Noun             | Meaning                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Site**         | A meaningful place where an actor, item, or event can be situated                  |
| **Link**         | A traversable or otherwise meaningful relation between sites                       |
| **Token**        | A visible actor, item, feature, Sign, or persistent consequence                    |
| **Constraint**   | The exact reason a link or board relation cannot currently be used                 |
| **Clock**        | Visible pressure whose thresholds change the situation                             |
| **Memory mark**  | A durable public difference associated with a site or subject                      |
| **Unknown edge** | Evidence that a bounded route may be discovered, without revealing its destination |

The engine owns these facts. The renderer chooses isometric coordinates,
textures, lighting, and animation for them.

### Semantic spaces, not centimetres

Authoritative position should normally name a meaningful site or relation:

```text
actor Percy occupies site:flooded-barrow-west-bank
actor Moth-Eaten-Knight constrains link:barrow-causeway
item Golden-Oil-Slick occupies site:barrow-causeway
link:barrow-causeway leads to site:north-tower-gate
```

The renderer may place those subjects at `[2, 1]`, `[3, 2]`, or any accessible
equivalent layout. Coordinates are presentation until a versioned rules
profile explicitly gives them mechanical meaning.

This keeps the board legible to browser players, terminal players, screen
readers, and inference-controlled avatars without prematurely committing the
game to collision, facing, line-of-sight, or per-square movement rules.

### Two board scales

`CosyWorld:Dungeons` supports two related projections:

1. **World board.** Known locations, routes, gateways, Anchors, and remembered
   changes across a region or worldpack.
2. **Scene board.** The significant sites, links, tokens, constraints, and
   clocks in the current encounter.

The world board answers **where could this venture go?** The scene board
answers **what matters here, now?** A card may target either scale, but both
remain projections of the same canonical world.

## Companies, Delves, And Detachments

A dungeon does not create a party and is not a linear trail with indoor art.
Under [ADR 0009](decisions/0009-companies-ventures-formations-and-shared-travel.md),
a **Company** supplies durable social identity, a **Delve Venture** supplies the
shared purpose, and a **Delve Formation** supplies the current operating facts:
marching order, light, noise, carried supplies, cohesion, and retreat chain.

The Company may have arrived on foot, by carriage, or aboard a ship left at the
threshold. Changing Formation does not discard its membership, conversation,
or Venture history. A vehicle remains an independent world object and never
certifies who belongs to the delve.

Dungeon progress is knowledge and position, not a guessed completion
percentage. The party projection should answer:

- which semantic site each member occupies;
- which branches and constraints are known;
- what evidence advances the Venture objective;
- where the most recent refuge, Anchor, or entrance lies;
- whether the return chain is currently usable; and
- which members are together, separated, or out of contact.

A subset entering another site becomes a **detachment**, not a second copy of
the dungeon or an accidental loss of party state. It remains related to the
Company while receiving its own local board, transcript audience, and exact
action context. Rejoining, losing contact, rescue, retreat, and extraction are
authoritative events.

Company conversation is also distinct from local speech. The Venture chronicle
can persist across the delve, but separated members hear one another only when
their positions or an authored communication capability allow it. The board
must not imply remote contact merely because everyone remains in the same
Company.

## The Pair Is The Unit Of Choice

The existing action hand is exactly two server-authored offers plus certified
Think/Pass. CosyWorld:Dungeons treats those two cards as a designed **fork**,
not merely two neighbouring entries in a list.

A strong fork lets the traveler foresee two materially different situational
changes. The cards may differ by:

| Fork axis        | Example                                                         |
| ---------------- | --------------------------------------------------------------- |
| **Route**        | Cross the west bridge / climb toward the north gate             |
| **Method**       | Attack the Knight / use Dawn Oil on the slick                   |
| **Relationship** | Demand testimony / befriend the witness                         |
| **Tempo**        | Act before pressure advances / prepare a stronger slow response |
| **Information**  | Inspect the sealed arch / travel while uncertain                |
| **Resource**     | Spend the lamp oil / preserve it and accept darkness            |
| **Care**         | Pursue the thief / carry the injured resident to safety         |
| **Commitment**   | Make a reversible probe / accept a durable consequence          |

Two differently worded cards that predict the same meaningful state are not a
fork. Neither is a pair with an obvious best answer in every relevant state.

Every pair should satisfy these principles:

1. **Both cards are exact and legal.** Each is bound to its own current
   `offer_id`, target, state revision, and resolver.
2. **The divergence is perceivable.** The board highlights the relevant
   target or relation, and card detail names cost, known risk, and expected
   effect.
3. **The choice is honest, not complete.** Hidden discoveries remain hidden,
   but a known danger or irreversible commitment is disclosed.
4. **Leaving remains real.** Retreat, refusal, rescue, and return can be
   legitimate halves of a fork.
5. **One card resolves.** Selecting a card never smuggles in the other action
   or a client-selected bundle of mutations.

### A target pair-composition profile

The accepted runtime deterministically ranks legal offers and exposes the
current two-card hand. A future, separately versioned pair-composition profile
may improve that order without exposing the internal legal superset.

Each offer could declare or derive a visible change signature:

```text
change signature =
  position + relationship + inventory + constraint + pressure
  + information + quest state
```

A deterministic composer could then prefer pairs with high contextual
relevance and useful divergence while penalizing redundancy and unconditional
dominance:

```text
pair score =
  relevance(left) + relevance(right)
  + visible state divergence
  + authored thematic tension
  - redundancy
  - obvious dominance
```

Stable offer IDs, provider reasons, actor binding, scene binding, state
revision, hand generation, and replayable Think/Pass remain mandatory. Any
change from the current flat ranking to composed pairs requires an explicit
decision and compatibility plan; this motif does not silently amend ADR 0002.

## The Turn Loop

```text
Observe the shared board
        |
Receive two exact legal cards
        |
Choose left, choose right, or Think/Pass
        |
Kernel resolves one committed action or Pass
        |
Board, clocks, relationships, and legal offers recompose
        |
Meaningful durable change enters the Journal
```

Think/Pass remains a choice inside the world economy. It consumes the turn,
advances any applicable pressure, and exposes the next certified pair. It is
not a free search through every legal action.

### The unchosen card

The rejected card does not vanish by narrative fiat. After resolution, the
server recomposes from authoritative state:

- it may remain when its target and premise are unchanged;
- it may transform when the chosen action changed its subject;
- it may become unavailable because its requirement was spent or moved; or
- it may expire when an explicitly urgent opportunity passed.

For example, helping an injured resident may let a fleeing thief escape. The
card must disclose that urgency before commitment. Using Dawn Oil removes
later offers that require possessing the unspent oil. Attacking a resident may
temporarily replace a friendship approach with defence, withdrawal, or repair.

## Clocks Belong On The Board

A clock is most useful when thresholds alter visible state instead of merely
incrementing an isolated meter.

At the Flooded Barrow, a four-step pressure clock might mean:

| Threshold | Visible change                                                      |
| --------: | ------------------------------------------------------------------- |
|         1 | Moths gather around the drowned lamp                                |
|         2 | Water covers the west-bank foothold                                 |
|         3 | The safe retreat link becomes hazardous                             |
|         4 | The false reflection manifests and applies its authored consequence |

The clock may still be shown as a ring or track, but its meaning comes from
the board mutations attached to its thresholds.

Fatigue should likewise reshape possibility. Fresh actors may receive
decisive outward forks; tired actors may see cautious, risky, relational, or
resource-preserving alternatives; Spent actors receive the certified survival
hand. Recovery remains place- and equipment-dependent. Fatigue is not made
interesting by dealing a generic chore called Rest.

## Information Boundaries

The board is truthful without being omniscient.

### Public board state

- discovered sites and links;
- visible actors, items, features, and Signs;
- observable constraints and disabled reasons;
- public clocks and threshold effects;
- known risks and guaranteed immediate effects; and
- public memories tied to this place.

### Actor-specific state

- the actor's exact two-card hand and provider reasons;
- private inventory or permission facts where product law permits them;
- firsthand and secondhand belief distinctions; and
- actor-specific accessible descriptions of the same public board.

### Hidden authoritative state

- undiscovered destinations and latent topology;
- unused table rows and deterministic seeds;
- concealed contents, motives, and unrevealed Signs;
- the undealt legal-offer superset; and
- consequences whose concealment is itself authored and fair.

### Presentation-only state

- isometric coordinates and camera position;
- textures, lighting, particles, and decorative props;
- AI-generated flavour that cannot imply a new exit, subject, or rule; and
- animation used to explain an already committed mutation.

A client or model must not infer authority from presentation-only state. An
AI image that paints the wrong creature cannot move the actual hostile token
or conceal the actual blocked route.

## Proposed Projection Shape

The API should expose semantic spatial state beside the existing action hand,
not replace it. A target shape could be:

```json
{
  "venture": {
    "schema_version": 1,
    "venture_ref": "venture:flooded-barrow-delve",
    "kind": "delve",
    "company_ref": "company:lantern-bearers",
    "participant_refs": ["actor:percy", "actor:brindle"],
    "formation": {
      "kind": "delve",
      "cohesion": "together",
      "light_source_ref": "item:dawn-lantern"
    },
    "progress": {
      "profile": "delve",
      "current_site_ref": "site:west-bank",
      "known_branch_refs": ["link:barrow-causeway"],
      "retreat_site_ref": "site:saint-orras-ruin",
      "percent": null
    },
    "detachments": []
  },
  "scene_board": {
    "schema_version": 1,
    "scene_ref": "scene:flooded-barrow",
    "sites": [
      {
        "ref": "site:west-bank",
        "label": "West Bank",
        "presentation_pos": [1, 1]
      },
      {
        "ref": "site:lantern-gate",
        "label": "Lantern Tower Gate",
        "presentation_pos": [4, 1]
      }
    ],
    "links": [
      {
        "ref": "link:barrow-causeway",
        "from": "site:west-bank",
        "to": "site:lantern-gate",
        "accessible": false,
        "constrained_by": ["constraint:moth-knight"]
      }
    ],
    "tokens": [
      {
        "ref": "actor:moth-eaten-knight",
        "site": "site:barrow-causeway",
        "disposition": "hostile"
      }
    ],
    "constraints": [
      {
        "ref": "constraint:moth-knight",
        "label": "The Knight blocks the causeway",
        "subject": "actor:moth-eaten-knight",
        "link": "link:barrow-causeway"
      }
    ]
  },
  "action_offers": [
    {
      "offer_id": "offer:percy:use:dawn-oil",
      "label": "Use Dawn Oil on the slick",
      "target_refs": ["item:golden-oil-slick", "constraint:moth-knight"]
    },
    {
      "offer_id": "offer:percy:attack:moth-knight",
      "label": "Attack the Moth-Eaten Knight",
      "target_refs": ["actor:moth-eaten-knight"]
    }
  ]
}
```

`presentation_pos` is a layout hint, not a rules coordinate. `target_refs`
must name only currently perceivable projected subjects. The existing offer
envelope remains the authority for target, cost, risk, expected effect,
resolver, and state revision. The Venture block is likewise a projection of
authoritative membership, Formation, site occupancy, and discovered topology;
the client cannot populate it from the room roster. `percent` is deliberately
null for a Delve because the remaining site graph is not known.

## Reference Encounter: Flooded Barrow

The scene begins with this semantic topology:

```text
[Saint Orra's Ruin] -- [West Bank] --X-- [Lantern Tower Gate]
                                      |
                              Golden Oil Slick

X = Moth-Eaten Knight constrains the causeway
```

An ordinary pair might be:

- **Flee west** - move toward Saint Orra's Ruin; pressure advances.
- **Attack the Moth-Eaten Knight** - enter combat; the causeway remains
  constrained until the encounter changes.

A later pair made possible by inventory and position might be:

- **Use Dawn Oil on the Golden Oil Slick** - spend or transform the oil;
  dispel the false reflections and remove the visible constraint.
- **Defend at the west bank** - preserve position and accept the next pressure
  beat.

After Dawn Oil resolves, the board changes before new prose is generated:

- the causeway constraint is removed;
- the north link becomes accessible;
- the Knight's disposition changes from hostile to yielding;
- travel toward the Lantern Tower becomes eligible; and
- relationship offers may enter later hands.

The redemption arc is therefore a rules result that narration can honour, not
a flattering interpretation pasted over unchanged combat state.

## Authoring A CosyWorld:Dungeons Scene

Start with the situation, not the artwork.

1. Name the venture's relationship to a Hearth.
2. Draw three to seven significant sites and their links.
3. Mark what exists, what is perceived, what is accessible, and what is safe
   as separate facts.
4. Place at least one active force, useful object, or resident with a need.
5. Give the scene a Gate or constraint with more than one honest method.
6. Telegraph Hazards and declare applicable Pressure thresholds.
7. Author at least one useful retreat, pause, rescue, or return path.
8. Identify candidate fork axes rather than isolated action labels.
9. Declare what each card can visibly change and what remains hidden.
10. State which board differences persist after departure and which can settle
    into the Journal on Return.

Useful authoring questions include:

- Do the two cards point at different subjects or different futures for the
  same subject?
- Can a traveler explain why each highlighted target matters?
- Does the board change after either choice?
- Is the less violent, less efficient, or more caring choice mechanically
  real?
- Can pressure create a new situation without deleting the recovery route?
- Can another traveler arrive later and observe what changed?

## Accessibility And Transport Parity

The situation board must never become a sighted-browser-only action surface.

- Every site, link, token, constraint, clock, and target has a stable semantic
  reference and concise accessible label.
- Reading order follows situation importance, not arbitrary SVG paint order.
- Colour is reinforced by shape, line style, text, and state words.
- The two cards name their highlighted subjects; focus moves between a card
  and its board targets without changing state.
- Terminal and API clients receive the same perceivable semantic graph.
- A textual summary can answer: where am I, what is here, what connects, what
  is blocked, why is it blocked, what is changing, and what do my cards target?

## Delivery Sequence

This motif should land through narrow, independently playable slices:

1. **Situation projection.** Render one authored scene from semantic sites,
   links, tokens, constraints, and exact card targets. Keep movement at the
   existing Travel/Scout level.
2. **Board mutations.** Make resolved actions visibly move or transform tokens,
   links, constraints, and clocks.
3. **Fork metadata and instrumentation.** Classify route, method, relationship,
   tempo, information, resource, care, and commitment differences without yet
   changing hand order.
4. **Versioned pair composition experiment.** Compare the existing flat order
   with deterministic fork-aware pairs under an explicit playtest profile.
5. **World board and memory marks.** Project known topology and durable local
   consequences beyond the current room.
6. **Companies and Delves.** Bind authoritative Venture participants,
   detachments, Formation, local transcript scope, and retreat chains to the
   semantic site graph; do not infer the party from co-presence.
7. **Cross-door joins.** Show declared shared routes and transfer gates across
   worldpacks without suggesting that every mounted pack is physically
   connected.

Do not begin with free grid movement, procedural AI maps, per-square combat,
or generated textures. The first proof is that a card changes a shared board
in a way that makes the next choice more meaningful.

## Playtest Questions

Compare text-only and situation-board presentations of the same authoritative
scene. Measure whether players can correctly answer:

- where their avatar is;
- which route is blocked and by what;
- what each card targets;
- what known cost or risk distinguishes the pair;
- what visibly changed after resolution; and
- how to retreat or return.

Track Think/Pass frequency, stale-offer rejection, invalid submission,
decision time, target comprehension, route recall, and card selection. A
roughly even split is not automatically good, because context and character
intent should matter. Repeated unconditional dominance by one card in
comparable states is evidence that the pair is not doing useful design work.

The qualitative test is sharper: ask the traveler to describe the choice they
made. If they can name only two button labels, the fork was cosmetic. If they
can explain the different futures they weighed, the situation board is
working.

## Design Basis

This motif adapts several established ideas without copying any one game's
rules:

- Hunicke, LeBlanc, and Zubek's
  [MDA framework](https://www.cs.northwestern.edu/~hunicke/MDA.pdf) separates
  mechanics, runtime dynamics, and desired experience. CosyWorld:Dungeons uses
  that separation to keep the rendered board subordinate to authoritative
  behaviour.
- Cardona-Rivera et al.'s
  [Foreseeing Meaningful Choices](https://ojs.aaai.org/index.php/AIIDE/article/view/12716)
  found stronger reported agency when players could foresee choices leading
  to meaningfully different situational content. That finding motivates
  pair-level divergence.
- [Gloomhaven](https://cephalofair.com/pages/gloomhaven) demonstrates how a
  constrained hand can make action selection, timing, and endurance part of
  the same decision.
- [Arkham Horror: The Card Game](https://www.fantasyflightgames.com/en/products/arkham-horror-the-card-game/)
  demonstrates the value of explicit connected-location topology under
  simultaneous enemy, clue, and survival pressure.
- [Spirit Island](https://shop.greaterthangames.com/products/spirit-island)
  demonstrates how fast and slow effects make timing a visible choice axis.
- [Sleeping Gods](https://www.redravengames.com/sleeping-gods/) demonstrates
  how a connected atlas and persistent story consequences can reinforce each
  other across a campaign.
- [The 7th Continent](https://7thcontinent.seriouspoulp.com/en/resources/downloads)
  demonstrates bounded spatial discovery through cards and the productive
  coupling of action supply with endurance.
- [Pandemic](https://www.zmangames.com/game/pandemic/) demonstrates how a
  shared route map and escalating pressure make local actions compete for
  attention.

The distinct CosyWorld contribution is the authority seam: the same semantic
board and exact two-card hand must remain truthful across browser, terminal,
API, replay, and direct or inference control, while AI remains a voice rather
than a referee.
