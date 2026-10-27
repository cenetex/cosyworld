# CosyWorld dialogue and voices

Current character work starts in `v2/card-game/`, using the catalogs listed in
[the source map](docs/current-game.md). Forest characters, shared human avatars,
and mounted card packs all contribute identities and speaking styles.

## Current dialogue path

The browser's narrative and dialogue modules send requests to `/card-game/text`.
The Rust card narrative service builds context from character profiles, pack
facts, shared avatar data, and the completed action. It validates generated
speech before publication. The existing retry and saved conversation paths
preserve the action and accepted text.

Character `voice` and `idiolect` fields describe writing and delivery. A future
speech feature should bind its sound to these current avatar identities.
The [shared-world guide](v2/docs/card-table/shared-worlds.md) describes common
speech timing and viewer reading clocks.

Provider credentials stay in the server configuration. Current deployment
settings select the text model and the authored character model overrides.
Inspect those settings and the owning code when changing model behavior.

Earlier gateway, Elysium, voice-profile, and media designs are preserved in the
[classic AI archive](docs/archive/classic/AI.md). Their runtime and pack sources
serve compatibility work.
