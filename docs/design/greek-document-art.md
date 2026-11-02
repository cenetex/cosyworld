# Greek document art

The Guard's Tablet, Burial Account, Pyre Account, Marathon Record and Creon's
Writ each receive distinct art under `assets/greek-drama/`. The five
`art` fields in `v2/content/greek-drama/card-world.json` are the only authored
content changes. Item IDs, descriptions, holders, conditions and pack revision
17 remain unchanged.

The pack schema requires flat media paths. Prompts, provenance and the batch
README stay together under `assets/greek-drama/documents/`; the five runtime
WebPs sit directly in the pack's asset folder.

## Content and engine boundary

The [content separation design](pack-content-outside-the-engine.md) keeps JSON
content outside the shared rules bundle from v58 onward. The shared content
builder records the new image paths in `content.json`; the narrator builder
rebuilds its current presentation data. The existing content hash and repack
mechanism identify this content revision for shared worlds.

No rule module, released engine bundle or engine-version wiring changes.
Journal replay continues to use its recorded engine and content. The import
scanner still classifies `packs.json` as an engine input, so this note documents
the boundary for the engine-labelled PR; no new rules version is needed.

## Generated files and validation

Compile `packs.json` from the source pack, then rebuild image variants, the
media manifest, shared narrator and shared content through their existing
builders. `packMediaFiles` automatically publishes each item's art through
`public-assets.mjs`.

Run the corresponding freshness checks, including `v2:card:shared:check` to
verify that the current engine's bytes are unchanged. Inspect all five item
cards at desktop and phone widths, and run the existing test suite to check
pack compilation and media serving.
