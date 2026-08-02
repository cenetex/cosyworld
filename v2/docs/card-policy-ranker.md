# All-card policy ranker

Cosyworld has a pure-Rust training and integer-inference path for resident card
selection. The learned model does **not** classify `A`, `B`, or `DRAW` directly.
It scores every currently legal card with shared weights and returns a complete
deck ranking.

The authoritative two-card hand is a deterministic adapter over that ranking:

1. read the highest-ranked card's integer score;
2. inspect up to the highest-ranked `k` cards;
3. consider rank two or three executable only when its score exactly ties the
   highest score;
4. execute the highest-ranked executable card shown as A or B, otherwise DRAW;
5. after DRAW, rebuild the avatar observation and rank the complete deck again.

`k` is configurable from 1 through 3. The conservative default remains 1.
Unlike the original shortlist adapter, increasing `k` no longer authorizes a
known-lower-scoring card. A rank-only caller has no equivalence signal and
therefore fails closed to rank one.

The implementation lives in `orchestrator-rust/src/card_policy/`. The
`card-policy-lab` binary generates data, trains a model, evaluates ranking and
end-to-end treasure behavior, and emits a deployable `.cwrank` artifact. It uses
no Python and has no runtime dependency on the sibling `nsrl` checkout.

## Model contract

The implementation reuses the small integer-router pattern proven in NSRL, but
keeps the kernel local to Cosyworld:

- one 24-element signed-Q15 vector per candidate card;
- shared 16-unit integer ReLU layer;
- one integer relevance score per card;
- `i8` weights, `i32` biases, integer-only inference;
- pairwise regret-weighted training that orders the complete deck;
- variable deck size with one fixed-size model invocation per card.

The v2 artifact is 516 bytes and includes a magic value, artifact version,
tensor shape, feature-schema hash, deterministic seed, and checksum. Loading
rejects stale v1 three-class artifacts and any model whose feature contract or
checksum differs.

The model proposes a card ranking. It never bypasses authoritative offer
identity, staleness checks, costs, permissions, or the world kernel. A/B still
uses the existing command path. DRAW only advances the replayable actor-scoped
hand cursor.

## Per-avatar history

Weights are shared; observations are personal. The feature encoder derives its
state from the current avatar's journal history, including:

- visited and searched fractions;
- whether the current and candidate locations were revisited or searched;
- previous location and repeated routes;
- per-target visit counts and used edges;
- avatar-local clue knowledge;
- consecutive draws and remaining episode budget.

Two avatars viewing the same legal deck can therefore rank it differently. The
hidden treasure identity is never a feature. Synthetic rows are grouped and
split by whole world/trajectory rather than shuffled as independent cards.

## Synthetic bootstrap data

The generator creates connected graph worlds, hides treasure away from the
start, gives every location a variable deck of movement/search cards, and keeps
an authoritative two-card cursor. A failed search exposes an observable
shortest-path clue.

Each observation stores the current A/B candidate indices plus the features and
exact semantic cost-to-treasure for **every legal card**:

```text
sample_id  world_seed  hand_a  hand_b  target  candidate-feature-groups  child-losses
```

Candidate feature groups are separated with `;`; each group contains 24 Q15
values. Pairwise training learns the ordering of the entire deck, including the
second and third ranks used by shortlist experiments. Train, calibration, and
evaluation files are split by world seed, and the CLI rejects overlapping
training/calibration worlds. Early stopping retains the lowest-regret
calibration checkpoint.

Synthetic data is a bootstrap, not the promotion dataset. It teaches useful
invariants—follow clues, avoid repeatedly searched locations, and avoid cycling
through used routes—but cannot represent every authored card or quest mechanic.

## Run the complete pipeline

From `v2/orchestrator-rust`:

```sh
cargo run --release --bin card-policy-lab -- pipeline \
  --out-dir ../../output/card-policy \
  --train-worlds 1000 \
  --calibration-worlds 200 \
  --eval-worlds 200 \
  --trajectories 4 \
  --max-steps 48 \
  --epochs 64 \
  --seed 1
```

The output contains the three datasets, the v2 `.cwrank` model, training and
evaluation JSON, and row-level predictions. Evaluation JSON separates:

