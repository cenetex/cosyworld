# Spatial scenes

Spatial scenes make room topology and the current hand visible without creating
a second authority for movement or combat. A content pack may attach one
schema-version-1 `spatial_scenes` resource row to a location whose
`interior_view` is `isometric`. The C kernel remains the authority for actor
location, actions, encounters, and world mutation.

## Authored contract

`spatial_scenes.json` contains bounded, deterministic presentation data:

- `sites` are named parts of a room. Each site owns one or more bounded
  `[x, y, z]` isometric tiles. Site ids are stable within the scene.
- `links` form one connected graph. They describe visual topology, not legal
  movement steps.
- `anchors` place known actor ids, room-feature keys, and exit destinations at
  sites.
- `constraints` describe a supported relationship between anchored entities.
  Version 1 supports `active_actor_blocks_exit`.
- `viewer_site_id` is the presentation fallback for the observing avatar and
  any visible actor without an authored anchor. It is not persisted actor
  position.

The compiler and Rust registry both fail closed on unsupported versions,
fields, kinds, missing references, duplicate coordinates, disconnected graphs,
or excessive scene size. Pack compilation adds `pack_id`; scene definitions
are included in the worldpack bundle hash.

## State projection

`GET /state` adds `spatial_scene` only at a location with an authored scene.
The projection contains the authored sites and links plus resolved `tokens`,
`portals`, `constraints`, and `viewer` placement. It also includes a
`definition_hash` so non-browser clients can cache the stable definition.

The projection is built from the already filtered `ActorView` and two visible
action offers. It cannot reveal an actor excluded from the ordinary state
response. An authored exit anchor intentionally publishes that seed exit as
scene topology even before ordinary route discovery; the runtime still
re-evaluates its lock and access metadata, and the portal has no matching offer
until that action is actually in the hand. Each token or portal carries only
matching visible `offer_ids`, allowing an API client to relate spatial context
to the same certificate-bound actions it can already submit.

An active actor constraint requires its visible active actor and an authored
exit anchor. A knocked-out or absent actor removes the active block in the
projection. This relationship explains the scene; it does not independently
reject an action.

## Browser renderer

The browser turns the contract into inline SVG. Tile geometry, labels, tokens,
portals, and constraint lines come from the state projection. The first and
second cards in the current hand highlight their matching scene entities with
distinct colors. The scene includes an accessible prose summary.

Generated imagery may later supply reviewed textures or token portraits, but
it must remain optional. Structural geometry, labels, blocking state, and hand
focus survive a missing or incorrect image.

## Version 1 non-goals

Version 1 does not add local movement, range, line of sight, cover, collision,
pathfinding, or persisted coordinates. It does not change offer legality or
the `cosyworld.combat/4` action economy. Those would require explicit kernel
semantics, replay fixtures, and a new protocol rather than browser inference.
