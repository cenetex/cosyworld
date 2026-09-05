#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${COSYWORLD_CARD_POLICY_COLLECT_URL:-http://127.0.0.1:3115}"
JOURNAL="${COSYWORLD_CARD_POLICY_COLLECT_JOURNAL:-/tmp/cosyworld-card-policy-run/events.sqlite}"
MODERATION_TOKEN="${COSYWORLD_CARD_POLICY_COLLECT_TOKEN:-collection-token}"
OBJECTIVE_COUNT="${1:-600}"
START_EPISODE="${COSYWORLD_CARD_POLICY_COLLECT_START_EPISODE:-0}"
RUN_ID="${COSYWORLD_CARD_POLICY_COLLECT_RUN_ID:-local}"
SETTLE_SECONDS="${COSYWORLD_CARD_POLICY_COLLECT_SETTLE_SECONDS:-0.35}"
OBJECTIVE_MAX_TURNS="${COSYWORLD_CARD_POLICY_COLLECT_MAX_TURNS:-2}"
SETUP_ACTION_SEQUENCE="${COSYWORLD_CARD_POLICY_COLLECT_SETUP_ACTIONS:-notice_actor}"
ACTION_SEQUENCE="${COSYWORLD_CARD_POLICY_COLLECT_ACTIONS:-chat,pick_up}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCHESTRATOR_DIR="$(cd "${SCRIPT_DIR}/../orchestrator-rust" && pwd)"
LAB_BIN="${COSYWORLD_CARD_POLICY_LAB_BIN:-${ORCHESTRATOR_DIR}/target/debug/card-policy-lab}"
OUTPUT_DIR="${COSYWORLD_CARD_POLICY_COLLECT_OUTPUT_DIR:-${ORCHESTRATOR_DIR}/.runtime/card-policy-shadow/collection-${RUN_ID}}"
OBSERVATIONS="${OUTPUT_DIR}/observations.ndjson"
DATASET="${OUTPUT_DIR}/real-replay.tsv"

