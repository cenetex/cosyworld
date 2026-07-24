# CosyWorld Worldpacks

CosyWorld builds one deterministic runtime bundle from independently versioned content packs. The Rust host and C kernel consume the compiled bundle; they do not merge repositories or fetch content at startup.

## Layers

1. A pack is an independently licensed repository or workspace checkout containing `pack.json`, optional resource arrays, external card catalogs, and assets.
2. `worlds/official/world.json` selects the packs and their dependency order.
3. `worlds/official/pack.lock.json` pins the exact dependency closure, materialized source, version, commit when applicable, SHA-256 content integrity, capabilities, canonical-ID mapping version, and license record for every selected pack.
4. `scripts/compile-worldpack.mjs` merges the locked inputs into `content/official/`.
5. The Rust host loads `content/official/registry.json` (or the path in
   `COSYWORLD_CONTENT_REGISTRY_PATH`) before gameplay and reads pack assets
   through the registry-owned mount index.

The compiled directory is a release artifact and should not be edited by hand.

## Runtime registry

`registry.json` is the runtime boundary for a mounted pack set. It contains the
resolved Manifest v1 worldpack, every compiled resource collection, external
cards, asset mounts, rules, attributions, and character-creation profiles in one
self-contained document. It also embeds the exact `content_refs.json` mapping
described below. The per-resource JSON files remain deterministic
compatibility artifacts for validators and other tooling; the orchestrator no
longer has a compile-time list of embedded content files.

At process startup, `ContentRegistry` validates the registry schema and pack
contract, engine and dependency version ranges, required capabilities,
duplicate pack IDs and capability providers, optional dependencies, and the
deterministic topological order. It then owns the active pack set, typed content,
capability/pack indexes, and asset mounts. Invalid composition fails before the
world is seeded or a network listener opens. Resource kinds that this engine
does not yet project into gameplay remain available as opaque registry data,
which lets compatible packs carry reference resources without teaching callers
about files or directories.

The default registry is `v2/content/official/registry.json`. Deployments may
mount another compiler-produced registry and set
`COSYWORLD_CONTENT_REGISTRY_PATH` to its absolute path. One, two, or many packs
use the same load path; missing optional dependencies do not block unrelated
packs, while missing required dependencies and incompatible or duplicate packs
fail closed. Changing the active registry still changes bundle identity and is
subject to the persistence rules below. The engine also accepts a non-world
registry with no entry location, which lets API and persistence services start
without silently mounting CosyWorld Core. Live ruleset switching is not part of
this contract.

CosyWorld Core is the independently mountable `cosyworld.core` world pack. Its
manifest declares its default `cosyworld.core/rules` capability and all of its
world resources, lifecycle hooks, typed effects, characters, cards, vocabulary,
and assets. `ruby-high.first-bell` is a peer `world` pack with its own rules
context, school vocabulary, locations, faction, cards, gates, and providers.
Core does not depend on Ruby High or an SRD rules pack. The checked-in
`core-only` and `ruby-high-only` compositions prove each world can boot without
the other; `services-only` proves the host accepts a composition with no world
pack at all.

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

Resource files are JSON arrays. A pack may provide any subset; the compiler concatenates them in resolved dependency order and the worldpack validator checks duplicate IDs, references, capacities, and final-world invariants. Implicit overriding is not supported. An authored row may declare `requires_packs`; every named pack must be a declared dependency. The compiler includes the row only when all of those dependencies are selected and strips the authoring-only condition from the compiled registry. This supports optional, one-way bridges without leaving dangling references in a standalone composition.

Each manifest declares:

- an engine semantic-version range;
- typed, versioned capabilities whose kinds are `world`, `rules`, `cards`,
  `assets`, `entitlements`, or `reference`;
- dependencies with a pack version range and the exact capabilities required
  from that pack;
- optional default-ruleset and typed entry-point references;
- a license identifier and canonical license URL;
- provenance with author, source name, source URL, and a modification notice
  whenever source material was adapted;
- an attribution file plus any additional bundled license/notice files; and
- resources, assets, entitlement providers, and attribution where applicable.

The compiler accepts selected packs in any order and emits one deterministic
topological order. Cycles, missing required packs or capabilities, duplicate
pack or capability declarations, incompatible pack versions, and incompatible
engine ranges fail before output is written. Optional dependencies may be
absent; when present, they must satisfy the same version and capability checks.
Cross-pack links should live in an explicit bridge pack, an official-world
composition pack, or dependency-guarded rows owned by the extending pack. They
must never make the depended-on pack point back into optional content.

