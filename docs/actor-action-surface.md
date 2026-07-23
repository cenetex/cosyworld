# Shared actor action surface

CosyWorld composes one scene-local legal action surface for every active
avatar. `kind` is retained only as content provenance and snapshot
compatibility; it does not create a player/NPC mechanics boundary.

Every avatar with the same facets in the same scene receives the same candidate
verbs and targets. `control_mode` decides which intelligence chooses from that
surface:

- `direct_input`: a person selects one of the certified buttons;
- `reactive_ai`, `local_ai`, `roaming_ai`, or `delegated_ai`: an inference
  controller selects one of those same buttons.

Changing a controller never changes the avatar's legal verbs, targets, costs,
checks, inventory rules, bonds, combat participation, evolution, or deed
projection. Session ownership decides who may submit a direct choice; it is an
authorization boundary, not an RPG rule.

Room-card reactions rotate through every present active avatar in stable card
order. An inference controller may speak and update its own continuity. A
generated line for a `direct_input` avatar is public proxy speech on that
player's behalf: it cannot create a private belief, promise, desire, pending
intent, or extra mechanical action.

The surface includes Notice/Search, Study, Scout, Travel, Craft, Prepare,
Work/Help, Take, Set Down, Give, Use, Trade, Influence, Rest, Defend/Flee, and
bounded Attack when their authoritative targets exist. Kernel offers, room
state, authored content, inventory, clocks, combat state, and access rules
certify candidates. Gifts may target any co-located avatar that can carry the
item; an authored request ranks a gift but does not make it legal. Trades use
the same transfer rule but require the recipient controller's acceptance
policy. No controller may add an action or target.

Inference-controller selection is deterministic. Safety, recovery, active
projects, represented delivery needs, witnessed item memories, possessed
recipe inputs, and relationship context provide the main score. An established
practice contributes only a one-point tie-breaker. Authored titles and
aspirations contribute no legality or score.

Each inferred action stores a versioned trace with the full candidate set,
bindings, target, factors, eligibility or rejection, chosen offer, seed, state
revision, outcome, and committed event sequence IDs. Proposed actions outside
the certified set fail closed. If no candidate survives grounding and cooldown
checks, the controller produces no world mutation.

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