if ! [[ "$OBJECTIVE_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "objective count must be a positive integer" >&2
  exit 2
fi
if ! [[ "$START_EPISODE" =~ ^[0-9]+$ ]] || ((START_EPISODE >= OBJECTIVE_COUNT)); then
  echo "start episode must be between 0 and $((OBJECTIVE_COUNT - 1))" >&2
  exit 2
fi
if ! [[ "$OBJECTIVE_MAX_TURNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "objective max turns must be a positive integer" >&2
  exit 2
fi
IFS=',' read -r -a ACTIONS <<<"$ACTION_SEQUENCE"
SETUP_ACTIONS=()
if [[ -n "$SETUP_ACTION_SEQUENCE" ]]; then
  IFS=',' read -r -a SETUP_ACTIONS <<<"$SETUP_ACTION_SEQUENCE"
fi
if ((${#ACTIONS[@]} < 1)); then
  echo "action sequence must contain at least one trigger" >&2
  exit 2
fi

for command in curl jq sqlite3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required" >&2
    exit 1
  fi
done
if [[ ! -x "$LAB_BIN" ]]; then
  echo "card-policy-lab binary is missing: ${LAB_BIN}" >&2
  exit 1
fi
mkdir -p "$OUTPUT_DIR"
if ((START_EPISODE == 0)) && [[ -e "$OBSERVATIONS" || -e "$DATASET" ]]; then
  echo "collection output already exists: ${OUTPUT_DIR}" >&2
  exit 1
fi
if ((START_EPISODE > 0)) && [[ ! -e "$OBSERVATIONS" || ! -e "$DATASET" ]]; then
  echo "resume output is missing: ${OUTPUT_DIR}" >&2
  exit 1
fi

DEFAULT_TREASURE_IDS="2002,2003,2004,2006,2007,2008,2009,2010,2012,2013,8401,8402,8403,8404,8405,7201,7202,7203,7204,7205,7206,7207,7208,7209,7210"
IFS=',' read -r -a TREASURES <<<"${COSYWORLD_CARD_POLICY_COLLECT_TREASURE_IDS:-$DEFAULT_TREASURE_IDS}"
if ((${#TREASURES[@]} == 0)); then
  echo "treasure id list must not be empty" >&2
  exit 2
fi
for treasure_id in "${TREASURES[@]}"; do
  if ! [[ "$treasure_id" =~ ^[1-9][0-9]*$ ]]; then
    echo "invalid treasure item id: ${treasure_id}" >&2
    exit 2
  fi
done

post_json() {
  local path="$1"
  local body="$2"
  curl -fsS --max-time 10 -X POST "${BASE_URL}${path}" \
    -H 'Content-Type: application/json' \
    -d "$body"
}

post_json_lenient() {
  local path="$1"
  local body="$2"
  curl -sS --max-time 10 -X POST "${BASE_URL}${path}" \
    -H 'Content-Type: application/json' \
    -d "$body"
}

moderator_post() {
  local path="$1"
  local body="$2"
  curl -fsS --max-time 10 -X POST "${BASE_URL}${path}" \
    -H "Authorization: Bearer ${MODERATION_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$body"
}

resident_message_count() {
  sqlite3 "$JOURNAL" \
    "SELECT COUNT(*) FROM world_events WHERE event_type='message.created' AND CAST(json_extract(payload_json, '$.actor_id') AS INTEGER) BETWEEN 1001 AND 1003;" \
    2>/dev/null || echo 0
}

labeled_count() {
  sqlite3 "$JOURNAL" \
    "SELECT COUNT(*) FROM action_journal WHERE json_extract(record_json, '$.resident_planning.card_policy.branch_label.objective_id') IS NOT NULL;" \
    2>/dev/null || echo 0
}

terminal_count() {
  sqlite3 "$JOURNAL" \
    "SELECT COUNT(*) FROM world_events WHERE event_type IN ('treasure_objective.completed','treasure_objective.timed_out') AND json_extract(payload_json, '$.content') LIKE 'Treasure objective ${RUN_ID}-%';" \
    2>/dev/null || echo 0
}

objective_labeled_count() {
  local objective_id="$1"
  sqlite3 "$JOURNAL" \
    "SELECT COUNT(*) FROM action_journal WHERE json_extract(record_json, '$.resident_planning.card_policy.branch_label.objective_id')='${objective_id}';" \
    2>/dev/null || echo 0
}

objective_terminal_count() {
  local objective_id="$1"
  sqlite3 "$JOURNAL" \
    "SELECT COUNT(*) FROM world_events WHERE event_type IN ('treasure_objective.completed','treasure_objective.timed_out') AND json_extract(payload_json, '$.content') LIKE 'Treasure objective ${objective_id} %';" \
    2>/dev/null || echo 0
}

wait_for_resident_turn() {
  local before="$1"
  local objective_id="$2"
  local current="$before"
  for _ in {1..120}; do
    current="$(resident_message_count)"
    if ((current > before)) || (( $(objective_terminal_count "$objective_id") > 0 )); then
      sleep "$SETTLE_SECONDS"
      return 0
    fi
    sleep 0.05
  done
  echo "resident turn timed out after message count ${before}" >&2
  return 1
}

state_for() {
  local actor_id="$1"
  local actor_session="$2"
  curl -fsS --max-time 10 \
    "${BASE_URL}/state?actor_id=${actor_id}&actor_session=${actor_session}"
}

wait_for_player_turn() {
  local actor_id="$1"
  local actor_session="$2"
  local state
  for _ in {1..240}; do
    state="$(state_for "$actor_id" "$actor_session")"
    if jq -e --argjson actor "$actor_id" \
      '(.turn.enabled | not) or .turn.is_current_actor or (.turn.current_actor_id == $actor)' \
      <<<"$state" >/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  echo "player turn did not return for actor ${actor_id}" >&2
  return 1
}

submit_offer() {
  local actor_id="$1"
  local actor_session="$2"
  local requested_kind="$3"
  local state offer path body item_id feature_key
  state="$(state_for "$actor_id" "$actor_session")"
  offer="$(jq -c --arg kind "$requested_kind" \
    'first(.action_offers[] | select(.kind == $kind and (.disabled | not)))' \
    <<<"$state")"
  if [[ -z "$offer" || "$offer" == "null" ]]; then
    echo "no enabled ${requested_kind} offer; current offers: $(jq -c '[.action_offers[] | select(.disabled | not) | {kind,target}]' <<<"$state")" >&2
    return 1
  fi

  case "$requested_kind" in
    notice_actor)
      path="/actions/notice"
      body="$(jq -cn \
        --argjson offer "$offer" \
        --arg path "$path" \
        --arg session "$actor_session" \
        --argjson actor "$actor_id" \
        '{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:{actor_id:$actor,actor_session:$session,target_actor_id:$offer.target.id}}')"
      ;;
    pick_up)
      path="/actions/pick-up"
      item_id="$(jq -r '.target.id' <<<"$offer")"
      body="$(jq -cn \
        --argjson offer "$offer" \
        --arg path "$path" \
        --arg session "$actor_session" \
        --argjson actor "$actor_id" \
        --argjson item "$item_id" \
        '{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:{actor_id:$actor,actor_session:$session,item_id:$item,target_item_id:null,target_actor_id:null}}')"
      ;;
    check)
      path="/actions/check"
      body="$(jq -cn \
        --argjson offer "$offer" \
        --arg path "$path" \
        --arg session "$actor_session" \
        --argjson actor "$actor_id" \
        '{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:{actor_id:$actor,actor_session:$session,ability:"wisdom",dc:null,target_actor_id:null}}')"
      ;;
    use_feature)
      path="/actions/use-item"
      item_id="$(jq -r '.id | split(":")[1] | tonumber' <<<"$offer")"
      feature_key="$(jq -r '.id | split(":")[3]' <<<"$offer")"
      body="$(jq -cn \
        --argjson offer "$offer" \
        --arg path "$path" \
        --arg session "$actor_session" \
        --arg feature "$feature_key" \
        --argjson actor "$actor_id" \
        --argjson item "$item_id" \
        '{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:{actor_id:$actor,actor_session:$session,item_id:$item,target_actor_id:null,location_id:$offer.target.id,feature_key:$feature}}')"
      ;;
    rest)
      path="/actions/rest"
      body="$(jq -cn \
        --argjson offer "$offer" \
        --arg path "$path" \
        --arg session "$actor_session" \
        --argjson actor "$actor_id" \
        '{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:{actor_id:$actor,actor_session:$session}}')"
      ;;
    craft)
      path="/actions/craft"
      body="$(jq -cn \
        --argjson offer "$offer" \
        --arg path "$path" \
        --arg session "$actor_session" \
        --argjson actor "$actor_id" \
        '{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:{actor_id:$actor,actor_session:$session,recipe_id:$offer.target.id,receipt_id:null}}')"
      ;;
    chat)
      path="/actions/chat"
      body="$(jq -cn \
        --argjson offer "$offer" \
        --arg path "$path" \
        --arg session "$actor_session" \
        --argjson actor "$actor_id" \
        '{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:{actor_id:$actor,actor_session:$session,target_actor_id:$offer.target.id}}')"
      ;;
    give_item)
      path="/actions/give-item"
      item_id="$(jq -r '.id | split(":")[1] | tonumber' <<<"$offer")"
      body="$(jq -cn \
        --argjson offer "$offer" \
        --arg path "$path" \
        --arg session "$actor_session" \
        --argjson actor "$actor_id" \
        --argjson item "$item_id" \
        '{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:{actor_id:$actor,actor_session:$session,item_id:$item,target_actor_id:$offer.target.id}}')"
      ;;
    *)
      echo "unsupported collection offer kind: ${requested_kind}" >&2
      return 1
      ;;
  esac

  local response
  response="$(post_json /actions/submit "$body")"
  if [[ "$(jq -r '.ok' <<<"$response")" != "true" ]]; then
    echo "offer submission failed: ${response}" >&2
    return 1
  fi
}

seek_offer() {
  local actor_id="$1"
  local actor_session="$2"
  local requested_kind="$3"
  local state think body response
  for _ in {1..64}; do
    state="$(state_for "$actor_id" "$actor_session")"
    if jq -e --arg kind "$requested_kind" \
      'any(.action_offers[]; .kind == $kind and (.disabled | not))' \
      <<<"$state" >/dev/null; then
      return 0
    fi
    think="$(jq -c \
      '([.action_hand.entries[] | select(.slot == "self" and .think.available) | .think]
        + [.action_hand.entries[] | select(.think.available) | .think]) | first' \
      <<<"$state")"
    if [[ -z "$think" || "$think" == "null" ]]; then
      echo "cannot rotate Story Hand to ${requested_kind}" >&2
      return 1
    fi
    body="$(jq -cn \
      --arg session "$actor_session" \
      --argjson actor "$actor_id" \
      --arg offer_id "$(jq -r '.offer_id' <<<"$think")" \
      '{actor_id:$actor,actor_session:$session,command:"think",offer_id:$offer_id}')"
    response="$(post_json_lenient /commands "$body")"
    if [[ "$(jq -r '.ok' <<<"$response")" != "true" ]]; then
      if [[ "$(jq -r '.status // 0' <<<"$response")" =~ ^(409|423)$ ]]; then
        wait_for_player_turn "$actor_id" "$actor_session"
        continue
      fi
      echo "Story Hand rotation failed: ${response}" >&2
      return 1
    fi
    wait_for_player_turn "$actor_id" "$actor_session"
  done
  echo "Story Hand did not expose ${requested_kind} after 64 rotations" >&2
  return 1
}

