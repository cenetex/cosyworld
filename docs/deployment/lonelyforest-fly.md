# Lonely Forest on Fly

`lonelyforest.com` runs the card table from one Fly application, one Machine,
one mounted volume, and one CosyWorld process. The process listens directly on
port `3000`; there is no proxy in front of it.

| Domain                                     | Process identity    | Journal                            |
| ------------------------------------------ | ------------------- | ---------------------------------- |
| `lonelyforest.com`, `www.lonelyforest.com` | `lonelyforest-root` | `/data/cosyworld-v2-events.sqlite` |

The subdomain worlds (`0`, `7`, `89`, `lantern`, `hoppycat`) were retired on
2026-10-26, and the root app's `/classic` page was retired with #1652. The former
subdomain journals and generated assets remain on the volume under
`/data/worldpacks/<slug>/` as an archive.

The process and shard identity stay `lonelyforest-root`, the value the former
multitenant supervisor assigned, because the journal's leases are keyed to it.

## Runtime layout

- `fly.lonelyforest.toml` defines the Machine, the process, its environment,
  and the volume.
- Both production apps use the bundled card policy in shadow mode with
  `top_k=3`. Their Fly configuration records the model path and rollout mode
  checked by the live readiness gate.
- The image entrypoint repairs ownership on the mounted `/data` volume, then
  runs the orchestrator as the unprivileged `cosyworld` user.
- Graceful shutdown drains HTTP for `COSYWORLD_SHUTDOWN_DRAIN_MS` (three
  seconds), then writes the final snapshot, inside Fly's five-second
  escalation.

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
implicitly touching Lonely Forest. For tags and dispatches, both jobs first
pass the real v2 Node, worldpack, C-kernel, and Rust checks in the shared
production gate. A push to `main` skips that gate and the primary backup and
deploys `.dev` as soon as its image is built. The Rust gate reuses CI's `Rust build and tests` and
`Rust architecture and lint` results for the same commit through
`scripts/await-ci-rust.mjs`: it waits while they run, and runs the checks
itself when CI did not run them, was cancelled, or failed. The Rust tests and
the Rust architecture and lint checks run as two jobs side by side, so lint no
longer waits for the tests.

Each app's release runs as three jobs. The image job builds and pushes
`registry.fly.io/<app>:deploy-<sha>` with `--build-only` while the gates run;
it never touches the running app. Each app builds its own image with its own
token, because an app-scoped token cannot deploy the other app's image. Once
the gates pass, the backup job runs the volume and worldpack guards and takes
the rollback snapshot, while the image may still be building. The deploy job
waits for both and then rolls out the pushed image with `--image`.

After the gates pass, and before each deploy, `scripts/backup-fly-v2.sh` resolves the exact
configured volume (`cosyworld_data` or `lonelyforest_data`), requires one
attached volume, requests an on-demand Fly snapshot, and waits for that
specific snapshot to reach `created`. The script is fail-closed and does not
detach, replace, or destroy a volume. The resulting snapshot ID is printed in
the workflow log for the rollback operator. The default wait is ten minutes:
Fly may accept a snapshot and leave it in `waiting` or `running` for several
minutes during transient queueing, but a snapshot that never reaches `created`
still blocks the deploy.

Before Fly replaces the image, the Lonely Forest job runs
`v2/scripts/check-deploy-worldpack.mjs https://lonelyforest.com`, the same
bundle-identity guard as the primary app. It compares the live `/meta` hash
with the candidate registry using the exact-match or explicitly declared
replay-compatible migration rule, and stops the release on a mismatch.

### Recovery when the app is already unavailable

Do not bypass the guard and do not blindly redeploy the previous image. A
successful forward boot may have written a snapshot under the new bundle hash;
the older image will then fail its own bundle-identity check.

Save the last observed `/meta` response as a reviewed, committed capture file
and pass its path in the workflow's `lonelyforest_recovery_capture` input. The
guard evaluates the captured hash exactly like a live one. See the capture
format in `v2/scripts/check-deploy-worldpack.mjs`.

The workflow requires two GitHub Actions secrets:

```text
FLY_API_TOKEN
FLY_LONELYFOREST_API_TOKEN
```

Each secret should be scoped to its corresponding Fly app. An organization-wide
token is unnecessary.

The Lonely Forest app requires these independently provisioned secrets:

```text
COSYWORLD_MODERATION_TOKEN
OPENROUTER_API_KEY
COSYWORLD_REPLICATE_API_TOKEN
REPLICATE_API_TOKEN
```

Linked-avatar discovery needs a Solana DAS endpoint (`COSYWORLD_HELIUS_RPC_URL`
or `HELIUS_API_KEY`); ordinary play does not depend on it. Optional model aliases may be copied when
those features are enabled. Secret values must never enter the repository or
command output.

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

## Card table

`COSYWORLD_PRIMARY_GAME=cards` serves the card table at `/`. The release
embeds its HTML, modules, styles, and images under `/card-game/`. Run
`node v2/scripts/smoke-deployed-card-game.mjs https://lonelyforest.com` to
compare the public files with a local release checkout.
