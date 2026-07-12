# CosyWorld Worldpacks

CosyWorld builds one deterministic runtime bundle from independently versioned content packs. The Rust host and C kernel consume the compiled bundle; they do not merge repositories or fetch content at startup.

## Layers

1. A pack is an independently licensed repository or workspace checkout containing `pack.json`, optional resource arrays, external card catalogs, and assets.
2. `worlds/official/world.json` selects the packs and their dependency order.
3. `worlds/official/world.lock.json` pins the materialized source, version, commit when applicable, and SHA-256 integrity of every declared file.
4. `scripts/compile-worldpack.mjs` merges the locked inputs into `content/official/`.
5. The Rust binary embeds the compiled JSON and reads pack assets through the compiled asset index.

The compiled directory is a release artifact and should not be edited by hand.

## Pack contract

`pack.json` schema version 2 supports five pack kinds:

- `world`: actors, locations, items, exits, cards, jobs, fronts, and other runtime resources.
- `campaign`: a bounded world arc that must also declare pack-owned character creation.
- `catalog`: external collectible-card metadata that projects into the world but is not a kernel entity by itself.
- `assets`: art or other static media mounted by a world or catalog pack.
- `rules`: reusable rules reference data. Rules packs may omit world resources entirely.

Resource files are JSON arrays. A pack may provide any subset; the compiler concatenates them in declared pack order and the worldpack validator checks duplicate IDs, references, capacities, and final-world invariants. Implicit overriding is not supported.

Dependencies must appear before the dependent pack in `world.json`. Cross-pack links should live in an explicit bridge pack or official-world composition pack rather than making two otherwise reusable packs own each other's topology.

## Pack-defined character creation

A `world` pack may declare `character_creation`; a `campaign` pack must. The
file is an array of schema-version-1 profiles. Each profile defines a stable id,
campaign name and prompt, entry location, default choice, and two to six
choices. Each choice supplies an authored Calling, title, description, and one
existing CosyWorld starting knack.

The compiler scopes profiles to their owning pack in
`character_creation.json`. The validator rejects duplicate profile/choice ids,
missing entry rooms, invalid Callings, or unknown knacks. The guest state
exposes the compiled profiles; `/avatar` accepts `character_creation_id` and
`character_choice_id`, then commits the selected entry room, identity, Calling,
and rank-one knack through the existing kernel and journal path.

This is intentionally narrower than a tabletop character builder. Packs cannot
set arbitrary kernel statistics, grant unvalidated items, invent classes, or
add spell slots through character-creation JSON.

## Commands

```sh
npm run v2:worldpack:sync
npm run v2:worldpack:lock
npm run v2:worldpack:compile
npm run v2:worldpack
npm run v2:worldpack:inspect
```

`sync` skips workspace packs and materializes Git-backed packs below `v2/content/imports`. Git sources must use an HTTPS GitHub URL and a full 40-character commit. It never follows a branch or tag at build time.

`lock` recalculates pack integrity after an intentional content change and recompiles the bundle. Ordinary CI uses `v2:worldpack`, which fails if either the lock or compiled bundle is stale.

## Moving a pack to its own repository

1. Move the pack directory, including `pack.json`, declared resources, attribution, and assets, into its repository.
2. Publish and pin a commit.
3. Replace the lock entry with:

   ```json
   {
     "id": "example.pack",
     "version": "1.0.0",
     "source": {
       "type": "git",
       "url": "https://github.com/cenetex/example-pack.git",
       "revision": "0123456789abcdef0123456789abcdef01234567",
       "path": "../../content/imports/example-pack"
     },
     "integrity": "sha256:..."
   }
   ```

4. Run `sync`, `lock`, and the full worldpack check.

No Rust source or Dockerfile change is required.

## Identity and persistence

The compiler gives every official bundle a SHA-256 identity derived from the world definition, locked packs, merged resources, external catalogs, and asset index. `/meta` exposes that identity and the included packs. New snapshots record it and refuse to load under a different bundle; legacy snapshots without an identity remain readable for migration.

The current kernel ABI still uses numeric actor, item, and location IDs. The validator therefore treats those IDs as bundle-global and rejects collisions. A later schema can compile namespaced authoring IDs into a stable numeric ID map without changing the kernel ABI.

## SRD packs

`cosyworld.rules-srd-5.1` and `cosyworld.rules-srd-5.2.1` are separate,
version-specific `rules` packs. They use the `cosyworld.rules/1` adapter and
compile attributed conditions and selected monster conversion seeds into
independent bundles in `rules.json`; their required CC-BY-4.0 statements are
carried into `attributions.json`.

The official world includes both packs as reference data. Neither pack adds
world entities, gains authority over monster behavior, or overlays the other
pack's namespace. See `docs/rules-adapter.md` for the mapping boundary.

## Campaign packs

`cosyworld.campaign.the-lantern-keeper` is the first short campaign pack. It
depends on Core and SRD 5.1, adds a five-room adventure with one progress/danger
arc, and owns four level-one character archetypes through the character-creation
contract above.
