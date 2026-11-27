# CosyWorld

A persistent world played as cards. You choose a card, the world changes, and someone in the room may answer. The card, and the message the world writes for that play, are what happened. A spoken line can color the scene, and it can be wrong about the table.

CosyWorld is the engine. The game it runs is **Lonely Forest**: play it at **[lonelyforest.com](https://lonelyforest.com)**.

The same rules run for a solo table and for a shared one. A shared world stays on the server. Residents keep homes, wants, and trust while you are away. Further shores are world packs on the same table: a forest, a Greek coast, a hoppycat archive, and others named in [ARCHITECTURE.md](ARCHITECTURE.md).

How the system is put together is in [ARCHITECTURE.md](ARCHITECTURE.md). Five engineering choices, and why they were made, are in [DECISIONS.md](DECISIONS.md). The [shared-systems audit](docs/design/shared-systems-audit.md) records special rules, fallbacks and compatibility paths.

## Play locally

The live site is the game. A local server is that same program.

You need Node.js 24 or newer, a Rust toolchain, npm, and `screen` (the dev script starts the server in a detached session).

```sh
npm ci
npm run dev
```

`npm run dev` builds the server and serves http://127.0.0.1:3102/. On a Mac it also tries to open that URL. Hosted dialogue reads `OPENROUTER_API_KEY` (see the environment notes in `v2/mvp.sh`). With no key, the story service stays off: the play is still saved, and each voice that was due shows "…".

Dialogue from a model on your own machine:

```sh
python3 v2/local/prepare.py
npm run play:cards:local
```

`prepare.py` fetches a pinned local dialogue model (`gemma3:4b` or `gemma3:1b`). The play script then prints `http://127.0.0.1:3110/` and starts the game plus a local voice process. Model names and the loopback checks live in `v2/local/run.py`.

## For portfolio reviewers / engineers

CosyWorld is a solo and shared card world with a hard boundary between a deterministic rules core and a language model.

- One rules program serves the browser and the shared server. The server runs it in QuickJS, a C interpreter with no filesystem, network, clock, or randomness, inside a Rust process that owns IO. A small C guard checks shared seats and room capacity. The layout is in [ARCHITECTURE.md](ARCHITECTURE.md).
- A card is journaled and reduced before anyone speaks. Generated speech is stored as speech. It is not the state the next card is dealt from. A line can contradict the table. Card text, the accepted action, and world messages are the account a replay agrees on.
- Shared worlds are a SQLite journal. Released rules bundles from `full-card-world/133` onward stay in the server so an old journal still reduces on the rules that wrote it. The app and rules versions are tracked independently. [App manifest](package.json) · [Pinned rules](v2/orchestrator-rust/src/card_shared/rules.json)
- A branch is held to 400 handwritten lines (`scripts/change-budget.json`). A change to the shared rules engine is a separate warning unless the pull request carries the `engine` label. Tests cover the rules, the journal, and the speech path.

[DECISIONS.md](DECISIONS.md) records the judgment behind those choices.

## Pictures of play

![The table at the Theban gate in The Wine-Dark Sea: Vale, Antigone and the gate guard, with place, item and character cards in the hand](docs/play/table.jpg)

Captures come from the live site or a local server, never a generated stand-in. They go in `docs/play/` and are linked here.

1. The table at a place, with the hand visible: [`docs/play/table.jpg`](docs/play/table.jpg), from a local server at 1440 px. Its one spoken line is the test harness's stand-in, so it is not frame 3.
2. A card just played, with the world message the rules wrote.
3. A spoken line on that same beat, so the two layers can be told apart.
4. A shared room, or the list of worlds.

A short recording of one play, from card to world message to reply, is enough.


### Reproduce the portfolio capture

Run from the repository root with Node 24, the Rust toolchain, Chromium
(Playwright), and a built orchestrator. Use a fresh, dedicated OpenRouter
key with a small spend limit. Set the model explicitly to one currently
available on your account.

```sh
npm ci
npx playwright install chromium
npm run v2:rust:build
export COSYWORLD_PORTFOLIO_MODEL=openai/gpt-4.1-mini
# Supply OPENROUTER_API_KEY securely in your environment.
node v2/scripts/capture-portfolio-demo.mjs
```

If the build uses a release or custom binary, set
`COSYWORLD_SHARED_BINARY` to its absolute path. The capture starts its own
loopback server (default port 4188; override with `COSYWORLD_PORTFOLIO_PORT`)
and creates a new temporary SQLite database. It never plays on the public
world. Run from a clean checkout without unrelated server configuration.

The starting position is a **seeded gameplay setup**, not a recorded
playthrough: Vale crosses to the Black Pond using the rules, with the bell
placed in Vale's inventory for the capture. No dialogue is seeded. The
browser registers a real test passkey, shares the world, selects the bell
and pond cards, and drops the bell through the UI. The real Rust server
writes the action to SQLite. The same turn's spoken words must match a
successful response from OpenRouter, through a loopback relay that returns
the upstream response unchanged. It has no fixture or fallback reply of
its own. The script checks the committed event, the item holder, the
journal order and the generated line. It stops the server, restarts with
the same database, and checks the action and speech in a fresh browser
using only the session cookies. A failed or silent reply is a failed
capture, never a substitute for live speech.

Output defaults to a new directory under `output/portfolio-demo/` (or set
`COSYWORLD_PORTFOLIO_OUTPUT` to a nonexistent destination). It contains
the table, selected card, world message, generated speech, shared-world
screen, a silent Playwright WebM recording, and `evidence.json`. The
recording shows the spoken **text**, not an audio recording of TTS.
The evidence includes the provider response ID, returned model, turn,
journal sequence numbers and restart checks, not the API key, prompts or
session cookies. Review the frames and trim the WebM if needed before
copying the approved media into `docs/play/`. Only a run with
`status: "passed"` is eligible. Do not publish incomplete captures or
fixture output as model-generated speech. The existing
`smoke-shared-cards.mjs` remains the deterministic, mocked-provider test;
it is not evidence of a live model call.

## Where the code lives

| Path                        | What it is                                        |
| --------------------------- | ------------------------------------------------- |
| `v2/card-game/`             | Browser client and the authored rules             |
| `v2/orchestrator-rust/`     | Shared worlds, the journal, and the model gateway |
| `v2/core-c/`                | C guard for shared seats and room capacity        |
| `v2/content/`, `v2/worlds/` | Sources for the mounted world packs               |
| `v2/local/`                 | Offline server and local dialogue                 |

License: MIT.
