#!/bin/sh
set -eu

log_group="${COSYWORLD_LOG_GROUP_NAME:-/cosyworld/production}"
aws_region="${AWS_REGION:-us-east-1}"
primary_url="${COSYWORLD_PRIMARY_META_URL:-https://cosyworld.fly.dev/meta}"
lonelyforest_url="${COSYWORLD_LONELYFOREST_META_URL:-https://lonelyforest.com/meta}"
poll_attempts="${COSYWORLD_LOG_QUERY_POLL_ATTEMPTS:-24}"

case "$poll_attempts" in
  ""|*[!0-9]*|0) printf '%s\n' "COSYWORLD_LOG_QUERY_POLL_ATTEMPTS must be a positive integer" >&2; exit 2 ;;
esac

primary_request_id="log-smoke-primary-$(uuidgen | tr '[:upper:]' '[:lower:]')"
lonelyforest_request_id="log-smoke-lonelyforest-$(uuidgen | tr '[:upper:]' '[:lower:]')"

curl --fail --silent --show-error --output /dev/null \
  --header "X-Request-Id: $primary_request_id" "$primary_url"
curl --fail --silent --show-error --output /dev/null \
  --header "X-Request-Id: $lonelyforest_request_id" "$lonelyforest_url"

query_string="fields @timestamp, app, machine_id, region, process, tenant, worldpack, request_id | filter request_id in [\"$primary_request_id\", \"$lonelyforest_request_id\"] | sort @timestamp asc"
end_time="$(date +%s)"
start_time="$((end_time - 600))"
query_id="$(aws logs start-query \
  --region "$aws_region" \
  --log-group-name "$log_group" \
  --start-time "$start_time" \
  --end-time "$end_time" \
  --query-string "$query_string" \
  --query queryId \
  --output text)"

attempt=1
while [ "$attempt" -le "$poll_attempts" ]; do
  result="$(aws logs get-query-results --region "$aws_region" --query-id "$query_id")"
  status="$(printf '%s' "$result" | jq -r '.status')"
  case "$status" in
    Complete)
      printf '%s' "$result" | jq -e \
        --arg primary_id "$primary_request_id" \
        --arg lonelyforest_id "$lonelyforest_request_id" '
          [.results[] | map({key: .field, value: .value}) | from_entries] as $rows
          | any($rows[]; .app == "cosyworld" and .request_id == $primary_id and (.machine_id | length) > 0)
          and any($rows[]; .app == "cosyworld-lonelyforest" and .request_id == $lonelyforest_id and (.machine_id | length) > 0)
        ' >/dev/null || {
          printf '%s\n' "CloudWatch query completed without both app/request-ID pairs" >&2
          exit 1
        }
      printf '%s\n' "Production log ingestion verified for both Fly apps in $log_group."
      exit 0
      ;;
    Failed|Cancelled|Timeout|Unknown)
      printf '%s\n' "CloudWatch Logs Insights query ended with status $status" >&2
      exit 1
      ;;
  esac
  sleep 5
  attempt=$((attempt + 1))
done

printf '%s\n' "Timed out waiting for CloudWatch ingestion query $query_id" >&2
exit 1
