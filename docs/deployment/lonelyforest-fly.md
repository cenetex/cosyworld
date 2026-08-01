# Lonely Forest on Fly

The Lonely Forest domains run in one Fly application and one Machine, with one
mounted volume. Nginx maps an exact hostname allowlist to isolated CosyWorld
processes; each worldpack has its own SQLite journal directory on that volume.

| Domain | Registry and entry | Process | Journal |
| --- | --- | --- | --- |
| `lonelyforest.com` | Official manifest entry | Root, `3100` | `/data/cosyworld-v2-events.sqlite` |
| `0.lonelyforest.com` | Elysium, Void 001 (`652000`) | Elysium, `3101` | `/data/worldpacks/0/events.sqlite` |
| `7.lonelyforest.com` | Bethlehem (`700`) | Bethlehem, `3107` | `/data/worldpacks/7/events.sqlite` |
| `89.lonelyforest.com` | Project 89, Threshold Interface (`8900`) | Project 89, `3189` | `/data/worldpacks/89/events.sqlite` |
| `lantern.lonelyforest.com` | Lantern Keeper, Wayside Lantern Inn (`800`) | Lantern Keeper, `3180` | `/data/worldpacks/lantern/events.sqlite` |

The orchestrator remains one authoritative world per process and is not allowed
to select a journal from an untrusted `Host` or `X-Forwarded-Host` header.
Adding a tenant requires an explicit process, data directory, and nginx hostname
mapping in the committed release.

Accounts, avatars, sessions, world events, snapshots, and generated assets stay
isolated between processes even though all passkeys use the parent RP ID
`lonelyforest.com`. `COSYWORLD_ENTRY_LOCATION_ID` is a deployment-only starting
threshold: startup rejects an entry outside the selected registry and never
rewrites the compiled manifest or bundle identity.

## Runtime layout

- `fly.lonelyforest.toml` defines the single Machine, process group, and volume.
- `deploy/lonelyforest/run-multitenant.sh` assigns fixed registries, ports, and
  data directories, and restarts a failed world without changing another
  world's journal.
- `deploy/lonelyforest/nginx.conf` maps only the committed hostname allowlist;
  unknown public hosts return HTTP `421`.
- `deploy/lonelyforest/proxy-headers.conf` preserves streaming HTTP and SSE
  behavior without letting forwarded host values select runtime state.
- The root `/health` readiness check verifies the root event store and every
  required sibling process. Elysium is included only when its registry is
  installed; `/health/live` remains a lightweight process-liveness check.
- The image entrypoint repairs ownership on the mounted `/data` volume before
  dropping to the unprivileged `cosyworld` user. Nginx and all orchestrators
  therefore run without root while retaining access to their volume paths.

Nginx is the only public listener, on port `3000`; every CosyWorld process binds
to loopback. The Machine has four shared CPUs and 2 GB of memory. It remains one
failure and deploy boundary, while the short canonical lease TTL bounds write
fencing when an individual process restarts.

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
implicitly touching Lonely Forest. Both jobs first pass the real v2 Node,
worldpack, C-kernel, Rust, and routing-contract checks in the shared
production gate. The Lonely Forest job validates its multitenant contract
again before it invokes Fly.

Immediately before each deploy, `scripts/backup-fly-v2.sh` resolves the exact
configured volume (`cosyworld_data` or `lonelyforest_data`), requires one
attached volume, requests an on-demand Fly snapshot, and waits for that
specific snapshot to reach `created`. The script is fail-closed and does not
detach, replace, or destroy a volume. The resulting snapshot ID is printed in
the workflow log for the rollback operator.

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
5. Add Fly certificates for `lonelyforest.com`, `www.lonelyforest.com`, `0`,
   `7`, `89`, and `lantern`. Populate `fly_dns_validation_id` and
   `worldpack_fly_hosts` with any delegated validation IDs before traffic
   moves.
6. Put the Fly IPv4 and IPv6 addresses in
   `infra/aws-lonely-forest/deployment.auto.tfvars`, run `terraform plan`, and
   apply the Route 53 change.
7. Run `npm run v2:lonelyforest:smoke -- --base-url=https://lonelyforest.com
   --expect-elysium --allow-remote-mutations`, then verify `/health`, `/meta`, `/world`,
   the expected entry location, passkey registration, generated assets, and SSE
   reconnect through every hostname.
8. Set the rollback ECS service's `desired_count` to `0` only after the Fly
   world cursor and store identity match the selected migration source.

Route 53 and `lonelyforestlibrary.com` remain managed by the AWS Terraform
module. The unused ECS/EFS/ALB resources are retained for a short rollback
window and removed in a separate, reviewed destroy after the Fly deployment is
stable.

The release smoke requires snapshot and event-store persistence to report
healthy with no pending or failed writes. It exercises every installed tenant,
including Elysium when its compiled registry is present, and confirms that an
unknown hostname returns HTTP 421. A Fly volume snapshot is crash-consistent;
restore it into a new volume during a quiesced, reviewed recovery procedure.
Never attach a restored copy as a second writable authority or overwrite the
active volume while its process is running.

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
