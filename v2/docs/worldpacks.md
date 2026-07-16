# CosyWorld Worldpacks

CosyWorld builds one deterministic runtime bundle from independently versioned content packs. The Rust host and C kernel consume the compiled bundle; they do not merge repositories or fetch content at startup.

## Layers

1. A pack is an independently licensed repository or workspace checkout containing `pack.json`, optional resource arrays, external card catalogs, and assets.
2. `worlds/official/world.json` selects the packs and their dependency order.
3. `worlds/official/pack.lock.json` pins the exact dependency closure, materialized source, version, commit when applicable, SHA-256 content integrity, capabilities, canonical-ID mapping version, and license record for every selected pack.
4. `scripts/compile-worldpack.mjs` merges the locked inputs into `content/official/`.
5. The Rust binary embeds the compiled JSON and reads pack assets through the compiled asset index.

The compiled directory is a release artifact and should not be edited by hand.

## Pack contract

Every authored `pack.json` implements the machine-readable
`cosyworld.content-pack/1` contract in
`v2/schemas/content-pack-manifest-v1.schema.json`. Manifest v1 uses
`schema_version: 1` and supports five pack kinds:

- `world`: actors, locations, items, exits, cards, jobs, fronts, and other runtime resources.
- `campaign`: a bounded world arc that must also declare pack-owned character creation.
- `catalog`: external collectible-card metadata that projects into the world but is not a kernel entity by itself.
- `assets`: art or other static media mounted by a world or catalog pack.
- `rules`: reusable rules reference data. Rules packs may omit world resources entirely.

Resource files are JSON arrays. A pack may provide any subset; the compiler concatenates them in resolved dependency order and the worldpack validator checks duplicate IDs, references, capacities, and final-world invariants. Implicit overriding is not supported.

Each manifest declares:

- an engine semantic-version range;
- typed, versioned capabilities whose kinds are `world`, `rules`, `cards`,
  `assets`, `entitlements`, or `reference`;
- dependencies with a pack version range and the exact capabilities required
  from that pack;
- optional default-ruleset and typed entry-point references;
- license and provenance metadata; and
- resources, assets, entitlement providers, and attribution where applicable.

The compiler accepts selected packs in any order and emits one deterministic
topological order. Cycles, missing required packs or capabilities, duplicate
pack or capability declarations, incompatible pack versions, and incompatible
engine ranges fail before output is written. Optional dependencies may be
absent; when present, they must satisfy the same version and capability checks.
Cross-pack links should live in an explicit bridge pack or official-world
composition pack rather than making two otherwise reusable packs own each
other's topology.

Manifest v1 is fail-closed: unknown fields are rejected. Forward-compatible
metadata must live under `extensions` with a namespaced `x-...` key. Adding a
field that changes runtime meaning requires a new manifest contract version;
older runtimes must reject it rather than guess. Pack resources remain data
only. A manifest cannot load pack-owned JavaScript, Rust, native code, or an
untyped state-changing effect.

## Authority boundary

The engine owns execution, validation, persistence, and every typed effect that
can change authoritative world state. A pack may provide world facts, reference
material, cards, media, entitlement declarations, or a rules mapping through a
supported engine adapter. A `rules` capability does not grant executable
authority: the compiler emits typed reference resources, and the engine decides
whether and how a supported mapping affects play. `rules_adapter` names that
closed engine contract; it is not a plugin entry point.

`pack.lock.json` is the reproducibility record used alongside saved-world bundle
identity. For each pack it records the exact semantic version, complete content
hash, materialized source, declared capabilities, direct requirements,
transitive dependency closure, license, and provenance. The lock also records
the canonical-ID mapping version and deterministic dependency order. Given the
locked sources, the compiler emits byte-identical files and bundle identity for
identical inputs.

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
3. Replace the source coordinates in the lock entry with:

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

4. Run `sync`, `lock`, and the full worldpack check. The lock command regenerates
   the version, integrity, dependency closure, capabilities, and license record
   from the materialized manifest.

No Rust source or Dockerfile change is required.

## Identity and persistence

The compiler gives every official bundle a SHA-256 identity derived from the world definition, locked packs, merged resources, external catalogs, and asset index. `/meta` exposes that identity and the included packs. New snapshots record it and refuse to load under a different bundle; legacy snapshots without an identity remain readable for migration.