collected_labeled="$START_EPISODE"
collected_terminal="$START_EPISODE"
for ((episode = START_EPISODE; episode < OBJECTIVE_COUNT; episode += 1)); do
  post_json /dev/reset '{}' >/dev/null
  avatar="$(post_json /avatar "{\"name\":\"Policy Collector ${episode}\"}")"
  actor_id="$(jq -r '.actor.id' <<<"$avatar")"
  actor_session="$(jq -r '.actor_session' <<<"$avatar")"
  if [[ -z "$actor_session" || "$actor_session" == "null" ]]; then
    echo "avatar creation failed: ${avatar}" >&2
    exit 1
  fi

  if [[ -n "$SETUP_ACTION_SEQUENCE" ]]; then
    for setup_action_kind in "${SETUP_ACTIONS[@]}"; do
      submit_offer "$actor_id" "$actor_session" "$setup_action_kind"
      wait_for_player_turn "$actor_id" "$actor_session"
    done
  fi
  for action_kind in "${ACTIONS[@]}"; do
    seek_offer "$actor_id" "$actor_session" "$action_kind"
  done

  treasure_index=$(((episode * 7) % ${#TREASURES[@]}))
  treasure_id="${TREASURES[$treasure_index]}"
  objective_id="${RUN_ID}-$(printf '%06d' "$episode")-rati"
  objective="$(jq -cn \
    --arg id "$objective_id" \
    --argjson treasure "$treasure_id" \
    --argjson max_turns "$OBJECTIVE_MAX_TURNS" \
    '{objective_id:$id,actor_id:1001,treasure_item_id:$treasure,max_turns:$max_turns}')"
  response="$(moderator_post /moderation/card-policy/treasure-objectives "$objective")"
  if [[ "$(jq -r '.ok' <<<"$response")" != "true" ]]; then
    echo "objective start failed: ${response}" >&2
    exit 1
  fi

  for action_kind in "${ACTIONS[@]}"; do
    before="$(resident_message_count)"
    submit_offer "$actor_id" "$actor_session" "$action_kind"
    wait_for_resident_turn "$before" "$objective_id"
    wait_for_player_turn "$actor_id" "$actor_session"
  done

  episode_labeled="$(objective_labeled_count "$objective_id")"
  episode_terminal="$(objective_terminal_count "$objective_id")"
  if ((episode_labeled < 1 || episode_terminal != 1)); then
    echo "episode ${objective_id} incomplete: labeled=${episode_labeled} terminal=${episode_terminal}" >&2
    exit 1
  fi
  export_args=(
    export-shadow
    --journal "$JOURNAL"
    --out "$OBSERVATIONS"
    --dataset-out "$DATASET"
    --after-seq 0
  )
  if [[ -e "$OBSERVATIONS" || -e "$DATASET" ]]; then
    export_args+=(--append)
  fi
  "$LAB_BIN" "${export_args[@]}" >/dev/null
  collected_labeled=$((collected_labeled + episode_labeled))
  collected_terminal=$((collected_terminal + episode_terminal))

  if (((episode + 1) % 10 == 0 || episode + 1 == OBJECTIVE_COUNT)); then
    echo "objectives=$((episode + 1)) labeled=${collected_labeled} terminal=${collected_terminal}"
  fi
done

final_labeled="$collected_labeled"
final_terminal="$collected_terminal"
if ((final_terminal < OBJECTIVE_COUNT)); then
  echo "collection ended with only ${final_terminal}/${OBJECTIVE_COUNT} terminal objectives" >&2
  exit 1
fi
if ((final_labeled < OBJECTIVE_COUNT)); then
  echo "collection ended with only ${final_labeled}/${OBJECTIVE_COUNT} labeled rows" >&2
  exit 1
fi
echo "complete objectives=${OBJECTIVE_COUNT} labeled=${final_labeled} terminal=${final_terminal} dataset=${DATASET} observations=${OBSERVATIONS}"
