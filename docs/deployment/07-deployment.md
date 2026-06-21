# CosyWorld Deployment Guide

---

## Runtime Roles

CosyWorld 2.0 is the canonical player runtime. Deploy the V2 orchestrator in `v2/orchestrator-rust` as the game service and route player traffic to it. The root `Dockerfile` and `fly.toml` build and run this V2 runtime.

The Node service remains the companion service for admin pages, auth, integrations, AI/provider configuration, migration utilities, and legacy experiments. If it is exposed, configure it with `COSYWORLD_V2_PUBLIC_URL` so its launch bridge can point at the deployed V2 shard.

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
fly secrets set COSYWORLD_BOX_BURN_SOLANA_RPC_URL=...
fly secrets set COSYWORLD_BOX_CORE_COLLECTION_ADDRESS=...
```

The Fly config runs with `COSYWORLD_DEPLOY_PROFILE=production`, persistent `/data` storage, the SQLite event journal, and the protected Ruby High ownership feed.

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
- **V2 Production:** `COSYWORLD_DEPLOY_PROFILE=production`, `COSYWORLD_RUBY_HIGH_WALLET_CARDS_URL`, `COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER`, `COSYWORLD_MODERATION_TOKEN`, `COSYWORLD_BOX_BURN_SOLANA_RPC_URL`, `COSYWORLD_BOX_CORE_COLLECTION_ADDRESS`

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

- Attach a persistent volume for SQLite, or select an external database backend for multi-writer deployments
- Multiple app instances + load balancer
- Redis cache
- Containerize with Docker/Kubernetes
