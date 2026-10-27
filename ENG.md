# CosyWorld engineering

The shipping game lives in `v2/card-game/`. Its JavaScript model owns the rules
for local play and shared play. See the [source map](docs/current-game.md).

## Current architecture

The browser renders cards and uses the model for local saves. Shared requests
send action choices to Rust. Rust runs the same authored model in bounded
QuickJS, checks the C session guard, journals accepted results, and publishes
views. The engine has bounded memory and execution time. Rust owns IO.

Released engine bundles retain their recorded behavior for replay. The current
rules version comes from the shared engine constant and appears in `/meta`.
Save migrations and explicit world upgrades preserve earlier accepted history.

The classic client and native C world kernel support compatibility history.
Their pack catalog and metadata have an explicit classic scope.

## Engineering priorities

1. Keep new systems in focused modules. The main-file line ceiling checks this.
2. Change rules in the shared source model, then rebuild its server bundle.
3. Test real action, save, replay, and HTTP boundaries for the changed behavior.
4. Keep public assets and server bundles from the same committed release.
5. Preserve identity, possession, consent, and completed quest evidence.

## Source ownership and checks

The [card guide](v2/card-game/README.md) owns the game map. The
[shared-world guide](v2/docs/card-table/shared-worlds.md) owns its server boundary.
The [contribution policy](.github/AGENT.md) owns required checks. The
[release guide](docs/release.md) owns deployment.

Earlier architecture and priorities remain in the
[classic engineering archive](docs/archive/classic/ENG.md).