Two compiled resources preserve the entity/card boundary for expansion-owned
metadata. `card_bindings` associates a pack-owned external card with a canonical
entity reference while leaving the seed entity in its authoring pack.
`actor_facets` contributes removable faction membership and vocabulary to a
canonical actor. Bindings and facets must be owned by the extending pack and may
use `requires_packs` when their entity lives in an optional dependency. In the
official composition, First Bell binds its Rati card and school facet to
`pack://cosyworld.core/actor/1001`; both resources disappear from the standalone
Ruby registry, while Core's Rati remains valid and uses its local card surface.
The accepted identity, cardinality, persistence, and one-plane item rules are
recorded in [ADR 0001](../../docs/decisions/0001-cards-are-entitlements.md).
Player copy calls these collection representations **keepsakes**, location
entitlements **passes**, collectible reveals **bundles**, and mounted content
**world packs**; see the [player lexicon](player-lexicon.md). Stable manifest
and API fields retain their existing `card` and `pack` names.

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
transitive dependency closure, license identifier/URL, provenance, and the exact
text of every bundled notice. The lock also records
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

## World-defined avatar naming

A world composition may set `avatar_naming` to a JSON file below `v2/worlds`.
The compiler validates that file, includes it in bundle identity, and embeds it
in the runtime manifest. The current `culture-grammar/1` strategy defines:

- one `default_culture` and an ordered list of cultures;
- optional profile, species, and origin selectors for each culture;
- a short `style_prompt` shared with AI identity refinement;
- weighted name forms such as `{given} {family_root}{family_tail}`,
  `{given} of {place_root}{place_tail}`, or
  `{clan_root}{clan_tail} {given}`; and
- named component pools referenced by those forms.

Selection uses the most specific matching culture and falls back to
`default_culture`. Deterministic generation walks each weighted form without
reusing combinations until that form's component space is exhausted. Forms,
components, selectors, output length, and duplicate values are all validated at
worldpack compile time and again when the runtime loads the manifest.

The official compositions share
`worlds/shared/cozy-fantasy-avatar-naming.json`. World authors can point at a
different file to establish their own cultural naming texture without changing
Rust code. Component pools should be original setting material; published name
tables are useful as structural inspiration, not as text to copy.

## Commands

```sh
npm run v2:worldpack:sync
npm run v2:worldpack:lock
npm run v2:worldpack:compile
npm run v2:worldpack
npm run v2:worldpack:inspect
npm run v2:content-refs:migrate -- --input legacy.json --output migrated.json
npm run v2:pack:unmount -- --input snapshot.json --output migrated.json --registry v2/content/core-only/registry.json --target-registry v2/content/services-only/registry.json --pack cosyworld.core
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

Changing the selected pack set is not production-safe until the canonical
composition migration is implemented. The current runtime may reject the old
snapshot and seed fresh state after a bundle mismatch; that behavior is allowed
only for isolated local/test installations. For the official world, abort the
deployment and keep the old bundle authoritative. Do not blank a recorded
bundle hash by hand.

The target migration archives the old snapshot and action journal, compiles and
validates the new bundle, then projects only still-mounted state while recording
old/new hashes and identity mappings. It commits atomically or leaves the old
composition authoritative; it never seeds a fresh public history under the same
world id or runs mixed-composition writers. See
[`canonical-world.md`](canonical-world.md) for the migration and failover gate.

Pack content has a canonical, version-independent identity of the form
`pack://<pack-id>/<kind>/<local-id>`. For example,
`pack://five-e-commons/creature/goblin-warrior` and
`pack://homebrew.example/creature/goblin-warrior` are distinct even though both
packs chose the same local slug. Reserved characters in the local id use the
canonical `encodeURIComponent` spelling.

The compiler writes the complete, canonical-order mapping to
`content_refs.json` and embeds it in `registry.json`. Existing numeric actor,
item, and location ids appear as `legacy_runtime_id` and keep that exact value
as their compact `runtime_handle`; no existing save changes which content it
names. New string identities receive deterministic JavaScript-safe integer
handles from their canonical reference. The allocator sorts references before
resolving the vanishingly unlikely hash collision, so rebuilding the same
pinned `pack.lock.json` produces the same handles regardless of mount order.
Duplicate canonical references, handles, legacy ids, missing pack versions, or
non-canonical URI spellings fail before the listener opens.

Snapshots, action-journal records, and stored world events now carry a
`content_context` containing the mapping version, every relevant canonical
reference, owning pack version, runtime handle, legacy id when applicable, and
the active ruleset selections. The C ABI continues to receive compact numeric
handles. Persistence and inspection use the canonical context, so an exported
journal remains intelligible when its pack is unavailable; replay still fails
closed for a missing pack, version mismatch, unknown reference, or remap.

Legacy JSON snapshots, journal exports, and event exports remain readable.
The runtime enriches legacy database rows in memory, while the explicit
`v2:content-refs:migrate` command writes a durable migrated copy. Use
`--in-place` instead of `--output` only after archiving the original; `--force`
rebuilds contexts that are already present. The tool never changes the numeric
ids themselves and preserves self-contained contexts for unavailable packs.

Unmounting a world pack is an explicit offline migration, never an implicit
runtime fallback. `v2:pack:unmount` refuses to proceed while a human actor still
occupies a location owned by the pack. Once vacant, it removes the pack-owned
runtime projection, retains historical journal/event context, filters the live
snapshot's canonical references, and records the target registry identity and
ruleset selection. Archive the source snapshot and stop writers before running
it; then start the single authoritative writer with the exact target registry
supplied to the tool.

