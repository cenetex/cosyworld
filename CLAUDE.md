# CosyWorld contributor guide

This is the compact operating guide for automated contributors. It is named
`CLAUDE.md` for tool interoperability; its instructions apply regardless of
model or agent implementation.

## Product and authority

CosyWorld V2 is the canonical product: a shared browser MUD backed by a
deterministic C kernel and a Rust HTTP/SSE orchestrator. The older Node service
under `src/` remains a companion for inherited Discord, social, marketplace,
media, and administration integrations. Unless an issue explicitly names that
companion, gameplay work belongs under `v2/`.

Authority is deliberately split:

1. Authored packs under `v2/content/*` describe world data.
2. `v2/scripts/compile-worldpack.mjs` validates and compiles the selected,
   locked pack set into `v2/content/official/`.
3. The Rust orchestrator authenticates requests, owns persistence and public
   projections, asks AI for bounded proposals, and calls the C ABI.
4. The C kernel validates deterministic actions and emits authoritative events.
5. The append-only SQLite action journal is the source of truth. Replaying it
   rebuilds state; JSON snapshots are disposable boot accelerators.

AI may propose dialogue, labels, or other bounded content. It never grants an
item, changes access, resolves combat, spends currency, fills a clock, or
mutates authoritative state directly. A proposal becomes visible only after
validation and commitment through the normal world-event path.

## Repository map

- `v2/core-c/`: deterministic rules kernel, public ABI, and C tests.
- `v2/orchestrator-rust/`: Axum server, C bridge, journal/replay, snapshots,
  browser client, SSE, authentication, moderation, AI, and projections.
- `v2/ai-model-rust/`: small native/WASM model-selection library.
- `v2/content/<pack>/`: authored pack manifests, resources, attribution, and
  assets. These are the source files to edit.
- `v2/worlds/official/`: selected pack set and integrity lock.
- `v2/content/official/`: generated runtime bundle; never edit it by hand.
- `v2/scripts/`: worldpack compiler/validator and deployment smoke tests.
- `v2/cli/`: terminal client.
- `src/`: legacy Node companion and its service/container architecture.
- `test/`: legacy Node and cross-surface Vitest coverage.
- `.github/workflows/`: CI, per-branch Fly deployment, and tagged AWS release.
- `ENG.md`: current engineering invariants and priorities.
- `v2/README.md`: runtime behavior, endpoints, configuration, and operations.
- `v2/docs/`: focused worldpack, combat, simulation, voice, and writing specs.

The Rust orchestrator is still concentrated in `main.rs`. Prefer an existing
focused module when one owns the behavior (`account_auth`, `ai_gateway`,
`content_packs`, `kernel`, `moderation`, `mud`, `routes`, `turns`, or
`world_simulation`). Do not make an unrelated extraction inside a behavior PR.

## Set up, run, and verify

CI uses Node 20 and stable Rust. Install JavaScript dependencies with `npm ci`.
The full V2 check also needs a C compiler and the Rust `wasm32-unknown-unknown`
target.

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run dev                 # canonical V2 browser runtime
npm run dev:node            # legacy Node companion only
```

Use the narrowest relevant checks while iterating:

```sh
npm test                    # Vitest suite
npm run v2:worldpack        # import, lock, compile, content and voice checks
npm run v2:kernel           # compile and run the C kernel tests
npm run v2:rust:test        # Rust format check and tests
npm run v2:syntax           # JS/Python smoke-script syntax
npm run check:version       # PR version guard
git diff --check
```

Before opening a PR, run the authoritative gate for the affected surface. For
most V2 changes that is `npm run check:local`; CI runs `npm run check`, the Rust
release build, lint, and the web build. UI or end-to-end changes also require
`npm run v2:check`, which exercises production-profile, browser, terminal, and
visual smoke paths. Local HTTP tests may require permission to bind loopback
ports; `listen EPERM` from a restricted sandbox is not a test assertion.

Every PR must bump the root package version because CI runs
`npm run check:version`. Update both `package.json` and the root package entries
in `package-lock.json`.

## Non-negotiable invariants

- There is one shared authoritative world per runtime, not a private chat state.
- Deterministic world mutations cross the C kernel boundary.
- Accepted actions and their deterministic seeds are append-only and replayable.
- New persistent state must survive journal replay and snapshot round trips.
- Claim keys make every reward, spend, mint, and one-shot effect idempotent.
- Player identity and actor authority come from server-issued sessions; browser
  fields and wallet query parameters are never trusted in production.
- AI failures do not invent authoritative fallback speech or state changes.
- Sanctuary cannot receive offscreen danger or irreversible loss from background
  simulation; consequential frontier change must be caused by relevant play.
- Packs use stable IDs and declared dependencies. Cross-pack topology belongs in
  composition data rather than either reusable pack.
- Bundle identity is persisted. Never erase a mismatched hash to force a load;
  use the documented fresh-seed or explicit migration path.
- Content and client copy follow `v2/docs/writing-style.md` and its executable
  register checks.
- Secrets, bearer tokens, wallet material, runtime databases, logs, and `.env*`
  files never enter commits or diagnostic output.

## Change a feature end to end

1. Start from the issue's acceptance criteria and identify the authority layer.
   Pure presentation belongs in Rust/client projections; deterministic state
   validation or mutation belongs in C; world facts belong in a source pack.
2. Change authored content under its owning pack. Run
   `npm run v2:worldpack:lock` only for an intentional source/selection change,
   then `npm run v2:worldpack`; commit the generated bundle and lock together.
3. For a kernel rule, update `cosy_kernel.h`, `cosy_kernel.c`, C tests, the Rust
   FFI wrapper, replay mapping, and Rust integration tests in the same change.
4. For Rust-owned behavior, update route authorization, state projection,
   journal/snapshot compatibility, and public event handling together.
5. Update the embedded browser or terminal client only after the server contract
   is authoritative. Clients suggest actions; they do not decide outcomes.
6. Add the narrow unit/integration test and an end-to-end smoke assertion when
   the behavior crosses HTTP, persistence, multiplayer fanout, or the browser.
7. Update the closest focused doc, bump the version, run the relevant gate, and
   inspect the final diff for generated churn or unrelated changes.

## Conventions and failure modes

- JavaScript is ESM; Rust follows `cargo fmt`; C compiles as C11 with warnings.
- Keep IDs stable and error messages actionable. Do not silently coerce invalid
  authoritative input.
- Prefer typed descriptors and closed vocabularies over executable pack logic or
  free-form state-changing AI output.
- Preserve old journal action semantics. A new interpretation needs a new action
  code or explicit migration so replay cannot change history.
- `v2/content/official/**`, lockfiles, visual baselines, and package lockfiles may
  be generated, but they still require review. Regenerate only through their
  owning command.
- The full runtime has production-only requirements. Use the hermetic smoke
  scripts instead of weakening production validation for local convenience.
- The root `index.js`, older Webpack UI, and much of `src/` are legacy surfaces;
  the production Dockerfile launches the Rust V2 binary.

See `.github/AGENT.md` for PR formatting, required preflight checks, and the
files that need special handling.
