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
the mount contract; location-scoped selection happens only among rules
capabilities already pinned in the active bundle.

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

Rules selection is typed and most-specific. `default_ruleset` is the pack
fallback; `extensions.x-cosyworld-rules-context` schema 1 may map a zone to a
declared rules capability; and a location row may declare `ruleset`. Resolution
is location, then zone, then pack. Repeated zone selectors and unavailable or
undeclared capabilities fail compilation, and the selected scope and selector
are included in the action composition certificate.

The compiler accepts selected packs in any order and emits one deterministic
topological order. Cycles, missing required packs or capabilities, duplicate
pack or capability declarations, incompatible pack versions, and incompatible
engine ranges fail before output is written. Optional dependencies may be
absent; when present, they must satisfy the same version and capability checks.
Cross-pack paths live in a dedicated composition bridge pack, never in either
reusable world pack. A bridge is a world pack marked with
`x-cosyworld-composition` role `bridge`; it may contain only exits, must depend
on both endpoint world packs, and has no entry point or default ruleset. The
compiler rejects any visible or hidden path whose endpoint packs differ unless
the path is owned by such a bridge. Other one-way extension resources may still
use dependency-guarded rows owned by the extending pack. They must never make
the depended-on pack point back into optional content.

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

## Generated descendant policy

Packs that opt into versioned route, waypoint, place, or location-card
generation declare `extensions.x-cosyworld-generation`. The extension is
schema version 1 and is validated against
`v2/schemas/world-generation-policy-v1.schema.json` both while reading the
authored manifest and after composition. Packs without the extension retain
the legacy host-default behavior; the runtime must not invent a provider,
model, or revision identity for that compatibility mode.

The policy pins:

- a pack-namespaced `policy_id`, monotonic `migration_version`, and
  `collision_namespace`;
- generated subject kinds, source-route ownership, active composition
  provenance, upgrade handling, and unmount handling;
- a reviewed prose profile and prompt version with the complete route,
  direction, endpoint, biome, terrain, climate, geology, hydrology,
  vegetation, fauna, resource, and nearby-authored-description context;
- a reviewed media profile and recipe, optional provider/model preference,
  required pack-authored prompt and output policy, authored/community-art
  eligibility, placeholder, and fallback;
- a topology profile plus reviewed minimum/maximum bounds for components,
  roots, ingress/egress, weighted distance, degree, cycle rank, bridges,
  articulation impact, and terminal spurs; and
- exact predecessor policy, migration, and pack versions allowed to preserve
  historical descendants across an upgrade.

Topology limits are reviewed bounds, not accidental equality checks. Use a
single-value range only when equality is an intentional invariant. Generated
topology remains deterministic engine work. Language models may propose prose
and media prompts only; they cannot choose edges, ownership, migration,
unmount, ecology authority, or fallback behavior.

Media recipes live in the reviewed
`v2/media/worldpack-recipes.json` allowlist. Manifests may select only a
published profile/recipe pair. Provider/model preference is optional; when
present it must exactly restate the recipe's provider and model revision and
can never bypass or replace the selected allowlisted recipe. Pack-authored
trigger, prompt prefix, aspect/output policy, negative and subject
restrictions, authored/community eligibility, placeholder, and fallback remain
required because the host registry cannot reconstruct those policy choices.
Credentials, provider URLs, arbitrary request bodies, and other provider wire
fields are forbidden. URI-like values are also rejected inside media prompt
prefixes and negative constraints; those prose fields cannot smuggle an asset
or provider endpoint. Secrets remain host configuration and never enter a pack
or the compiled registry.

Cross-pack route declarations are composition data exclusively. A reusable
world or campaign pack must never name another pack's route. A bridge with
`x-cosyworld-composition.role: bridge` declares each endpoint pair together
with the bridge-owned route and generated-descendant owner, topology authority
and migration version, endpoint ecology blend, media profile, removal behavior,
and world-lifecycle evacuation requirement. Once a bridge opts into the
generation policy, every authored cross-pack route it owns requires exactly one
matching declaration; undeclared, duplicate, foreign-owned, or orphaned
declarations fail compilation. Bridges without the extension remain explicit
legacy compositions until migrated.

