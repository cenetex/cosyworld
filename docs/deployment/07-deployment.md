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
fly secrets set COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER=...
fly secrets set COSYWORLD_MODERATION_TOKEN=...
```

Before enabling production Box burns, set the chain verifier secrets:

```bash
fly secrets set COSYWORLD_BOX_BURN_SOLANA_RPC_URL=...
fly secrets set COSYWORLD_BOX_CORE_COLLECTION_ADDRESS=...
```

The Fly config runs with `COSYWORLD_DEPLOY_PROFILE=production`, persistent `/data` storage, the SQLite event journal, and the protected Ruby High ownership feed.

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
- **V2 Production:** `COSYWORLD_DEPLOY_PROFILE=production`, `COSYWORLD_RUBY_HIGH_WALLET_CARDS_URL`, `COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER`, `COSYWORLD_MODERATION_TOKEN`
- **V2 Passkeys:** `COSYWORLD_WEBAUTHN_RP_ID`, `COSYWORLD_WEBAUTHN_ORIGIN`, and optional comma-separated `COSYWORLD_WEBAUTHN_EXTRA_ORIGINS`. Production refuses to boot without the RP ID and origin.
- **V2 Box Burns:** `COSYWORLD_BOX_BURN_SOLANA_RPC_URL`, `COSYWORLD_BOX_CORE_COLLECTION_ADDRESS`; until these are configured, production Box burn endpoints stay closed.
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

## Monitoring

- V2 health endpoints: `/health`, `/meta`
- Node companion runtime discovery: `/api/runtime`
- Logs: platform logs or `/logs/` for legacy Node deployments

---

## Backups

- SQLite database file backups daily
- `.env` backups
- Automate with cron

---

## Scaling Tips

- Attach a persistent volume for SQLite and keep exactly one production task.
- Multiple app instances require exact per-process routes and the remaining
  hot-room migration/process-loss gate in #130. A load balancer alone is unsafe.
- Redis cache
- Containerize with Docker/Kubernetes
