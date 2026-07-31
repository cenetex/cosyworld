# Lonely Forest on Fly

The Lonely Forest domains run in one Fly application and one Machine, with one
mounted volume. Nginx maps an exact hostname allowlist to isolated CosyWorld
processes; each worldpack has its own SQLite journal directory on that volume.

| Domain | Worldpack | Journal |
| --- | --- | --- |
| `lonelyforest.com` | Official | `/data/cosyworld-v2-events.sqlite` |
| `0.lonelyforest.com` | Elysium | `/data/worldpacks/0/events.sqlite` |
| `7.lonelyforest.com` | Bethlehem | `/data/worldpacks/7/events.sqlite` |
| `89.lonelyforest.com` | Project 89 | `/data/worldpacks/89/events.sqlite` |
| `lantern.lonelyforest.com` | Lantern Keeper | `/data/worldpacks/lantern/events.sqlite` |

The orchestrator remains one authoritative world per process and is not allowed
to select a journal from an untrusted `Host` or `X-Forwarded-Host` header.
Adding a tenant requires an explicit process, data directory, and nginx hostname
mapping in the committed release.

## Continuous deployment

`.github/workflows/deploy.yml` is the production release authority. The primary
app may deploy from a push to `main`. Lonely Forest intentionally does **not**:
it deploys only from a committed `v*` tag or an explicit `workflow_dispatch`
whose target is `lonelyforest` or `both`.

Do not run `flyctl deploy` for production from a dirty worktree. A local deploy
has no durable source revision and can be replaced by the next automation run.
Test local builds locally, commit and merge the complete release, and then use a
tag or the manual GitHub workflow. Keep the Lonely Forest deploy token scoped to
the app and stored only in GitHub Actions. Configure required reviewers and
allowed deployment refs on the `lonelyforest-production` GitHub environment so
manual production dispatches receive an approval gate.

The separate jobs and app-scoped tokens prevent a primary-app release from
implicitly touching Lonely Forest. The Lonely Forest job validates the
multitenant contract before it invokes Fly.

The workflow requires two GitHub Actions secrets:

```text
FLY_API_TOKEN
FLY_LONELYFOREST_API_TOKEN
```

Each secret should be scoped to its corresponding Fly app. An organization-wide
token is unnecessary.

The Lonely Forest app requires these independently provisioned secrets:

```text
COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER
COSYWORLD_MODERATION_TOKEN
OPENROUTER_API_KEY
COSYWORLD_REPLICATE_API_TOKEN
REPLICATE_API_TOKEN
```

Optional model aliases and Box-verifier secrets may be copied when those
features are enabled. Secret values must never enter the repository or command
output.

## Provisioning and cutover

1. Create `cosyworld-lonelyforest` and a 1 GB encrypted
   `lonelyforest_data` volume in `sjc`.
2. Provision the production secrets without deploying a machine.
3. Commit and merge the complete source revision, then deploy it through the
   tagged or manually dispatched GitHub workflow.
4. Restore the selected Lonely Forest SQLite journal and generated assets to
   the new volume before making the app writable to public traffic.
5. Add Fly certificates for `lonelyforest.com` and
   `www.lonelyforest.com`, then populate `fly_dns_validation_id` so Terraform
   can issue both certificates before traffic moves.
6. Put the Fly IPv4 and IPv6 addresses in
   `infra/aws-lonely-forest/deployment.auto.tfvars`, run `terraform plan`, and
   apply the Route 53 change.
7. Verify `/health`, `/meta`, `/world`, passkey registration, generated assets,
   and SSE reconnect through both hostnames.
8. Set the rollback ECS service's `desired_count` to `0` only after the Fly
   world cursor and store identity match the selected migration source.

Route 53 and `lonelyforestlibrary.com` remain managed by the AWS Terraform
module. The unused ECS/EFS/ALB resources are retained for a short rollback
window and removed in a separate, reviewed destroy after the Fly deployment is
stable.

## Data authority

Never merge two independently writable journals. Record the source and target
`/meta.deployment.canonical_store_id` and `/world.world_seq`, quiesce the source
writer, copy one consistent SQLite backup, then verify the same values before
DNS changes. If the existing AWS and Fly histories differ, an operator must
select one authority; a higher event sequence alone does not make histories
mergeable.

Passkeys are scoped to their relying-party domain. Restoring the Lonely Forest
account tables to the Lonely Forest app preserves its domain credentials; those
credentials do not authenticate at `cosyworld.fly.dev`.