- exact-best and zero-regret card ranking;
- top-3 oracle coverage and mean card regret;
- A/B/DRAW adapter agreement;
- held-out treasure success, turn count, and draw rate for `k=1`, `k=2`, and
  `k=3`;
- the same three end-to-end policies using the exact oracle ranking.

## Simulate a population

Run thousands of independent mini avatars against the same shared model while
keeping a separate visit/search/clue/route history for each avatar:

```sh
cargo run --release --bin card-policy-lab -- simulate \
  --model .runtime/card-policy-shadow/incumbent.cwrank \
  --trace .runtime/card-policy-shadow/population-10000.json \
  --worlds 2500 \
  --avatars-per-world 4 \
  --max-steps 48 \
  --top-k 3 \
  --seed 1
```

This evaluates exactly 10,000 avatars. The trace reports treasure success,
timeouts, draw rate, mean turns, p50/p90/p99 turns, and local throughput. It
also runs two paired controls on the same worlds and starting hands:

- `history_ablated` uses the learned model but clears each avatar's visits,
  searches, clues, previous location, and used routes before every choice;
- `oracle` uses exact semantic distance to treasure.

`history_influence` additionally measures how often removing history changes
the learned full ranking, top card, or final A/B/DRAW adapter action along the
personalized trajectories. This distinguishes a model that merely accepts
history-shaped features from one whose decisions are actually affected by
them. The simulation is deterministic except for elapsed-time and throughput
fields.

On the fixed-seed 10,000-avatar regression population, all three shortlist
depths found treasure in every episode. Score-tied top-3 reduced learned mean
turns from 8.629 to 8.144 and the draw rate from 37.6% to 34.1%. This regression
exists specifically to prevent the former permissive top-3 behavior from
returning.

## Live rollout

```sh
COSYWORLD_CARD_POLICY_MODE=shadow \
COSYWORLD_CARD_POLICY_MODEL_PATH=../../output/card-policy/card-policy.cwrank \
COSYWORLD_CARD_POLICY_TOP_K=3 \
cargo run --release --bin cosyworld-orchestrator
```

`COSYWORLD_CARD_POLICY_MODE` accepts `off` (default), `shadow`, or `live`.
`COSYWORLD_CARD_POLICY_TOP_K` accepts 1 through 3 and defaults to 1. Shadow runs
both selectors and preserves the LLM decision. Live skips the LLM intent
selection request; voice generation remains independent.

The journal trace records the model hash, full candidate identities, frozen
per-avatar Q15 features, all scores, complete ranking, shortlist depth, exact
A/B identities, selected offer, and LLM agreement. This is sufficient to replay
the decision and turn later outcomes into training examples.

## Continual learning

Do not mutate live weights after each action. That would make replay depend on
timing and allow one noisy episode to corrupt an avatar's policy. Use online
data with gated artifact updates instead:

1. collect journaled observations and eventual treasure outcomes;
2. convert complete avatar trajectories into replay rows;
3. warm-start a challenger with `--model-in DEPLOYED.cwrank`;
4. evaluate it on frozen regression worlds and recent held-out avatar episodes;
5. promote the new checksummed artifact atomically only if it passes the gate.

Example warm start:

```sh
cargo run --release --bin card-policy-lab -- train \
  --model-in deployed.cwrank \
  --train recent-replay.tsv \
  --calibration frozen-calibration.tsv \
  --model-out challenger.cwrank \
  --trace challenger-training.json
```

The training report binds `warm_start_model_hash` to the parent artifact.
Models remain pinned within an episode, while each turn still incorporates that
avatar's latest journaled history.

Start an authoritative, private treasure episode for an inference-controlled
avatar through the moderator API. The treasure must be a loose world item; the
item id is persisted for replay but is never copied into card-policy features or
traces:

```sh
curl -X POST http://127.0.0.1:3102/moderation/card-policy/treasure-objectives \
  -H "Authorization: Bearer $COSYWORLD_MODERATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"objective_id":"episode-001","actor_id":1003,"treasure_item_id":2001,"max_turns":48}'
```

