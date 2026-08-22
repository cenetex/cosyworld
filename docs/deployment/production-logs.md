# Production log retention and incident search

Issue #821 moves logs for `cosyworld` and `cosyworld-lonelyforest` out of Fly's
short native search window and into one CloudWatch Logs group. The committed
configuration is inert until an operator explicitly applies the Terraform,
creates the service credentials, and deploys `fly.logs.toml`.

## Data path and boundaries

1. Each Rust process emits newline-delimited JSON in production. Every event
   receives `app`, `machine_id`, `region`, `process`, `tenant`, and `worldpack`.
   HTTP activity adds a validated or generated `X-Request-Id` and logs the Axum
   route template, never the raw URL or query string.
2. Lonely Forest Nginx logs method, status, latency, upstream, tenant hostname,
   and the upstream request ID. It omits path segments, query strings, cookies,
   user agents, and authorization data.
3. A dedicated Fly Machine subscribes to the organization's `logs.>` NATS
   subject. NATS cannot express the union of the two app names, so Vector drops
   every event whose exact `fly.app.name` is not `cosyworld` or
   `cosyworld-lonelyforest` before normalization or export.
4. Vector keeps only a reviewed allowlist of operational detail fields, so
   unknown fields—including prompts, passkey material, and wallet or actor
   credentials—are discarded. It also redacts bearer tokens, credential
   assignments, query strings, and common API-key shapes from retained text.
   Its production transform and redaction fixtures live in
   `deploy/observability/vector.yaml`.
5. CloudWatch stores JSON events in `/cosyworld/production`, in streams named
   `<app>/<machine_id>`, for 30 days by default. The shipper can only append to
   that group. Attach the Terraform output `incident_reader_policy_arn` only to
   approved operator roles; it grants query access to this group and no writes.

The Vector disk buffer is capped at 256 MiB and blocks when full rather than
discarding the oldest event. Once CloudWatch accepts an event, retention is
age-based rather than volume-based, so a busy tenant cannot evict another
tenant's incident window. Provider quotas and an extended network outage can
still prevent new events from reaching CloudWatch; the shipper's own Fly logs
and Vector health check are the first places to inspect in that case.

## Validate before provisioning

Run these locally from the repository root:

```sh
FLY_ORG=test ACCESS_TOKEN=test AWS_REGION=us-east-1 \
  CLOUDWATCH_LOG_GROUP_NAME=/cosyworld/test \
  vector test deploy/observability/vector.yaml
FLY_ORG=test ACCESS_TOKEN=test AWS_REGION=us-east-1 \
  CLOUDWATCH_LOG_GROUP_NAME=/cosyworld/test \
  vector validate --no-environment --deny-warnings deploy/observability/vector.yaml
terraform -chdir=infra/production-logs init -backend=false
terraform -chdir=infra/production-logs validate
terraform -chdir=infra/production-logs plan
```

`terraform plan` is read-only but requires an AWS session. Review the planned
region, log-group name, retention, IAM policy, SNS topic, metric filters, and
alarms before applying.

## Provision and deploy (operator authorization required)

These steps create billable AWS and Fly resources. Do not run them as part of
a feature-branch test.

1. Apply `infra/production-logs`. To add email delivery, pass
   `-var='alarm_email_endpoints=["operator@example.com"]'` and confirm the AWS
   subscription message. With no endpoint, CloudWatch still records alarm
   state and history but SNS has no recipient.
   Attach `incident_reader_policy_arn` to the existing incident-response role;
   the module deliberately does not choose an organization-specific principal.
2. Create exactly one IAM access key for the Terraform output
   `shipper_iam_user_name`. Do not manage that access key in Terraform, print
   it, commit it, or leave it in a shell-history argument.
3. Create a read-only Fly organization token for `personal`. Set that token as
   `ACCESS_TOKEN` and the AWS key pair as `AWS_ACCESS_KEY_ID` and
   `AWS_SECRET_ACCESS_KEY` on the `cosyworld-log-shipper` app. These are the
   only secrets the shipper needs.
4. Create the app without public IPs, then deploy exactly one Machine:

   ```sh
   fly apps create cosyworld-log-shipper --org personal
   fly deploy --config fly.logs.toml --ha=false --no-public-ips
   ```

5. Confirm the Vector health check, then run:

   ```sh
   ./scripts/check-production-log-ingestion.sh
   ```

The smoke sends one safe `/meta` request to each production app with different
request IDs, waits up to two minutes for CloudWatch, and fails unless both app,
request-ID, and Machine-ID tuples are searchable.

## Incident queries

Use CloudWatch Logs Insights against `/cosyworld/production`. Always bound the
time picker as tightly as the incident allows.

Cross-app timeline around a known Machine or timestamp:

```text
fields @timestamp, severity, app, machine_id, region, process, tenant, worldpack, event, message
| filter app in ["cosyworld", "cosyworld-lonelyforest"]
| filter machine_id = "0803404a047798"
| sort @timestamp asc
| limit 1000
```

Follow one request across the proxy, application, and provider events:

```text
fields @timestamp, app, machine_id, process, tenant, worldpack, provider, event, message
| filter request_id = "incident-request-id"
| sort @timestamp asc
```

Review alert evidence:

```text
fields @timestamp, app, machine_id, process, tenant, worldpack, alert_kind, event, message, details
| filter ispresent(alert_kind)
| sort @timestamp desc
| limit 500
```

Provider availability:

```text
fields @timestamp, app, process, tenant, worldpack, provider, event, message, details.http_status
| filter alert_kind = "provider_unavailable" or event = "ai_readiness_transition"
| sort @timestamp desc
```

## Retention, cost, and deletion

- The default 30-day age policy exceeds the 14-day incident requirement.
  Terraform rejects lower or unsupported CloudWatch retention values.
  CloudWatch ingestion, retained GB-months, Logs Insights bytes scanned, six
  metric filters and alarms, SNS delivery, and one 512 MiB shared-cpu Fly
  Machine can incur charges. Estimate monthly cost as measured ingested GB plus
  average retained GB plus expected query scans at the current regional rates.
  Retention and the 256 MiB shipper buffer are hard-bounded; ingestion spend is
  not. Set an account budget before apply if a hard operator notification is
  required, because silently rate-limiting the shipper would lose evidence.
- Search cost scales with bytes scanned. Prefer narrow time ranges and filters
  on `app`, `machine_id`, `request_id`, `tenant`, or `alert_kind`.
- Reducing `retention_days` makes older events eligible for provider deletion;
  increasing it increases stored volume. Neither action changes the 256 MiB
  shipper buffer.
- `terraform destroy` deletes the CloudWatch log group and retained incident
  history. Export required evidence first. Stop the Fly shipper and delete its
  IAM access key before destroying the IAM user.
- Credential rotation is: create a replacement IAM key, update the two Fly
  secrets, verify ingestion, then delete the old key. Never keep two active
  keys longer than the verification window.

## Alert semantics

Vector classifies forced exits, repeated required-health failures, OOM exits,
panics, persistent provider unavailability, and actor-job failures. Immediate
conditions alarm on the first event. Provider unavailability alarms at five
events in ten minutes. Actor-job alarms fire only after the durable queue update
has succeeded and the job has entered `dead`, either because its attempt budget
was exhausted or its provider route was terminal.
