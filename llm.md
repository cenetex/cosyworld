# CosyWorld LLM Orientation Guide

This guide is for language model assistants (LLMs) and new contributors who need to quickly understand the CosyWorld codebase, architecture, workflow, and documentation.

## Project Overview

CosyWorld is an AI-driven, service-oriented platform for persistent, evolving AI avatars, items, locations, and social gameplay across multiple platforms (Discord, Web, X/Twitter, Telegram). Key features:
- Multi-model AI (OpenAI, Google Generative AI, Ollama, OpenRouter, Replicate)
- Hierarchical memory (short‑term, long‑term, emotional, vector-based)
- Blockchain assets (NFT minting via Crossmint, Arweave, token management)
- Clean modular architecture (Awilix dependency injection)
- Web frontend (Webpack, TailwindCSS) and Discord bot backend (Express, Discord.js)

## Repository Structure

```text
/ (root)
├── readme.md                # Main overview & quickstart
├── llm.md                   # (this guide)
├── package.json             # Dependencies & scripts
├── src/                     # Application source
│   ├── index.mjs            # Server entrypoint
│   ├── container.mjs        # DI container setup
│   ├── services/            # Service implementations by domain
│   ├── config/              # Configuration & env schemas
│   ├── schemas/             # JSON schemas for validation
│   └── utils/               # Utility functions
├── public/                  # Static frontend assets
├── docs/                    # Markdown documentation (overview, systems, services, deployment)
├── scripts/                 # Build & documentation scripts
├── webpack.config.js        # Frontend build config
└── dist/                    # Generated build and docs artifacts
```

## Documentation

Markdown docs live under `docs/`:
- `docs/index.md` — Documentation landing page
- `docs/overview/` — Introduction & architectural overview
- `docs/systems/` — Subsystem details
- `docs/services/` — Service-level documentation
- `docs/deployment/` — Deployment guide & roadmap

HTML docs are generated to `dist/docs/` via:
```bash
npm run docs
```

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/immanencer/cosyworld8.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment:
   - Copy `.env.cosyworld` to `.env` (or set required variables in your environment)
4. Development workflow:
   ```bash
   npm run dev       # Server (watches src/index.mjs)
   npm run dev:js    # Frontend JS (webpack watch)
   npm run dev:css   # Frontend CSS (Tailwind watch)
   ```
5. Build for production:
   ```bash
   npm run build
   ```
6. Start production server:
   ```bash
   npm start
   ```

## Key Entry Points & Exploration

- **Server startup**: `src/index.mjs` (connects DB, initializes services, starts Discord bot & web server)
- **Dependency Injection**: `src/container.mjs`, `src/services/core/serviceRegistry.mjs`
- **AI integration**: `src/services/ai/*Service.mjs`, prompt templates in `src/services/ai/promptService.mjs`, model configs in `src/models.*.mjs`
- **Discord bot**: `src/services/social/discord-integration.mjs`, `src/services/chat/messageHandler.mjs`
- **Web API**: `src/services/web/webService.mjs`
- **World logic**: `src/services/world/locationService.mjs`, `src/services/world/itemService.mjs`, `src/services/world/questGeneratorService.mjs`
- **Tool system**: `src/services/tools/toolService.mjs` & implementations
- **Blockchain**: `src/services/blockchain/tokenService.mjs`, `src/services/blockchain/nftMintService.mjs`, `src/services/blockchain/crossmintService.mjs`
- **Frontend**: entry in `public/` & bundling via `webpack.config.js`

## Tips for LLM Agents

- Use the DI container pattern to locate services (`container.resolve('serviceName')`)
- Consult JSON schemas (`src/schemas/`) for data validation rules
- Leverage prompt templates defined in `src/services/ai/promptService.mjs` for consistent LLM usage
- Review and update `docs/` when modifying behavior or APIs
- After changes, regenerate docs (`npm run docs`) and rebuild frontend (`npm run build`)
- For environment variables, refer to `src/config/` and `.env.cosyworld`

## Contribution Guidelines

- Follow existing naming and style conventions (ESLint, Prettier)
- Write clear, concise documentation in `docs/`
- Add tests or usage examples when introducing new features
- Open issues or PRs with descriptive titles and references to related docs

---

**Last updated: 2025-04-23**