While that objective is active, the planner clones the authoritative runtime
once per legal card, applies that card only in the clone, and records a bounded
cost-to-treasure for the resulting branch. A successful pickup has child loss
1; invalid or unreachable branches receive the remaining episode budget plus
one. The live world is never mutated by evaluation. Actual resident decisions
advance the objective budget, and journaled `treasure_objective.completed` or
`treasure_objective.timed_out` events close the episode.

Export newly journaled shadow observations and write valid counterfactual
labels directly in the ranker's TSV format:

```sh
cargo run --release --bin card-policy-lab -- export-shadow \
  --journal .runtime/cosyworld-v2-events.sqlite \
  --out .runtime/card-policy-shadow/shadow-observations.ndjson \
  --dataset-out .runtime/card-policy-shadow/real-replay.tsv \
  --after-seq 0
```

For repeatable local collection, `scripts/collect-card-policy-objectives.sh`
drives authoritative HTTP offers against an isolated dev server and exports one
completed objective at a time. It requires `curl`, `jq`, and `sqlite3`, but not
Python. The optional local `card-policy-mock-provider` binary implements the
small OpenAI-compatible voice surface needed by the server so collection does
not depend on a remote model. It is deterministic test infrastructure, not a
production voice provider.

If a collector is interrupted after `N` complete objectives, resume it without
rewriting those rows:

```sh
COSYWORLD_CARD_POLICY_COLLECT_URL=http://127.0.0.1:3115 \
COSYWORLD_CARD_POLICY_COLLECT_JOURNAL=/tmp/card-policy/events.sqlite \
COSYWORLD_CARD_POLICY_COLLECT_RUN_ID=real-001 \
COSYWORLD_CARD_POLICY_COLLECT_START_EPISODE=N \
bash scripts/collect-card-policy-objectives.sh 500
```

`COSYWORLD_CARD_POLICY_COLLECT_TREASURE_IDS` accepts a comma-separated item-id
list for controlled canaries. `COSYWORLD_CARD_POLICY_COLLECT_MAX_TURNS` and
`COSYWORLD_CARD_POLICY_COLLECT_ACTIONS` can drive longer objectives; the action
sequence needs at least `max_turns + 1` response triggers. Only enabled,
authoritative offers are submitted.

Prepare one or more completed shard datasets for learning with a deterministic
world-level 70/15/15 split:

```sh
cargo run --release --bin card-policy-lab -- prepare-real \
  --out-dir .runtime/card-policy-real/real-001 \
  --seed 1 \
  .runtime/card-policy-shadow/collection-real-001-s1/real-replay.tsv \
  .runtime/card-policy-shadow/collection-real-001-s2/real-replay.tsv
```

The command rejects duplicate sample ids and keeps every row from one objective
in exactly one of `train.tsv`, `calibration.tsv`, or `eval.tsv`. It also writes
the merged `all.tsv` for auditing. Its data profile reports strict-preference
rows, rows whose candidate feature vectors are all identical, learnable strict
rows, and exact feature groups carrying conflicting targets.

Rows captured during an active objective are marked
`label_status: "counterfactual"` and `training_eligible: true`; other shadow
rows remain explicitly unlabeled and are omitted from the TSV. Every turn from
one objective hashes to the same `world_seed`, so train/calibration/evaluation
splits can reject episode leakage. Use the TSV with the existing `train`,
`eval`, and `gate` commands. Keep complete objective episodes in exactly one
split.

Gate a distinct challenger against the frozen evaluation set:

```sh
cargo run --release --bin card-policy-lab -- gate \
  --data eval.tsv \
  --incumbent incumbent.cwrank \
  --challenger challenger.cwrank \
  --trace promotion-gate.json
```

The gate requires a distinct artifact plus non-regression in mean regret,
zero-regret rate, clue-conditioned behavior, and A/B/DRAW adapter agreement.
It also requires at least one strict-preference row with distinguishable
candidate features; balanced opposing labels over identical inputs fail as
unlearnable instead of being treated as promotion evidence.
Passing this synthetic gate is necessary but still not sufficient for live
promotion; the challenger also needs a reviewed real-world objective and
held-out real trajectories.