Changing the selected pack set therefore starts a new shard history. Before launch, archive the old snapshot and action-journal database, deploy the new bundle, and allow the orchestrator to seed a fresh world; startup already fails closed on the old identities and falls back to that fresh seed. Do not blank a recorded bundle hash by hand. After launch, preserving state across a composition change requires an explicit migration that projects only still-mounted pack state and writes the new identity.

The current kernel ABI still uses numeric actor, item, and location IDs. The validator therefore treats those IDs as bundle-global and rejects collisions. A later schema can compile namespaced authoring IDs into a stable numeric ID map without changing the kernel ABI.

## Runtime discovery and access

`GET /content-packs` exposes the installed bundle as a player-facing catalogue.
It accepts the same wallet and development-card query fields as `/state`, and
returns each visible pack's metadata, resource counts, entry location, access
state, required grants/cards, entitlement authorities, distribution metadata,
and accessible location summaries. The current access
states are `public`, `included`, `locked`, `partial`, and `entitled`.

The compiler stamps `pack_id` onto every compiled resource and external card.
Runtime actor, item, location, and card projections retain that provenance.
This records who authored a resource without making the authoring pack the
authorization boundary: a location may be authored in Core while its access is
delegated to a card catalog such as Ruby High: First Bell.

All packs in this endpoint are already installed by the shard's locked world
composition. The endpoint does not dynamically install packs or interpret a
payment rail. Packs declare content and access surfaces; verified claims
determine the current player's entitlement projection.

### Entitlement authorities and named grants

Resources depend on stable grant ids, never directly on wallet, chain, or
payment code. A pack declares the authority that can issue each grant:

```json
{
  "entitlements": {
    "schema_version": 1,
    "authorities": [
      {
        "id": "cards",
        "type": "solana_collection",
        "network": "mainnet-beta",
        "standard": "metaplex_core",
        "collection_address": "..."
      }
    ],
    "grants": [
      {
        "id": "example.pack:library",
        "authority_id": "cards",
        "match": { "asset_id": "location-library" }
      }
    ]
  }
}
```

An access gate then names `required_grant_id`. `required_card_id` remains an
optional compatibility/display hint and must match the grant's `asset_id`.
The Rust host resolves verified assets to grants before movement; the C kernel
continues to receive only an allowed/denied action.

Authority type `asset_feed` accepts claims from the shard's protected ownership
adapter. This is how the current Ruby High bridge works while its collection
address remains owned by the upstream deployment. `solana_collection` pins a
specific collection address in the permanent pack. `signed_set` pins an Ed25519
issuer public key for off-chain private sets; the protected adapter verifies the
assertion against that key before emitting claims. Protected feeds may return
`grantIds` for a wallet; unknown or undeclared grants are discarded.

### Permanent distribution

A pack can declare:

```json
{
  "distribution": {
    "media_type": "application/vnd.cosyworld.pack+json",
    "canonicalization": "jcs",
    "permanence": "arweave",
    "permanent_uri": "ar://<43-character-transaction-id>"
  }
}
```

Before upload, use `permanence: "content-addressed"` and omit
`permanent_uri`. The lockfile records the SHA-256 integrity of the complete
declared pack. Publishing uploads that exact canonical release to Arweave; a
new immutable pack version can then replace the distribution block with the
transaction URI and refresh the lock. NFT collection metadata may point back
to the same URI. Pack identity remains the content hash, while a collection or
signed issuer remains an entitlement authority that may serve multiple pack
versions.

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

## Factions

A faction is either **resident-anchored** or **player-facing**.

- A resident-anchored faction lists one or more authored resident actors in
  `member_actor_ids`. Those actors carry the faction's presence in the world.
- A player-facing faction has an empty `member_actor_ids` array and sets
  `player_facing: true`. Its membership is avatars, not authored residents;
  players join and represent the faction through play.

An empty `member_actor_ids` is valid when `player_facing` is `true`. The
worldpack validator warns about factions that have no member actors and are not
marked player-facing, so deliberately avatar-recruited factions such as the
Great Library remain valid and explicit.
