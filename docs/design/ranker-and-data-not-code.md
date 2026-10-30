# Shrink hand-tuned taste, then let a tiny ranker earn its place

Status: design, 2026-10-30. Owner-approved. Built in six phases; each phase
is its own small PR. Related: #1454 (core switch), #1467 (inner life),
#1468 (the Old Oak).

## Outcome

Residents choose from what the rules allow. Today much of that choice is
hand-tuned taste written as code: value bonuses, special-case branches,
canned sentences. First we delete or move that taste into data. Then we
measure whether the choices matter at all. Only if they do, one tiny ranker
picks among the legal options, with frozen weights that replay exactly.

The rules always own legality and outcomes. A model only ranks options the
rules already made legal.

## Phase 1: the core switch

Land the want-model core switch (#1454). It removes about 7,100 lines of
hand-tuned taste and gives every avatar one quest driven by the world rules.

## Phase 2: data, not code; words, not templates

- Move into data:
  - the hub item value bonuses (lamp, oil, bell) in motives `valueOf`;
  - the grievance definitions in `recordReaction` (keeper and moth);
  - the Greek weather tables in `weather.mjs`.
- Delete the lamp, oil, bell and mirror special-case branch in the
  `world.mjs` `toward` planner.
- Refusals and grievances commit a code: `grudge`, `needs-it` or
  `wants-something-else`. The refuser's line voices the code.
- Remove the canned captions, plan reasons, `refusalText`, `waitNarration`
  and the weather sentences.
- Cut the style-instruction paragraph at the top of `atmosphere.rs`.
  Prompts stay "I'm X. I have… I want… Present…" plus a cue.

## Phase 3: shadow logging

For each resident decision, log the legal set, a small feature row per
candidate, the chosen key and the outcome. Behaviour does not change.

## Phase 4: the three gates

Run the owner's gates from crownless2 (`docs/ACTION-ECONOMY.md` in
`crownless2-ml`) in simulation, before any model exists:

1. **It matters.** A random decider loses clearly (under 25%).
2. **No answer is free.** No constant policy reaches 45%.
3. **There is room above the rule.** A trained brain can beat the rule
   (over 55%).

If a gate fails, fix the world (scarcity and costs), not the model.

## Phase 5: one tiny ranker

- **Three decision points:** the next quest (`nextWant`), consent (gift,
  trade, invite), and verb choice in `wantPlan`.
- **Forward pass:** port crownless2's int8 integer forward pass
  (`src/brain.c`, `docs/BRAIN.md`) to JavaScript so the browser and QuickJS
  agree byte for byte. Each candidate gets a feature row; a softmax picks
  (the `nn_protocol` shape from `crlplrimes`).
- **Weights are data** in the rules bundle, under the bundle hash. Released
  journals replay on frozen weights.
- **Training** is offline, from replayed journals and simulation, on a
  reward (quest met, fewer stalls and grievances), not pure imitation.
- **Rollout:** shadow first, then promoted by the gates. The adaptive-learning
  bandit becomes the per-avatar adjustment on top.
- **Reuse** the classic card-policy pieces: `v2/orchestrator-rust/src/card_policy/`,
  the `.cwrank` format, the regret-weighted pairwise trainer and its gate
  ([card-policy ranker](../../v2/docs/card-policy-ranker.md)).

## Phase 6 (optional): an offline teacher

An LLM may label consent cases offline to train the ranker. No model decides
at runtime.

## Never ML

Legality, outcomes, validators, replay, and dream seed picking stay rules.

## Risk

The ranker may only tie the rules. crownless2 saw this, and the classic card
policy found "no strict preference signal". The gates decide: a ranker that
cannot clear them does not ship, and phases 1 to 3 stand on their own.
