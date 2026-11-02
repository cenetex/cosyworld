# CosyWorld Deployment Guide

## Sites and releases

| Site | Purpose | Release path |
| --- | --- | --- |
| [cosyworld.fly.dev](https://cosyworld.fly.dev/) | Testing | Game changes on `main` deploy automatically as soon as the image is built |
| [lonelyforest.com](https://lonelyforest.com/) | Production | Deliberate versioned releases |

The [Deploy workflow](../../.github/workflows/deploy.yml) owns releases.
A `v*` tag deploys both apps. A manual run selects `primary` for the testing
site, `lonelyforest` for production, or `both`. Each app has its own token,
image, compatibility checks, volume backup, and readiness checks. A push to
`main` skips the production gates and the primary backup, so `.dev` rolls out
as soon as its image is built; CI still checks the same commit.

The root [Dockerfile](../../Dockerfile) builds the Rust service.
[fly.toml](../../fly.toml) configures the testing app;
[fly.lonelyforest.toml](../../fly.lonelyforest.toml) configures production.
Both serve the card game at `/`. The card game's current saves live in the
player's browser. The Rust service supplies game files and generated dialogue.
The shared card worlds and the append-only journal use SQLite on the mounted
`/data` volume.
Lonely Forest's named worlds have their own processes and data paths; see the
[production runbook](lonelyforest-fly.md).

## Local setup

Use Node.js 24 or newer. Install dependencies and start the card game:

```sh
npm ci
npm run play:cards
```

Open <http://127.0.0.1:4177/>. The
[card game guide](../../v2/card-game/README.md#local-play) describes the Rust
text-service connection used for generated dialogue.

For the shared runtime, use a Rust toolchain, a C compiler, Python 3,
`screen`, and `lsof`, then run:

```sh
npm run dev
npm run v2:status
npm run v2:stop
```

`npm run check` runs the main code and content gate; run it by hand, since the
pre-push hook runs only `npm run check:version`. `npm run check:local`
adds the local runtime and browser checks. The full local setup also needs the
Rust `wasm32-unknown-unknown` target and the pinned SRD source described in the
[rules reference guide](../../reference-library/rpg-systems/README.md).

## Runtime settings

The Fly files and tenant manifest hold each app's runtime settings. Provision
secret values through Fly's secret store for the selected app.

- `COSYWORLD_DEPLOY_PROFILE=production` enables the deployed runtime checks.
- `COSYWORLD_MODERATION_TOKEN` protects moderation operations.
- `COSYWORLD_CREDITS_OPERATOR_TOKEN` (at least 16 characters) turns on the
  operator credit grant; unset, `/internal/credits/grant` answers 404. See
  [credits](#credits).
- `COSYWORLD_STRIPE_SECRET_KEY`, `COSYWORLD_STRIPE_PRICE_SPEECH_PACK` and
  `COSYWORLD_STRIPE_WEBHOOK_SECRET` together turn on buying speech packs with
  Stripe Checkout; with any unset, checkout and its webhook answer 404. See
  [credits](#credits).
- `COSYWORLD_V2_EVENT_DB_PATH` names the SQLite journal;
  `COSYWORLD_V2_SNAPSHOT_PATH` names its snapshot file.
- `COSYWORLD_PROCESS_ID` names the process. The compatibility setting
  `COSYWORLD_V2_SHARD_ID`, when present, must match it.
- `COSYWORLD_WEBAUTHN_RP_ID`, `COSYWORLD_WEBAUTHN_ORIGIN`, and optional
  `COSYWORLD_WEBAUTHN_EXTRA_ORIGINS` define domain-scoped passkeys for the
  shared runtime.
- `COSYWORLD_PASSKEYS` is `open` (the default) or `members`. Members mode
  refuses new passkey sign-ups and signed-out play; `.dev` uses it (see
  [release operations](../release.md)).
- `COSYWORLD_DEV_TEST_PASSKEY` (members mode only) installs the public key of
  the `agent-test` passkey that agents and CI smokes use on `.dev` (see
  [release operations](../release.md#agent-test-passkey)).
- `OPENROUTER_API_KEY` supplies the configured text provider. Image generation
  uses the configured Replicate credentials. See the
  [runtime guide](../../v2/README.md) for provider settings.
- Linked-avatar discovery reads wallet assets on chain through a Solana DAS
  endpoint: `COSYWORLD_HELIUS_RPC_URL`, or `HELIUS_API_KEY` for Helius
  mainnet. Without one, no new wallet-linked avatars join; ordinary play is
  unaffected. No other domain supplies ownership. The retired
  `COSYWORLD_AVATAR_OWNERSHIP_FEED_URL`/`_BEARER` settings are ignored
  ([#1502](https://github.com/cenetex/cosyworld/issues/1502)).

The Rust service opens and upgrades its journal during startup. Keep each
world's journal, snapshots, and generated assets together on its assigned
volume path. The [canonical-world guide](../../v2/docs/canonical-world.md)
describes the checks needed before adding writers or routing capacity.

## Historical item receipts

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


## Recover the testing app

When the testing app's live `/meta` is unavailable, use a committed capture
of its last observed bundle identity with the normal deployment guard.

1. Read the identity from the app or its volume. An internal request can work
   while Fly is waiting for readiness:

   ```sh
   fly ssh console --app cosyworld -C "curl -s http://127.0.0.1:3000/meta"
   ```

2. Save the observed identity in a committed capture:

   ```json
   {
     "schema_version": 1,
     "source": "app-volume",
     "captured_at": "2026-08-07T18:40:00Z",
     "meta": { "worldpack": { "bundle_hash": "sha256:<64 lowercase hex>" } }
   }
   ```

   Replace the example time and hash with the observed values. A saved public
   response may use `operator-capture` as its source. Keep the capture inside
   the checkout so it can be reviewed with the recovery change.

3. Run `Deploy` manually with `target: primary` and
   `primary_recovery_capture` set to that committed path. The normal bundle
   comparison and volume backup still apply.
4. Verify `/health` and `/meta` after recovery and keep the workflow log.

For production tenant recovery, follow the
[Lonely Forest runbook](lonelyforest-fly.md#recovery-when-a-tenant-is-already-unavailable).

## Monitoring and backups

The [Fly health workflow](../../.github/workflows/fly-health.yml) checks both
apps every 15 minutes. It checks memory exits, storage budgets, and volume
headroom. Volume checks report at 70% usage. Fly grows the volumes at 80% in
1 GB steps up to 5 GB; the deployment guard checks usage against 85%.

Every deployment requests a volume snapshot and waits for that exact snapshot
to reach `created`. The default wait is ten minutes. The workflow log records
the snapshot ID. Recovery keeps one active writer for each world's journal.

Use `/health` for readiness and persistence, `/health/live` for process
liveness, and `/meta` for version and bundle identity. The
[production logs guide](production-logs.md) covers retained logs, incident
queries, and the cross-app ingestion check.

## Credits

Credits belong to a passkey account. A speech pack is 100 credits; a spoken
line costs 1 and a scene video 100
([#1924](https://github.com/cenetex/cosyworld/issues/1924)). The append-only
`credit_events` table in the event store holds every grant, spend and refund;
an account's balance is their sum. `GET /card-game/credits` shows the
signed-in balance and prices.

A shared world has a credit pool in the same ledger. `POST
/card-game/credits/commit` (`{world, credits, request_id}`) writes a `commit`
row that moves credits from the account to the world, once per request id;
there is no withdrawal. A pool is its commits less its spends plus refunds. A
player of the world (seated or bound) who sends `world` with
`/card-game/speech` or `/card-game/video` spends the pool; a voiced line is
spent once per world and its clip is kept in `credit_world_clips` (newest 256
per world), and a failed call is refunded to the pool.

Until payments exist, an operator hands out packs. Each grant is a ledger row
with its note and an `operator granted credits` log line; a repeated
`request_id` grants once.

```sh
TOKEN="$(openssl rand -hex 24)"   # keep it in your password manager
fly secrets set COSYWORLD_CREDITS_OPERATOR_TOKEN="$TOKEN" --app cosyworld
curl -s -X POST https://cosyworld.fly.dev/internal/credits/grant \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"user":"USERNAME","credits":100,"request_id":"pack-USERNAME-1","note":"speech pack"}'
```

`user` takes an account id or username. The reply gives the new balance and
whether this call granted (`granted: false` for a repeated `request_id`).

### Stripe speech packs

With the three Stripe settings, Settings and an unaffordable camera show "Get a
speech pack". `POST /card-game/credits/checkout` starts a Checkout session for
one pack (the price id, quantity 1, `client_reference_id` = the passkey
account) and returns its `url`. Stripe's `checkout.session.completed` event at
`POST /internal/credits/stripe-webhook` is verified against the
`Stripe-Signature` header (HMAC-SHA256, five-minute tolerance) and, when
`payment_status` is `paid`, grants 100 credits with the Checkout session id as
the request id, so Stripe's retries grant once. `/internal/` is outside the
members-only gate, so the webhook needs no passkey session.

In the Stripe dashboard, create a one-time price for the pack and a webhook
endpoint at `https://<host>/internal/credits/stripe-webhook` for the
`checkout.session.completed` event, then:

```sh
fly secrets set --app cosyworld \
  COSYWORLD_STRIPE_SECRET_KEY="sk_live_..." \
  COSYWORLD_STRIPE_PRICE_SPEECH_PACK="price_..." \
  COSYWORLD_STRIPE_WEBHOOK_SECRET="whsec_..."
```