The compiler emits the reviewed media registry only when a selected policy
uses media or declares a cross-pack route. The registry participates in bundle
identity, and the compiled checker requires byte-equivalent reviewed data. A
future runtime binding stores the selected policy and composition provenance
on generated descendants; it must treat that historical binding as immutable
on replay and accept an upgrade only through an exact declared migration.

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
npm run v2:composition:smoke
npm run v2:content-refs:migrate -- --input legacy.json --output migrated.json
npm run v2:journal:inspect -- --event-db events.sqlite --registry v2/content/core-only/registry.json
npm run v2:pack:mount -- --input core.json --output core-ruby.json --event-db events.sqlite --registry v2/content/core-only/registry.json --target-registry v2/content/core-ruby/registry.json --pack ruby-high.first-bell
npm run v2:pack:unmount -- --operation unmount --input snapshot.json --output unmounted.json --event-db events.sqlite --registry v2/content/core-only/registry.json --target-registry v2/content/services-only/registry.json --pack cosyworld.core
npm run v2:pack:unmount -- --operation remount --input unmounted.json --output remounted.json --event-db events.sqlite --registry v2/content/services-only/registry.json --target-registry v2/content/core-only/registry.json --pack cosyworld.core
```

`sync` skips workspace packs and materializes Git-backed packs below `v2/content/imports`. Git sources must use an HTTPS GitHub URL and a full 40-character commit. It never follows a branch or tag at build time.

`lock` recalculates pack integrity after an intentional content change and recompiles the bundle. Ordinary CI uses `v2:worldpack`, which fails if either the lock or compiled bundle is stale.

`v2:composition:smoke` boots the standalone Core, Ruby High, and services
compositions plus the Core/Ruby pair. Each world completes and recovers a
journaled action loop; services-only proves its catalogue and licenses remain
available while avatar creation fails without writing a journal row.

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

### Pre-deploy bundle gate

`v2/scripts/check-deploy-worldpack.mjs` runs in the deploy workflow before any
image is swapped. It reads the candidate bundle hash and declared
`replay_compatible_bundle_hashes` from the committed compiled registry, fetches
the live app's bundle hash from its public `/meta` (the hash the live journal
was written under), and refuses the deploy unless the two match exactly or the
candidate declares the live hash replay-compatible. An unreadable or
unverifiable live identity fails closed: the deploy stops instead of
discovering the mismatch as a crash-loop after the old machine is gone. A
rollback across a migration boundary is blocked by construction, because the
older bundle cannot declare a newer hash. The gate never mutates the journal,
the snapshot, or the recorded hashes; the remedy for a blocked deploy is the
declared migration path above, never a hand-edited hash.

Lonely Forest is one Fly Machine containing several isolated world processes.
Its release gate applies this same proof to every required tenant registry and
public `/meta` identity, rather than treating the root host as evidence for
every journal. See [the Lonely Forest deployment procedure](../../docs/deployment/lonelyforest-fly.md#recovery-when-a-tenant-is-already-unavailable)
for required-tenant health behavior and the narrow captured-identity recovery
path when a crashed tenant cannot serve `/meta`.

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

Runtime-generated pathways use the same ownership boundary. Their canonical
identity binds the owning authored route identity and entity version; waypoint,
segment-route, and generated-place identities derive from that pathway rather
than discovery order or the discovering actor. Numeric waypoint handles occupy
the reserved generated-location range and are derived directly from the
canonical waypoint identity. A collision with authored or already-generated
state fails closed instead of probing to an order-dependent replacement.
Snapshot v12 and journal v11 records receive this identity backfill once;
current-format persistence with missing identity fields is rejected. During the
v12 snapshot upgrade, legacy `route:generated:*` keys are replaced by canonical
segment keys without changing route lifecycle, discovery, or entity version.

### Threshold state separation

[ADR 0005](../../docs/decisions/0005-thresholds-trails-and-strict-referee.md)
is the route and threshold product contract. A pack and the compiler must keep
four questions independent:

- topology says whether a canonical target or edge exists;
- legibility says who has a Sign, Lead, or shared reveal;
- access says which Gate method permits this actor, expedition, or the world
  to Open, Take, use, or Travel; and
- safety says which Hazard tell, trigger, bypass, and consequence applies.

`discovery: known|scout`, route lifecycle, locked exit flags,
`revealed_edges`, and route familiarity are compatibility projections of
different questions; none may be treated as the others. A new authored hidden
truth uses a versioned bounded Discovery Slot. A stocking table freezes truth
once, an event table applies Pressure only after relevant committed play, and a
presentation table changes wording only.

#### Discovery authority v1

A pack may declare `extensions.x-cosyworld-discovery-slots`. Its machine shape
is [discovery-authority-v1.schema.json](../schemas/discovery-authority-v1.schema.json);
the five-kind authoring fixture is
[discovery-authority-v1.json](../orchestrator-rust/fixtures/discovery-authority-v1.json).
The compiler and runtime both validate the extension before any content can be
mounted.

The extension header is fixed:

```json
{
  "schema_version": 1,
  "receipt_version": "discovery-receipt-v1",
  "roll_algorithm": "weighted-fnv1a-v1",
  "stocking_tables": [],
  "event_tables": [],
  "presentation_tables": [],
  "slots": []
}
```

The three table arrays have deliberately different authority:

| Table | May select | May not select |
| --- | --- | --- |
| `stocking_tables` | Bounded hidden item, feature, actor, route, location, resource, or lore truth. | Truth outside the referring Slot; topology outside `authorized_topology_ids`. |
| `event_tables` | A typed Pressure/Lead/position/resource/Hazard/method effect after relevant committed play. | Permanent topology, unique loot, required keys, or rewards. |
| `presentation_tables` | Authored text for facts already selected. | Claims, quantities, targets, mechanics, access, or consequences. |

A Slot owns a pack-scoped stable ID and version, target kind, origin, claim
scope, initial `latent|signed` phase, one or more sensory tells, exact reveal
methods, a fixed result or stocking table, optional Gate/Hazard and event/copy
bindings, and required-progression law. Route and location rows must name
pre-authorized topology IDs. Required Slots must declare a finite
`sign_budget` and the exact fallback row from their stocking table. Optional
Slots cannot masquerade as required progression by declaring a fallback.

Stocking tables declare only server-owned `eligible_inputs`. The supported v1
facts are `world_seed`, `worldpack_bundle_hash`, `slot_id`, `slot_version`,
`origin_id`, `region_id`, `rules_profile`, and `claim_scope_id`; every table
must bind the Slot identity and version. User text, client state, wall clock,
provider output, model output, and controller identity are invalid inputs.

The server freezes a self-contained `DiscoveryRollReceipt` before reveal. It
records:

- receipt, Slot, table, pack, and weighted-FNV-1a versions;
- the claim key and actor/expedition/world scope identity;
- the canonical sorted eligible input facts, seed input, and roll seed;
- selected row, stable materialized entity IDs, and fallback decision.

An existing known-version receipt always wins over recomputation. Reconnect,
replay, repeat Search, controller handoff, content generation failure, and a
later caller supplying different inputs therefore cannot reroll the claim.
Unknown receipt/schema/algorithm versions fail new execution; the receipt
remains self-contained for inspection. Materialization and player-facing
Notice/Search/Study/Scout transitions are separate later contracts and cannot
be inferred merely because a receipt exists.

Scout pursues one exact geographic Lead from a legal Anchor or active foray and
reveals the authorized next segment or target without moving. Travel is the
separate movement commit. A cairn or worldpack-specific Signal Anchor can make
a traversed return leg durable and authorize later branching, but cannot
invent or reveal topology, settle a place, provide shelter, grant a rest grade,
or create sanctuary. Generated-pathway familiarity and generated-place
settlement remain separate versioned state.

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

Mounting or unmounting a world pack is an explicit offline migration, never an
implicit runtime fallback. A cold mount requires a strictly additive target:
every existing pack keeps the same version and integrity, and the only new
packs may be the requested pack, its required dependencies, and composition
bridges that connect it. It refuses while any soft-unmounted pack is still
frozen. The transaction changes the bundle, rules binding, canonical context,
and mount revision atomically; on restart the runtime deterministically seeds
the newly mounted entities and composition-owned paths without rewriting
existing live state or identities.
Soft unmount is the inverse: the removal set may contain only the requested
pack and dependent composition bridges, retained pack identities cannot
change, and a target cannot smuggle in an unrelated state-owning pack.

A composition may declare a schema-version-1
`pack_lifecycle.unmount` policy that moves every non-pack-owned occupant and
their carried or nested items to one public location owned by a pack that
remains mounted. Controller type does not change the policy. The
compiler resolves and validates that destination; the migration verifies it is
present in both the target registry and active snapshot before moving anything.
Without one unique policy, or while an occupant is in an active encounter,
`v2:pack:unmount` refuses to proceed. Once vacant or successfully evacuated, it
removes the pack-owned live projection and freezes the exact entities,
item/card zones, projection maps, and canonical context in the snapshot's
versioned `pack_mount_state`.
This lifecycle scope includes the complete dynamically generated subgraph owned
by a removed pack or composition bridge: pathway waypoints, segment routes,
generated places, jobs, clocks, natural affordances, settlement/governance
state, art state, and their canonical location identities. Remount restores
that frozen subgraph byte-for-byte and rejects active identity collisions.
Pending transfer offers that reference the pack become durable `invalidated`
tombstones, and matching one-use gift policies become consumed; remount never
revives either transient authorization. Every action composition certificate
includes the latest mount transaction sequence, so an action card issued before
unmount remains stale even after the exact pack and entity identities return.
Each committed operation records source/target bundle hashes, counts, a stable
state hash, a monotonic sequence, and any completed actor/item evacuation.
Remount requires the exact frozen source registry and restores the same pack
identities without undoing the actors' completed evacuation; collisions fail
without changing the input. Both directions require the snapshot's active
bundle hash to match the supplied source registry, and move the top-level rules
profile, variants, and extensions to the target composition in the same
transaction.

With an event store, every committed action writes a snapshot checkpoint tagged
with its exact `action_journal_seq`. Startup restores that checkpoint and
replays only the newer journal suffix, so an offline pack migration remains
authoritative without rewriting historical journal rows. The migration CLI
requires `--event-db` for a checkpointed snapshot, takes an immediate SQLite
write lock, verifies the snapshot cursor equals the journal head, and refuses
to run while actor jobs are pending or running. It writes through a
same-directory temporary file and atomic rename. Stop the writer and archive
the source snapshot before running it; then start one authoritative writer with
the exact target registry supplied to the tool.

`v2:journal:inspect` reads a bounded action-journal window without replaying or
mutating it. It preserves each raw record's hash and canonical references,
marks unavailable references as typed tombstones, and reports whether the
supplied registry can replay the record under the runtime's bundle and mapping
rules.

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

## Threshold descriptors

World packs may publish `x-cosyworld-threshold-descriptors` at
`threshold-descriptor-v1`. This is the authored, closed vocabulary shared by
Leads, Anchors, Gates, Hazards, and Pressure scenes. It records stable
pack-owned ids and versions, typed targets, actor/expedition/world/holder
visibility, exact methods, flat predicates, typed effects, reset and recovery
rules, and bounded progress/danger questions and tracks.

The catalog deliberately has no free-form predicate, effect, trigger, or
transition escape hatch. Requirements are a bounded flat `all` list rather than
a recursive expression tree. Discovery bindings name an
`x-cosyworld-discovery-slots` id and exact version, compatible result type,
once-per-scope claim, receipt version, finite budget, deterministic fallback,
and already-materialized ids. Unknown or cross-version bindings fail the pack
compiler and the Rust loader.

Accepted actions use `threshold-intent-v1`. The receipt freezes the descriptor
and pack provenance, target, actor and scope, selected method, server facts,
Discovery receipt refs, materialized ids, and accepted turn. A known stored
receipt replays as written after content changes; new execution must match the
currently mounted descriptor. Generated prose may explain a certified outcome,
but `authoring_authority` is always `authored_pack` and model, provider, client,
user, or wall-clock text cannot compile as authoritative input.

Hazards may add `hazard-resolution-v1` mechanics that bind one exact Gate on
the same typed target. Each Gate method names its sensory trigger, eligible
Hazard states, deterministic target policy, success/failure state, and
consequence policy. Public method offers always expose the authored tells and
consequence; the mechanism stays hidden until an explicit Search or Study
evidence tag exists. Accepted intents freeze the trigger, prior revision,
ordered targets, tells, state transition, and typed clock consequences.
Developer inspection always includes the complete mechanism, trigger table,
and current authoritative state.

The v1 fixture covers a retained-key door, installed-relic gate, consumable
seal, holder-only threshold, key-bypass trapped chest with table-stocked
contents, bounded ruin pressure, and a cairn-markable Lead. Anchor
`return_chain` identifies already-legal continuation separately from
`branch_authorization`; a mark does not invent forward topology.

## Progression safety proofs

World and composition packs may publish
`x-cosyworld-progression-safety` at `progression-safety-v1`. The proof is
checked against the composed authored resources, not trusted as prose. It
names required locations, explicitly missable optional content, exact
mission-key or reusable-capability access methods, recovery sources,
reclosable Gates, required Discovery Slots and Leads, and bounded frontier
transitions.

The compiler starts from the proof entry location, excludes locked exits, and
then repeatedly acquires reachable access methods and applies only their
authored `unlock_exit` transitions. Required components must become reachable.
Cross-pack Gate routes must agree with the composition's generated-route
owner. Permanent key transitions must be `world_target_once`; reclosable
installed-item Gates must preserve an authored return, alternate route,
rescue, or intentional one-way contract.

Every mission key classifies Give, Set Down, storage, actor departure,
resident custody, defeat, installation, and exhaustion as recoverable or
inert. Recoverable states point to an exact reachable recovery descriptor.
Inert is legal only after a permanent transition. Required Discovery Slots
retain a finite Sign budget and deterministic fallback; required lost Leads
name an exact recovery and last secure Anchor. Frontier transitions preserve
at least one authored retreat, camp, aid, or rescue path before fatigue can
restrict action.

Core's authored graph, the Core/Holy Land bridge, Project 89's four relay
keys, and the shared bounded-ruin fixture run through this proof in the
worldpack publication gate. Failures identify the exact Gate, item, recovery,
Slot, Lead, Anchor, or unreachable component.

## Campaign packs

`cosyworld.campaign.the-lantern-keeper` is the first short campaign pack. It
depends on Core and SRD 5.1, adds a five-room adventure with one progress/danger
arc, and owns four level-one character archetypes through the character-creation
contract above.

## AI cast packs and Elysium

A world pack may declare `actor_model_bindings.json` together with
`x-cosyworld-ai-cast` schema version 1. The extension pins the provider and
catalog snapshot, requires a complete one-to-one actor mapping, and explicitly
disables runtime catalog refresh. Each binding records the pack-owned actor
reference, requested model ID, canonical catalog slug, modalities and limits,
supported parameters, public price observations, zero-data-retention
eligibility, and either `raw` or `unavailable` speech mode.

The compiler rejects duplicate models, duplicate actors, partial casts,
non-canonical actor references, snapshot drift, and speech modes that disagree
with catalog modalities. Actor IDs are a stable hash mapping below the
generated-content handle range, so catalog reordering cannot rename residents.
The checked-in binding file is the authority for replay; refreshing a provider
catalog is an explicit pack version and snapshot update.

`cosyworld.elysium` is the first AI cast pack. Snapshot
`openrouter-2026-07-31.1` contains 485 OpenRouter models: 364 text-chat avatars
use raw speech, while 121 non-text models remain visible with
`speech_mode: "unavailable"` instead of silently routing through another
model. Every avatar has one private void and one unique void token, with
ambient autonomy disabled. Those room boundaries limit ordinary observation
and belief exchange to the local avatar, visitor, and item. The 485 voids form
a sparse chain of reciprocal `discovery: "scout"` edges, so each next cell is
revealed exactly once by the existing journaled, replay-safe Scout authority.

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