## Runtime discovery and access

`GET /content-packs` exposes the installed bundle as a player-facing catalogue.
It accepts the same wallet and development-card query fields as `/state`, and
returns each visible pack's metadata, resource counts, entry location, access
state, required grants/cards, asset providers, entitlement authorities,
distribution metadata, and accessible location summaries. Asset-provider rows
include the public prefix, mount, provider capability, content hash, and cache
namespace. The current access
states are `public`, `included`, `locked`, `partial`, and `entitled`.

The compiler stamps `pack_id` onto every compiled resource and external card.
Runtime actor, item, location, and card projections retain that provenance.
This records who authored a resource without making the authoring pack the
authorization boundary. Ruby High owns both its school locations and their
access gates; Core remains playable with the entire peer pack absent.

All packs in this endpoint are already installed by the canonical world's locked
composition. The endpoint does not dynamically install packs or interpret a
payment rail. Packs declare content and access surfaces; verified claims
determine the current player's entitlement projection.

`GET /licenses` is the unauthenticated attribution surface. It returns one
record for every mounted pack with its pinned version, license identifier and
URL, author/source/modification provenance, and the exact text of each bundled
notice. `/meta.worldpack.licenses` carries the same records for administrative
diagnostics. Both surfaces are compiled from the lock inputs; they never read a
mutable source checkout at request time.

### Asset providers

Every authored asset mount names an `assets` capability declared by the same
pack. Public URLs are resolved only through the active registry; the host does
not infer a sibling checkout or branch on a pack name. For example:

```json
{
  "capabilities": [
    { "id": "example.pack/assets", "kind": "assets", "version": "1.0.0" }
  ],
  "assets": [
    {
      "provider": "example.pack/assets",
      "mount": "cards",
      "directory": "assets/cards",
      "public_prefix": "/assets/example/cards",
      "optional": false
    }
  ]
}
```

The compiler stamps each mount with its owning pack id, pack version, pack
integrity, and a content hash. Runtime cache keys include the pack id, version,
provider capability, mount, relative path, and content hash, so two pack
versions cannot silently share stale media. Required missing assets return an
actionable `404`; an optional provider may declare `fallback: "external_uri"`
for external-card metadata, otherwise the host returns a stable placeholder.
Missing optional media never prevents unrelated public packs from loading.

### Entitlement authorities and named grants

Resources depend on stable grant ids, never directly on wallet, chain, or
payment code. A pack declares an `entitlements` capability and every authority
names that provider. Missing or mismatched providers reject the composition
before the listener opens. A denied or unavailable provider grants nothing, so
gated content fails closed while unrelated public content remains available:

```json
{
  "entitlements": {
    "schema_version": 1,
    "authorities": [
      {
        "provider": "example.pack/entitlements",
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

Authority type `asset_feed` accepts claims from the world's protected ownership
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

SRD-derived product copy may say **“5E compatible.”** It must not describe the
product as official, affiliated with, sponsored by, or endorsed by Wizards of
the Coast. Every SRD-derived manifest must use `CC-BY-4.0`, link the canonical
license URL, name Wizards of the Coast LLC as the source author, describe its
modifications, and bundle the version-appropriate attribution statement. The
compiler and runtime registry reject an incomplete record.

### Action and item-card contributions

The `cosyworld.rules/2` worldpack schema compiles four authoritative,
inspectable contribution modes:

- `reskin`: change label, detail, narration, and art for an existing action;
- `offer`: bind an existing action to a pack-owned avatar, item, location, room
  feature, or other contextual target;
- `variant`: declare and justify exact changes to a named base rule; and
- `extension`: add a namespaced mechanic with a validated resolver.

Reskins may not change mechanics. Variants and extensions name their base
profile, version, scope, delta, rationale, fixtures, attribution, replay
identity, and explicit precedence. Compile-time mutation fixtures prove that
mechanical reskins and implicit conflicts fail. Pack order alone never selects
a winner. See [action-pack-authoring.md](action-pack-authoring.md).

The collectible subject kinds remain avatar, item, and location. Weapon, skill
charm, spell, relic, tool, and consumable are Item roles sharing a playable-item
contract. Skill and bonus are state of a charm instance; spell cards occupy a
spell deck; weapons occupy equipment slots. Items also declare weight and
size/bulk, while container items declare added capacity and fit constraints.
The carried deck is validated from those physical rules, never a fixed card
count. Packs may author rarity and transfer or theft eligibility independently
of the mechanical power budget.

An account entitlement is still not a shard-local item. Materializing a
collectible into a world, changing its equipped holder, unlocking a bracelet
slot, moving it between card zones, or stealing it requires an idempotent,
journaled authoritative operation.
Owning an avatar or location card never grants control of a shared NPC or the
right to mutate shared geography.

See [the action and collectible architecture](../../docs/systems/04-action-system.md)
and [implementation backlog](../../docs/backlog/srd-action-card-foundation.md).

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
