# Changelog

## 1.0.12 — 2026-08-12

- Keep an active journey's exact next Travel card in one hand slot while every
  other eligible action rotates fairly through the remaining slot.

## 1.0.11 — 2026-08-12

- Record semantic instruments as subjective, replay-safe memory lenses and
  reflective resident work as off-tick batch computation that cannot mint
  history.

## 1.0.10 — 2026-08-12

- Lock Hoppycat's pregenerated avatar and location cards as canonical local
  artwork, and add a matching ten-image set for every portable story item.

## 1.0.8 — 2026-08-12

- Declare the exact Hoppycat bundle currently deployed to Lonely Forest as
  replay-compatible with the avatar identity and naming update, preserving its
  journal and checkpoint while keeping all other bundle transitions fail-closed.

## 1.0.4 — 2026-08-12

CosyWorld 1.0 is the first stable release of the canonical V2 product: a shared,
persistent AI MUD with a deterministic rules kernel, a Rust HTTP/SSE host, and a
small card-driven browser interface.

### Stable product surface

- One canonical living world with durable SQLite actions, checkpoints, journal
  replay, reconnect convergence, and fail-closed production startup gates.
- Moderated, evidence-grounded AI characters whose public speech and generated
  images remain behind explicit publication and safety boundaries.
- The Lantern Keeper campaign, including its golden journey, Journal continuity,
  and seventh-visit memory proof.
- The Project 89 composition with playable onboarding, populated actors, durable
  progress, and the narrow optional Proxim8 linked-avatar pilot.
- The illustrated Hoppycat living archive as a dedicated Lonely Forest tenant.
- Version-locked world packs, deterministic content compilation, explicit upgrade
  compatibility, and production recovery evidence.
- Browser coverage for onboarding, card actions, persistence, failure states,
  mobile layouts, accessibility, and ordered combat.

Ordinary play remains wallet-optional. Broader wallet-linked avatar
productization and removal of legacy collectible surfaces remain explicitly
post-1.0 work; historical materialization records are retained only as read-only
audit evidence.

### Upgrade from 0.1.16

The 1.0 release changes release identity and documentation, not persisted gameplay
schema, content-engine contract, or world-pack content. The independently
versioned content-engine contract remains `0.0.373`; `/meta` reports both product
and content-engine versions. Deploy with the existing SQLite and generated asset
volumes intact. The release workflow must pass the production gate, deploy both
the primary and Lonely Forest applications, and show zero checkpoint rejections
in each live `/meta` response.

Do not treat a failed candidate image as an accepted persistence epoch. If an
upgrade needs an explicit recovery capture, follow
[`docs/deployment/07-deployment.md`](docs/deployment/07-deployment.md) and the
application-specific runbook. Recovery must preserve the accepted checkpoint and
retained journal cursor; it must not reseed or fork the canonical world.

### Release evidence

The final GitHub release and issue #533 record the immutable candidate and final
tag workflow runs, production observations, and the completed milestone evidence.
The earlier `v1.0.0-rc.1` candidate failed during image construction before any
production process was replaced; its tag remains immutable as failure evidence.
