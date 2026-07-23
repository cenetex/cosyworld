# Lonely Forest on Fly

`lonelyforest.com` runs from the same source revision as the primary
`cosyworld` Fly app, but it has its own Fly application, image build, and
persistent volume:

| Domain | Fly app | Volume | WebAuthn RP ID |
| --- | --- | --- | --- |
| `cosyworld.fly.dev` | `cosyworld` | `cosyworld_data` | `cosyworld.fly.dev` |
| `lonelyforest.com` | `cosyworld-lonelyforest` | `lonelyforest_data` | `lonelyforest.com` |

This is deployment-level isolation. The orchestrator remains one authoritative
world per process and is not allowed to select a journal from an untrusted
`Host` or `X-Forwarded-Host` header. Adding another domain tenant means adding
another Fly app, volume, passkey configuration, and explicit deployment target.

## Continuous deployment

`.github/workflows/deploy.yml` builds and deploys `fly.toml` first. It then
performs a separate remote build from the same checked-out revision using
`fly.lonelyforest.toml`. A successful workflow therefore proves both apps
accepted the same source revision. The separate builds let each deployment use
an app-scoped Fly token; an app-scoped Lonely Forest token cannot pull a private
image owned by the primary app's registry.

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
3. Build and deploy the current source revision with
   `fly.lonelyforest.toml` using the Lonely Forest app-scoped token.
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
