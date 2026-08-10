# CosyWorld Deployment Guide

---

## Runtime Roles

CosyWorld 2.0 is the canonical player runtime. Deploy the V2 orchestrator in `v2/orchestrator-rust` as the game service and route player traffic to it. The root `Dockerfile` and `fly.toml` build and run this V2 runtime.

The Node service remains the companion service for admin pages, auth, integrations, AI/provider configuration, migration utilities, and legacy experiments. If it is exposed, configure it with `COSYWORLD_V2_PUBLIC_URL` so its launch bridge can point at the deployed V2 world service.

The official product has one canonical world. A process, AWS task, Fly machine,
region, or room owner is capacity infrastructure and must not create a separate
player history. The current SQLite deployment is intentionally one production
task. Identity, durable journal, fencing, routing, presence fan-out, invite
rendezvous, and the pinned two-process convergence harness are complete. Before
increasing instance count, pass the hot-room migration and failover gates in
[`../../v2/docs/canonical-world.md`](../../v2/docs/canonical-world.md). Never put
multiple isolated SQLite saves behind a load balancer.

Local defaults:

```bash
npm run dev
```

This starts the V2 browser MVP. To run the legacy Node service explicitly:

```bash
npm run dev:node
```

Use `npm run check` for the fast CI gate and `npm run check:local` for the full local V2 browser smoke.

Production routing should make the V2 orchestrator the public game entrypoint. If the Node web service is also exposed, its root page should be treated as a launch bridge, and the old Node chat prototype should remain under `/legacy/cosyworld`.

### V2-Only Player Deployment

Use this when the public app is just the game:

```bash
fly deploy
```

Before the production machine boots, set the required secrets:

```bash
fly secrets set COSYWORLD_AVATAR_OWNERSHIP_FEED_BEARER=...
fly secrets set COSYWORLD_MODERATION_TOKEN=...
```

The Fly config runs with `COSYWORLD_DEPLOY_PROFILE=production`, persistent
`/data` storage, and the SQLite event journal. The protected linked-avatar feed
is optional; ordinary play boots without it.

Passkey authentication also requires an exact WebAuthn relying-party configuration. The RP ID is the deployment hostname without a scheme; the origin is the public HTTPS origin:

```bash
COSYWORLD_WEBAUTHN_RP_ID=play.example.com
COSYWORLD_WEBAUTHN_ORIGIN=https://play.example.com
COSYWORLD_WEBAUTHN_EXTRA_ORIGINS=https://www.play.example.com
```

Passkeys are domain-scoped. Deployments on unrelated hostnames do not share passkeys even if they share application code.

### Node Companion + V2 Game Deployment

Use this when the Node admin/integration service is also public. Deploy V2 as the game service, then set the Node service to discover it:

```bash
COSYWORLD_V2_PUBLIC_URL=https://play.example.com
COSYWORLD_V2_GAME_URL=https://play.example.com
```

The Node endpoint `GET /api/runtime` returns the active V2 URLs, and the launch bridge reads that endpoint before linking players to V2.

---

## Environment Variables

Create a `.env` file with:

- **Core:** `NODE_ENV`, `API_URL`, `PUBLIC_URL`, `COSYWORLD_V2_PUBLIC_URL`
- **Database:** `DATA_BACKEND=sqlite`, `SQLITE_DB_PATH`
- **AI:** `OPENROUTER_API_TOKEN`, `REPLICATE_API_TOKEN`, `GOOGLE_AI_API_KEY`
- **Storage:** `S3_API_ENDPOINT`, `S3_API_KEY`, `S3_API_SECRET`, `CLOUDFRONT_DOMAIN`
- **Discord:** `DISCORD_BOT_TOKEN`
- **Performance:** `MEMORY_CACHE_SIZE`, `MAX_CONCURRENT_REQUESTS`
- **V2 Production:** `COSYWORLD_DEPLOY_PROFILE=production`, `COSYWORLD_MODERATION_TOKEN`, and optional `COSYWORLD_AVATAR_OWNERSHIP_FEED_URL` plus `COSYWORLD_AVATAR_OWNERSHIP_FEED_BEARER` for linked-avatar discovery.
- **V2 Passkeys:** `COSYWORLD_WEBAUTHN_RP_ID`, `COSYWORLD_WEBAUTHN_ORIGIN`, and optional comma-separated `COSYWORLD_WEBAUTHN_EXTRA_ORIGINS`. Production refuses to boot without the RP ID and origin.
- **V2 Process Label:** `COSYWORLD_PROCESS_ID` is the unique replaceable process
  label shown in `/meta`. `COSYWORLD_V2_SHARD_ID` remains a matching legacy
  alias during migration. Neither may be used as a world, room, actor,
  invitation, claim, or save namespace.
- **V2 Capacity Routing:** `COSYWORLD_CANONICAL_ROUTE_URL` and
  `COSYWORLD_CANONICAL_ROUTER_TOKEN` are optional but must be set together. The
  URL must target that exact process rather than the shared player load
  balancer; the token must be a secret of at least 16 characters. Keep both
  unset while AWS/Fly remains at one task/machine.

---

## Database Setup

