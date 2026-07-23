# CosyWorld Documentation

CosyWorld V2 is the current product and runtime. Start with the documents below;
older Node/Discord/X/Telegram service notes are retained as a legacy archive and
do not define V2 behavior.

## Product and design

- **[Product Requirements](../PRD.md)** — current product law, including the
  card-composed world, seventh-visit priority, and acceptance criteria.
- **[SRD-Backed Action and Collectible System](systems/04-action-system.md)** —
  card zones, scene composition, action offers, skill charms, weapons, spells,
  and rules/pack authority.
- **[CosyWorld RPG System Bible](systems/09-cosyworld-rpg-system.md)** —
  Callings, Bonds, Clocks, Jobs, Fronts, Covenants, the Visit Ledger, and
  progression invariants.
- **[Economy](../ECONOMY.md)** — Orbs, Boxes, packs, provenance, and the optional
  NFT bridge.
- **[AI](../AI.md)** — inference, payer modes, media, and the boundary between AI
  proposals and authoritative world state.

## Implementation and operations

- **[Repository map](../readme.md)** and **[V2 runtime guide](../v2/README.md)**
  — setup, commands, architecture, and local operation.
- **[Engineering direction](../ENG.md)** and **[implementation audit](../GAP.md)**
  — architecture priorities and known gaps. Treat dated implementation counts
  in `GAP.md` as an audit snapshot, not product law.
- **[Rules adapter](../v2/docs/rules-adapter.md)** — immutable reference imports,
  the active `cosyworld.srd5/1` profile, and the resolver authority boundary.
- **[Worldpacks](../v2/docs/worldpacks.md)** — pack compilation, composition,
  validation, and inspection.
- **[Action-pack authoring](../v2/docs/action-pack-authoring.md)** — reskins,
  contextual offers, justified variants/extensions, and playable Item cards.
- **[Deck-gated action spike](../v2/docs/deck-gated-action-spike.md)** — the
  measured, non-shipping alternative to the default projection hand.
- **[World simulation](../v2/docs/world-simulation.md)**,
  **[combat](../v2/docs/combat-system.md)**, and
  **[writing style](../v2/docs/writing-style.md)** — focused runtime contracts.
- **[Deployment](deployment/07-deployment.md)** and
  **[release process](release.md)** — operating and shipping the repository.

## Groomed local backlogs

- **[Card-Composed Character Creation](backlog/card-composed-character-creation.md)** —
  account-owned Species, Class, and Origin cards, classless level-zero arrival,
  first-action Class reveal, world discovery, new-tale lifecycle, and migration
  from compound campaign choices.
- **[SRD Action-Card Foundation](backlog/srd-action-card-foundation.md)** —
  dependency-ordered work for rules-bound cards, authoritative zones, scene
  composition, loadouts, and pack extensions.
- **[Fiction Frontier](backlog/fiction-frontier.md)** — authored transcript
  coverage, client-confirmed beat exposure, and prose-quality gates.

GitHub Issues are the live execution backlog. These local backlogs carry the
long-form contracts and acceptance gates that do not fit cleanly in an issue.

## Legacy service archive

The following documents describe the original `src/` service or historical
experiments. They are useful implementation history, but V2 code and the
current PRD take precedence:

- [Legacy service overview](overview/01-introduction.md)
- [Legacy system overview](overview/02-system-overview.md)
- [Legacy service documentation](services/)
- [Legacy event system](events/)
- [Historical fixes](fixes/)
- [X402 agentic economy report](X402_AGENTIC_ECONOMY_REPORT.md)

Last reviewed: 2026-07-22.
