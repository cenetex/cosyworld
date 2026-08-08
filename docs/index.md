# CosyWorld Documentation

CosyWorld V2 is the current product and runtime. Start with the documents below;
older Node/Discord/X/Telegram service notes are retained as a legacy archive and
do not define V2 behavior.

## Product and design

- **[The CosyWorld Pact](cosyworld-pact.md)** — the promises CosyWorld makes
  about shared truth, sanctuary, honest choices, discovery, return, AI
  authority, progression, and player boundaries.
- **[A Traveler's Guide To CosyWorld](travelers-guide.md)** — the concise
  player guide to the action hand, Callings, Friends, discovery, scouting,
  thresholds, rest, the six-function tale rhythm, and what is still direction.
- **[The CosyWorld Referee's Guide](dm-guide/README.md)** — source and build
  instructions for the illustrated guide to scenes, discovery, frontier
  forays, thresholds, tables, and strict AI refereeing.
- **[How to Design a Worldpack](worldpacks/how-to-design-a-worldpack.md)** —
  tentative design method for authored boundaries, world graphs, characters,
  factions, economies, special items, dynamic evolution, and validation.
- **[Project 89 Systems Study](worldpacks/project-89-systems-study.md)** —
  first-pass map, faction, actor, economy, item, and simulation graphs for the
  three-ring Project 89 pack.
- **[Project 89 Content Review](worldpacks/project-89-content-review.md)** —
  consolidated story, avatar, resident, faction, item, location, map, and
  relationship review, including the Signal Anchor contract.
- **[Product Requirements](../PRD.md)** — current product law, including the
  card-composed world, seventh-visit priority, and acceptance criteria.
- **[SRD-Backed Action and Collectible System](systems/04-action-system.md)** —
  card zones, scene composition, action offers, skill charms, weapons, spells,
  and rules/pack authority.
- **[CosyWorld RPG System Bible](systems/09-cosyworld-rpg-system.md)** —
  Callings, Bonds, Clocks, Jobs, Fronts, Covenants, the Visit Ledger, and
  progression invariants.
- **[ADR 0005: Thresholds, Trails, and the Strict Referee](decisions/0005-thresholds-trails-and-strict-referee.md)** —
  topology/legibility/access/safety ownership, discovery procedures, table
  authority, Anchor/foray law, and migration compatibility.
- **[Economy](../ECONOMY.md)** — Orbs, Boxes, packs, provenance, and the optional
  NFT bridge.
- **[AI](../AI.md)** — inference, payer modes, media, and the boundary between AI
  proposals and authoritative world state.

## Implementation and operations

- **[Repository map](../readme.md)** and **[V2 runtime guide](../v2/README.md)**
  — setup, commands, architecture, and local operation.
- **[Engineering direction](../ENG.md)** — architecture priorities, the
  non-negotiable invariants, and the current engineering queue.
- **[Rules adapter](../v2/docs/rules-adapter.md)** — immutable reference imports,
  the active `cosyworld.srd5/1` profile, and the resolver authority boundary.
- **[Worldpacks](../v2/docs/worldpacks.md)** — pack compilation, composition,
  validation, and inspection.
- **[Action-pack authoring](../v2/docs/action-pack-authoring.md)** — reskins,
  contextual offers, justified variants/extensions, and playable Item cards.
- **[Avatar transfer consent](transfer-consent.md)** — direct-player gift and
  trade authorization, single-use gift requests, and mute/block/report controls.
- **[Emergent actor practices](actor-practices.md)** — durable deeds,
  incremental delivery evidence, and scoreless identities earned from play.
- **[Authoritative quest clocks](authoritative-quest-clocks.md)** — named
  contribution strategies, causal evidence, narrated thresholds, and replay
  compatibility.
- **[Shared clock presentation](shared-clock-presentation.md)** — story-shaped
  questions, bounded attention, coherent receipts, accessible transports, and
  client-confirmed exposure.
- **[Natural affordances](natural-affordances.md)** — typed environment
  profiles, deterministic latent resources, shared investigation, and bounded
  building eligibility.
- **[Scene concurrency policy](concurrency-policy.md)** — asynchronous
  co-present play, target conflict handling, and explicitly ordered scenes.
- **[Deck-gated action spike](../v2/docs/deck-gated-action-spike.md)** — the
  measured, non-shipping alternative to the default projection hand.
- **[World simulation](../v2/docs/world-simulation.md)**,
  **[combat](../v2/docs/combat-system.md)**, and
  **[writing style](../v2/docs/writing-style.md)** — focused runtime contracts.
- **[Deployment](deployment/07-deployment.md)** and
  **[release process](release.md)** — operating and shipping the repository.

## Planning documents

- **[Card-Composed Character Creation](backlog/card-composed-character-creation.md)** —
  account-owned Species, Class, and Origin cards, classless level-zero arrival,
  first-action Class reveal, world discovery, new-tale lifecycle, and migration
  from compound campaign choices.
- **[SRD Action-Card Foundation](backlog/srd-action-card-foundation.md)** —
  dependency-ordered work for rules-bound cards, authoritative zones, scene
  composition, loadouts, and pack extensions.
- **[Fiction Frontier](backlog/fiction-frontier.md)** — authored transcript
  coverage, client-confirmed beat exposure, and prose-quality gates.
- **[Player Journal as a Semantic Chronicle](backlog/player-journal-semantic-chronicle.md)** —
  deterministic story-beat projection, causal event grouping, consistent
  player copy, and truthful disclosure behaviour.
- **[Seventh-Visit Operating Queue](backlog/seventh-visit-operating-queue.md)** —
  the bounded production-trust, authority, and first-campaign delivery waves,
  with portfolio gates and backlog-state rules.
- **[Holy Land Integration Playtest](backlog/holy-land-integration-playtest.md)** —
  legal-action reachability, generated pilgrimage-road presentation, and
  direct-avatar continuity boundaries found in the first end-to-end journey.
- **[Thresholds, Trails, and the Strict Referee](backlog/thresholds-trails-and-strict-referee.md)** —
  dependency-ordered Discovery Slot, Lead, Gate, Hazard, Pressure, trail, and
  recovery work following ADR 0005, with per-slice scope and acceptance for
  everything that has not shipped.
- **[Rest, Travel, and Weariness](backlog/rest-travel-and-weariness.md)** —
  graded recovery, expedition Fatigue, short-rest cadence and the Spent
  survival hand, prepared frontier camps, and recovery reachability.
- **[Quest Grammar and Return](backlog/quest-grammar-and-return.md)** —
  the code-to-vision diagnosis and dependency-ordered foundation for Hearth,
  Sign, Venture, Challenge, Discover, and Return across avatars, items, and
  locations.
- **[World Topology and Composition Joins](backlog/world-topology-and-composition-joins.md)** —
  the cross-pack `routes` primitive, pack gateways, open/gated/earned access,
  reachability and sink gates, pack-native generated descendants, the Holy Land
  regional mesh, and the playtest evidence that motivated them.
- **[Avatar Lifecycle and the Rescue Run](backlog/avatar-lifecycle-and-rescue.md)** —
  controller-neutral lifecycle from presence through Death or Return, the birth
  draught, the two-body cascade, carrying downed bodies, and Fading paused in
  sanctuary.
- **[Combat, Encounters, and Range](backlog/combat-encounters-and-range.md)** —
  chat-first combat, the avatar-rail encounter tracker, the unresolved fate-tag
  decision, and the three-band range protocol.
- **[Community Art Evolution](backlog/community-art-evolution.md)** — pooled
  Orb funding, immutable reference assets, bounded scene composition, the
  per-generation publication gate, and the unexplored art lifecycle.

## How design and execution are split

**Planning lives in markdown. Immediate work lives in GitHub Issues.**

- Planning documents own product rationale, durable contracts, invariants,
  architectural shape, sequencing constraints, and possible future horizons.
  They are not a second execution queue.
- A GitHub issue owns every immediate implementation slice: its current scope,
  acceptance checklist, dependencies, delivery labels, milestone, and status.
  If someone could pick the work up now, track it in an issue and link back to
  the relevant planning section instead of duplicating the checklist here.
- An active issue carries a milestone and exactly one priority, horizon, and
  state label. Work without those fields is not in the delivery queue.
- `state:parked` and `horizon:later` are not a filing system for design. If work
  is not being done, its thinking belongs in a planning document and the issue
  should close with a pointer to that section.
- Closing an issue into a document is not cancellation. The design survives; the
  queue stops pretending it is scheduled.
- When work lands, close the issue and update the canonical product or system
  documentation. Keep the planning document only for rationale and work that
  has not yet been activated.

## Legacy service archive

The following documents describe the original `src/` service or historical
experiments. They are useful implementation history, but V2 code and the
current PRD take precedence:

- [Legacy service overview](overview/01-introduction.md)
- [Legacy system overview](overview/02-system-overview.md)
- [Legacy service documentation](services/)
- [Deployment guide](deployment/07-deployment.md)

Last reviewed: 2026-07-30.