- SQLite is the default deployment backend.
- For Fly, mount `/data` and set `SQLITE_DB_PATH=/data/cosyworld.sqlite`.
- Run `npm run deploy:setup-db` to apply SQLite schema migrations.
- MongoDB can be selected explicitly with `DATA_BACKEND=mongo` for migration or compatibility deployments.

### Retiring legacy item materialization

The item collectible bridge is an archived, read-only compatibility surface.
There is no materialize or return mutation route.

On boot, after snapshot or journal replay and before accepting traffic, the V2
runtime deterministically classifies every legacy item receipt. It writes one
versioned migration receipt for each non-avatar receipt:

- a valid active receipt preserves the existing kernel item and snapshots its
  exact holder, location, zone, container/equipment state, mechanics, and
  provenance as `preserved_ordinary_world_item`;
- an item already returned to Collection is recorded as
  `archived_collection_return`;
- a missing active item, duplicate claim, malformed record, or ambiguous
  same-actor/card claim is `quarantined`. Conversion never creates, deletes, or
  chooses an item for these records;
- the allowlisted linked-avatar actor receipt is excluded and continues through
  its dedicated adapter.

Inspect `GET /meta` at the release boundary. Under
`migration_archive.item_materialization.receipts`, `migration_receipts` must equal the sum of
`preserved_ordinary_world_items`, `archived_collection_returns`, and
`quarantined`. Review every non-zero quarantine count against the preserved
legacy receipt coordinates before continuing removal work.

Migration receipts and their legacy wallet/card/receipt coordinates are
snapshot state and read-only audit evidence. Restart or journal-only recovery
derives the same result; a later snapshot retains the original migration-point
item evidence even if ordinary play subsequently trades, drops, equips, or
contains the item. Repeated migration is a no-op. Boot fails closed if a stored
migration receipt no longer matches its retained legacy coordinates or typed
outcome.

No player return request is accepted. Do not remove this audit state until a
separate retention policy explicitly authorizes deletion.

---

## Server Requirements

- Node.js 18+ LTS
- 4+ CPU cores, 8GB+ RAM, 50GB+ SSD
- Set memory limit:
```bash
NODE_OPTIONS="--max-old-space-size=4096"
```

---

## Production Setup

- Use **Nginx** as reverse proxy
- Use **systemd** for service management
- Example configs in `/config/`

---

## Rate Limits

- AI calls: 5 per avatar/min
- Image gen: 2 per avatar/hour
- Avatar creation: 3 per user/day

---

## Recovery when the primary app is already unavailable

The pre-deploy bundle gate reads the live `/meta` and fails closed, which is
correct for a stale-checkout deploy but deadlocks the case that matters most:
`cosyworld.fly.dev` is unreachable *because* it needs the deploy. That blocked
recovery twice — the failed v557 release on 2026-08-05 and again on 2026-08-07,
a ~2.5 day outage.

Do not bypass the guard and do not blank a persisted bundle hash.

1. Obtain the app's persisted identity from the running process or its volume.
   The orchestrator serves `/meta` internally even while the Fly proxy has
   removed the machine from rotation, so
   `fly ssh console --app cosyworld -C "curl -s http://127.0.0.1:3000/meta"`
   usually still works. Never infer the hash from the candidate image.
2. Store a capture with this exact shape and review it with the recovery change:

   ```json
   {
     "schema_version": 1,
     "source": "app-volume",
     "captured_at": "2026-08-07T18:40:00Z",
     "meta": { "worldpack": { "bundle_hash": "sha256:<64 lowercase hex>" } }
   }
   ```

   `source` may instead be `operator-capture`, but it must still contain the
   unmodified observed `/meta` identity and a reviewable timestamp. The capture
   must be committed: the guard refuses an untracked file or any path outside
   the checkout.
3. Run `Deploy` via `workflow_dispatch` with `target: primary` and
   `primary_recovery_capture` set to the committed capture path. The guard
   records the capture path, source, and time, then applies the normal
   exact/declaration comparison — a genuine mismatch still fails closed.
4. Preserve the workflow log and capture with the incident record, then verify
   `/meta` after recovery before the next release.

If GitHub Actions itself is unavailable, the same two steps the workflow runs
can be performed directly, and they keep the rollback snapshot:

```sh
bash scripts/backup-fly-v2.sh cosyworld primary
flyctl deploy --remote-only --config fly.toml --strategy rolling
```

---

## Monitoring

- V2 health endpoints: `/health`, `/meta`
- Node companion runtime discovery: `/api/runtime`
- Logs: platform logs or `/logs/` for legacy Node deployments
- Fly volume headroom: the scheduled `Volume headroom` GitHub Actions workflow
  checks both production `/data` mounts every 15 minutes and fails at 70% used.
  The mounts auto-extend at 80% in 1 GB increments, capped at 5 GB; the deploy
  gate remains a separate fail-closed check at 85%.

---

## Backups

- SQLite database file backups daily
- `.env` backups
- Automate with cron

---

## Scaling Tips

- Attach a persistent volume for SQLite and keep exactly one production task.
- Hot-room handoff and regional failover are covered by the #130 chaos harness,
  but multiple production instances still require exact per-task routes and a
  successful release-specific operator drill. A load balancer alone is unsafe.
- Redis cache
- Containerize with Docker/Kubernetes
