# Shared actor action surface

CosyWorld composes one scene-local legal action surface for every active
avatar. `kind` is retained only as content provenance and snapshot
compatibility; it does not create a player/NPC mechanics boundary.

Every avatar with the same facets in the same scene receives the same candidate
verbs and targets. `control_mode` decides which intelligence chooses from that
surface:

- `direct_input`: a person selects one of the two current certified cards or Think/Pass;
- `reactive_ai`, `local_ai`, `roaming_ai`, or `delegated_ai`: an inference
  controller selects from the same hand or Passes.

Changing a controller never changes the avatar's legal verbs, targets, costs,
checks, inventory rules, bonds, combat participation, evolution, or deed
projection. Session ownership decides who may submit a direct choice; it is an
authorization boundary, not an RPG rule.

The room roster has one projection-visibility policy across `/state`, typed
`look`/`who`, and ordered-turn messages. A `direct_input` avatar whose
presence has lapsed is normally absent. While that avatar still owns an
authoritative focused turn, the roster keeps them visible until the bounded
turn-recovery path hands off; nobody is blocked by an unseen name.
Actor-targeted offers and commands use the stricter active-presence predicate,
so that temporary roster visibility does not make the lapsed holder a legal
target. An offer issued while they were active still fails closed after they
leave. Present co-located avatars and inference-controlled residents remain
targetable when the underlying world rule allows the action.

Room-card reactions rotate through every present active avatar in stable card
order. An inference controller may speak and update its own continuity. A
generated line for a `direct_input` avatar is public proxy speech on that
player's behalf: it cannot create a private belief, promise, desire, pending
intent, or extra mechanical action.

The scene projects free obvious sensory truth, then the action surface includes
focused Notice, Search, Study, Scout, Travel, Mark, Open, Craft, Prepare,
Work/Help, Take, Set Down, Give, Use, Trade, Influence, Rest, Defend/Flee, and
bounded Attack when their authoritative targets exist. Per
[ADR 0005](decisions/0005-thresholds-trails-and-strict-referee.md), reveal,
access, safety, transfer, and movement remain distinct: Scout does not Travel,
Open does not Take, and Search does neither. Kernel offers, room state,
authored content, inventory, clocks, combat state, and access rules certify
candidates. Gifts may target any co-located avatar that can carry the item; an
authored request ranks a gift but does not make it legal. Trades use the same
transfer rule but require the recipient controller's acceptance policy. No
controller may add an action or target.

[ADR 0009](decisions/0009-companies-ventures-formations-and-shared-travel.md)
does not let one actor's ordinary Travel offer acquire control of nearby
actors. Shared departure is a separate versioned consent and Venture contract:
Company membership, Venture participation, Formation, vehicle occupancy, and
readiness are independent facts, and only the declared ready subset moves.
Until that contract lands, every Travel action remains actor-scoped even when
the browser presents a travelling-party treatment.

Inference-controller selection is deterministic. Safety, recovery, active
projects, represented delivery needs, witnessed item memories, possessed
recipe inputs, and relationship context provide the main score. An established
practice contributes only a one-point tie-breaker. Authored titles and
aspirations contribute no legality or score.

Each inferred action stores a versioned trace with the full candidate set,
bindings, target, factors, eligibility or rejection, chosen offer, seed, state
revision, outcome, and committed event sequence IDs. Proposed actions outside
the certified set fail closed. If no candidate in the current hand survives
grounding, the controller records certified Pass and yields. If neither a
playable card nor Pass exists, it produces no world mutation.

Every meaningful outcome uses the same journal and projection path regardless
of controller. It can reveal a route through canonical Search/Scout, create
typed craft output, contribute to a project, and complete a physical delivery.
Repeat-pair, repeat-item, repeated-craft, and immediate-return checks prevent
gift, trade, pickup/drop, craft, and movement loops.

Compatibility is deliberately one-way during the migration. Persisted
`control_mode: "human"` values load as `direct_input`, while new snapshots and
public state serialize the canonical `direct_input` value. Legacy `kind`
remains readable and may identify authored provenance, but clients and rules
must not use it to decide what an avatar may do or how prominently it appears.
