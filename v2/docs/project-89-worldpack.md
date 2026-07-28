# Project 89 worldpack design

Status: proposed V1-to-V2 migration design, not yet an authored or mounted pack.

This document defines the V2 migration and expansion of CosyWorld's existing
Project 89 and Proxim8 integration. The proposed release is a compact Operation
Liberation world with wallet-backed Proxim8 actors, a nine-location authored
inner loop, an eight-anchor semi-generative relay ring, four authored outer
hubs, nine authored residents, and fifteen world-item types.

The public source boundary is deliberately narrow:

- The [Project 89 dossier](https://www.project89.org/files/Project89-Dossier.pdf)
  describes each NFT as a living artifact, a 3D avatar seeded with agentic AI,
  and a key to deeper story layers.
- The [Project 89 portal](https://beta.project89.org/) presents Proxim8s as
  digital agents from the future with individual memories and abilities.
- [Operation Liberation](https://beta.project89.org/operation-liberation)
  names Seraph, Parzival, the 89 Archives, Oneirocom, meme farms, Project
  Chimera, consciousness harvesting, and the Green Loom Association.
- The official
  [Narrative Canon repository](https://github.com/project-89/narrative-canon)
  contains timeline-warfare prototypes and useful Oneirocom vocabulary, but
  prototype names and events are not treated as approved canon.
- The official mint page describes
  [6,000 Proxim8 living hyperstitions](https://launchmynft.io/sol/16033).
- The owner-provided
  [Project 89 Replicate model](https://replicate.com/ratimics/project89)
  supplies the pack's generated visual language. Its exact production revision
  and prompt contract are pinned below.

The collection address, NFT standard, complete trait vocabulary, and sample
metadata are not stated reliably by those public sources. The V1 deployment's
`collection_configs` and `avatars` records are therefore migration inputs, not
obsolete data. No collection-wide trait rules in this document should be
mistaken for extracted on-chain facts until those records are exported and
checked against current ownership data.

## V1 integration is the migration source

CosyWorld V1 already implemented the first Proxim8 bridge. V2 must preserve its
identity and history where the source data is available:

- [`collectionSyncService.mjs`](../../src/services/collections/collectionSyncService.mjs)
  imports Solana collections through Helius, normalizes metadata, keys avatars
  by `nft.collection` plus `nft.tokenId` or mint, stores traits and media,
  derives a deterministic `agentId`, and updates an existing avatar
  idempotently.
- [`avatarService.mjs`](../../src/services/avatar/avatarService.mjs) resolves
  registered collection aliases, matches held wallet assets to NFT avatars,
  recovers claimed avatars, and activates NFT-backed avatars in a channel.
- V1 stores bounded active presence in `channel_avatar_presence`, with a
  default maximum of eight active avatars per channel.
- [`agentIdentity.mjs`](../../src/utils/agentIdentity.mjs) derives agent
  identity from chain, origin collection, and token identity.
- [`agentBlockService.mjs`](../../src/services/agent/agentBlockService.mjs)
  and [`agentEventService.mjs`](../../src/services/agent/agentEventService.mjs)
  provide per-agent append-only histories. V1 also has agent travel, combat,
  inventory, memory, social, and summon services.

V1 usually selected one claimed or randomly matched owned NFT avatar for a
wallet-triggered interaction. The V2 requirement extends that model: every
owned Proxim8 becomes a durable independent actor, while the wallet's ordinary
human avatar remains separate.

### V1 data mapping

| V1 record | V2 destination and rule |
| --- | --- |
| `avatars._id` | Stored as `legacy_avatar_id`; never reused as a kernel numeric id. |
| `avatars.agentId` | Stored as `legacy_agent_id` and preserved as an external identity alias. Do not silently recompute it. |
| `nft.collection` and `nft.tokenId` or mint | Resolve the canonical `authority_id` and `asset_id` binding. |
| `name`, `description`, `personality`, `traits`, and media | Seed the reviewed V2 profile. Preserve raw source metadata and its hash. |
| `dynamicPersonality` | Voice seed only after moderation; never authoritative world state. |
| `claimedBy`, `walletAddress`, or `summoner` | Historical provenance only. Current control must be reverified from a signed wallet session and protected ownership source. |
| `channel_avatar_presence` | Not migrated. V2 creates fresh presence from a live wallet connection. |
| `agent_events` and `agent_blocks` | Imported into a read-only legacy-history attachment, then referenced by one journaled migration receipt. They are not replayed as V2 kernel actions. |
| V1 inventory | Imported only through allowlisted, idempotent item receipts. Unmapped items remain visible as legacy mementos rather than becoming duplicate world items. |
| V1 stats, status, and lives | Preserved in migration provenance. V2 mechanics begin from the approved balanced Proxim8 template unless an explicit conversion table is authored. |

The V1 code remains a legacy companion, not a second gameplay authority. V2
may reuse its exported data contract and fixtures, but wallet verification,
presence, mutation, and replay belong to the V2 Rust and C boundaries.

## Project 89 visual model

The Project 89 LoRA is a pack-specific media dependency, not a character
identity authority. The current public Replicate endpoint is already a
runnable FLUX LoRA destination:

| Setting | Pinned value |
| --- | --- |
| Base recipe | `replicate.ratimics-project89.v95f3d0eb` |
| Refinement recipe | `replicate.project89-flux2.refinement` |
| Base profile | `project89.world-art.base/1` |
| Refinement profile | `project89.world-art.refinement/1` |
| Base model and revision | `ratimics/project89@95f3d0eb7bdceb1262a2824c1a623e01b1902b71420013e6bc7b760e9f9255d6` |
| Refinement model and revision | `black-forest-labs/flux-2-dev@7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050` |
| Trigger | `P89` exactly once at the start of the positive prompt |
| Base mode | `dev` |
| LoRA scale | `1.0` for every P89 base, including Proxim8 portraits |
| Steps and guidance | `28` steps, guidance `3` |
| Output | One `webp`, quality `80`, safety checker enabled |
| Prompt template | `project89-art/2` |
| Default style profile | `project89-washed-anime/1` |

The base model is called directly by owner, name, and pinned revision. It must not
be passed as `lora_weights` to the generic
`black-forest-labs/flux-dev-lora` recipe: the Project 89 LoRA is already the
main model at this endpoint.

P89/FLUX.1 creates the basic character, location, or item. The pinned FLUX.2
recipe then performs cleanup, refinement, or multi-reference composition.
`P89` appears only in the FLUX.1 prompt; FLUX.2 inherits the visual language
from its first ordered image reference. For a Proxim8 portrait, image 1 is the
P89 base and image 2 is the immutable original NFT identity image.

The public examples establish the `P89` trigger and an anime-oriented visual
language. The default profile adds the literal `anime style` phrase and a
frozen watercolor-anime treatment. A production prompt should add the
subject's canonical facts and composition rather than relying on an
unstructured prose request:

```text
P89, anime style, <subject kind>, <approved canonical visual traits>,
<role, object, or environmental facts>,
softly washed watercolor anime illustration, clean expressive anime linework,
soft cel-painted forms under translucent watercolor glazing,
muted rose-lavender, deep teal and warm coral-amber palette,
diffuse bloom, gentle paper grain, slightly faded midtones,
crisp focal silhouette, <shot and composition>,
no readable text, no logo, no signature, no watermark
```

The prompt builder must add `P89` exactly once, reject metadata text that tries
to inject instructions, and record the resolved prompt hash. A deterministic
seed is derived from the canonical subject reference, metadata hash, prompt
template version, and recipe revision. Repeating the same job therefore
recovers the same prediction identity and cannot spend for unbounded variants.
The exact shared suffix, subject-specific rules, and pilot results live in
[`project-89-art-direction.md`](project-89-art-direction.md).

### Art intents

| Intent | Source | Shape | Initial generation rule |
| --- | --- | --- | --- |
| `proxim8_world_portrait` | Approved original NFT image plus cosmetic metadata | `1:1` identity master | P89 image-to-image at prompt strength `0.45` and full LoRA scale `1.0`, followed by FLUX.2 cleanup with the base first and original NFT second. |
| `proxim8_card_art` | Approved world portrait | `2:3` card | FLUX.2 may compose approved visual references; readable UI type and rules remain deterministic code-native overlays. |
| `resident_card_art` | Authored resident description | `2:3` | P89 base at LoRA scale `1.0`, followed by FLUX.2 only when cleanup or composition is required. |
| `item_card_art` | Authored item description | `1:1` | P89 base at LoRA scale `1.0`; optional FLUX.2 cleanup or composition. |
| `location_card_art` | Authored location description | `16:9` | P89 base at LoRA scale `1.0`; optional FLUX.2 cleanup; no people, creatures, text, logos, or watermarks. |
| `operation_scene` | Approved location, actor, and item art | `16:9` | FLUX.2 ordered-reference composition; not part of wallet materialization. |

The original NFT image remains the canonical provenance image and the
immediate UI fallback. A generated `proxim8_world_portrait` is a derivative
CosyWorld rendering attached to the actor's media graph. It cannot change the
actor's name, traits, role, drive, mechanics, or asset binding, and generated
pixels are never interpreted back into metadata. The holder can switch the UI
between approved original and world portrait without changing world state.

Wallet connection must not wait for Replicate and must not generate art.
Actor materialization publishes the approved original NFT image and commits
the actor. It exposes an optional redraw action only to the currently verified
holder. CosyWorld does not pre-generate portraits for all 6,000 Proxim8s.

### Orb-funded Proxim8 redraw

A holder deliberately spends the displayed Orb price before a redraw enters
the media queue. One funded redraw executes the registered P89 base and FLUX.2
refinement as one product operation under:

```text
project89:portrait:v2:<authority_id>:<asset_id>:<metadata_hash>:<style_revision>:<base_revision>:<refinement_revision>:<variant_revision>
```

The spend, media job, and result share one idempotency key. A provider timeout,
transient failure, rejected output, or safe retry of that same funded job must
not debit Orbs again. A user-selected new seed, style revision, or additional
variant is a new quoted redraw and requires a new Orb spend. This prevents both
double charging and unbounded free rerolls.

An approved redraw becomes an optional world portrait on the asset-bound
actor. The original NFT image remains the free default and canonical
provenance image. On NFT transfer, approved actor media follows the actor and
asset; spent Orbs are not refunded, and only the new verified holder can fund
another redraw.

Fixed resident, location, and item art should be generated and reviewed during
pack authoring, then shipped as content-addressed pack assets. Dynamic
Proxim8 portraits use the V2 media-job service. Provider output URLs are
temporary inputs: the worker downloads the bytes immediately, verifies their
type and digest, runs moderation, and writes approved media to stable storage.

Every candidate records the source-image digest, subject binding, model and
revision, full resolved settings, prompt-template version and prompt hash,
seed, prediction id, output digest, moderation result, funding mode, and
rights basis. A rejected or unavailable generation leaves the original NFT
image visible and does not affect actor presence. Imported V1 generated art is
retained as a legacy media revision and is not regenerated automatically.

The model page currently publishes examples and a runnable API but no README
or explicit public license statement. Because the model is owner-provided,
the production recipe should store the owner's internal-use and publication
approval, plus the training-data and derivative-use basis, as its rights
record instead of inferring rights from public model visibility.

### First live Proxim8 result

The first live fixture, tested on 2026-07-28, binds Core collection
`5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf` to Core asset
`Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo`. The asset's on-chain update
authority is the collection address, its name is Callum Synclaire, and its
off-chain metadata supplies token id `3759` and the Iris, Neon Protocol, Ember,
Halo, Blush Circuit, Spike Weave, and Flare Cut cosmetic traits.

The reusable inspector and its frozen account fixtures live in
[`inspect-project89-proxim8.mjs`](../scripts/inspect-project89-proxim8.mjs)
and
[`inspect-project89-proxim8.test.mjs`](../scripts/inspect-project89-proxim8.test.mjs).
The parser rejects non-Core accounts, a collection mismatch, non-HTTPS media,
oversized metadata, and unknown metadata fields as mechanics.

Three media probes refined the recipe:

- A text-only prompt was rejected by the enabled Replicate safety checker.
  This is a safe failure and produced no asset.
- Image-to-image at prompt strength `0.35` retained Callum's face, two-tone
  hair, amber eyes, headphones, jacket, green accent, and teal palette. It was
  still held from publication because the headphone display contained
  generated pseudo-text.
- Image-to-image at prompt strength `0.55` created a stronger restyle but more
  facial drift and a faint signature-like mark. It was also held from
  publication.
- P89 at full LoRA scale `1.0` and prompt strength `0.45` preserved Callum's
  defining traits and strengthened the anime treatment, but still created
  false lettering on the headset.
- FLUX.2 received that full-strength base first and the original NFT second.
  It removed the lettering while retaining the square crop, two-tone hair,
  gold eyes, headset, clothing silhouette, green accent, teal field, and
  washed anime treatment. This passes the initial two-stage visual gate.
- Both image-to-image runs returned a square `1088x1088` result even when the
  stronger probe requested `2:3`. A Project 89 world portrait is therefore a
  square identity master. Tall card presentation is a separate deterministic
  composition step until a pinned recipe passes an explicit aspect-ratio test.

No test candidate is published merely because a prediction completed. The
original NFT image remains canonical, and every generated candidate must pass separate
identity-drift, text, logo, watermark, and crop checks before publication.

### First location and item results

Authored locations and item types use shared pack art. They do not generate a
new image for every player, wallet, visit, or item instance:

- `Threshold Interface` attempt one correctly produced a `1344x768` landscape
  but failed publication review because it added two tiny scale figures and
  glyph-like light panels.
- Its second bounded attempt produced an empty `1344x768` architectural
  environment with no people, characters, readable text, logo, or watermark.
  That candidate passes the initial visual gate.
- `Agent Memory Seed` produced a centered `1024x1024` artifact on its first
  attempt with no hands, figures, text, logo, or watermark. That candidate
  passes the initial visual gate.

This confirms that text-to-image jobs respect the declared `16:9` location and
`1:1` item shapes, unlike the square-source image-to-image portrait probe.
Each approved location asset is keyed by location and art revision. Each
approved item asset is keyed by item definition and art revision; all dynamic
instances reference it. An actor-bound Memory Seed receives identity through
its item receipt and history, not through an individually regenerated image.

The exact seeds, prediction ids, hashes, and rejection reasons are recorded in
[`project-89-location-item-art-test.md`](project-89-location-item-art-test.md).

## Product decision

A Proxim8 is an independent world actor, not a skin, collectible card in hand,
or replacement for the holder's human avatar.

Connecting a signed wallet performs three separate operations:

1. Recover or create the wallet's ordinary human avatar through the existing
   wallet-avatar link.
2. Resolve every verified Proxim8 asset through a protected, collection-pinned
   ownership authority.
3. Recover or create one durable actor for each asset and anchor the eligible
   actors to the connected wallet's current presence.

The human remains the player's directly controlled actor. A Proxim8 has its
own name, profile, goals, memories, bonds, location, inventory, and action
history. Its holder may talk to it, give it eligible items, choose one authored
mission directive, or call it back at a safe boundary. The holder does not
receive an actor session that can puppet the Proxim8.

Proxim8 decisions use the same resident-autonomy boundary as other CosyWorld
actors. Authored desires and deterministic action offers select legal actions.
AI may propose dialogue, a stated intention, or flavor. The kernel still
validates and commits movement, item transfer, checks, combat, and every other
world mutation.

## Materialization contract

Generated-place anchoring uses the engine's stable internal milestone but
worldpack-owned player language. Project 89 must publish this terminology in
its `x-cosyworld-generation` policy:

```json
{
  "place_anchor": {
    "action_label": "Scan the sector",
    "target_label": "a completed sector scan",
    "question": "Can someone scan this sector and register a stable landmark?",
    "description": "Survey the local signal field and register one durable landmark for later agents.",
    "completion_memory": "The sector scan now anchors this place in the shared survey.",
    "visual_description": "A compact teal-and-coral survey beacon projecting a faint geometric scan volume over one locally significant landmark; blank unmarked casing, no readable text, logo, or humanoid figure."
  }
}
```

These fields feed the Journal question, action card, completion memory, and
future fixture-art prompt context. They are copied into the persisted
generation-policy binding so replay does not change old places when a pack
renames the action. “Lasting fixture” remains only the compatibility fallback
for legacy packs; it is not Project 89 player copy.

The durable identity is the NFT asset, not its current wallet:

```text
solana/mainnet-beta/<verified collection>/<asset id> -> one actor id
```

An implementation needs an `nft_actor_bindings` store separate from the
existing one-wallet-to-one-human-actor link. Its minimum durable fields are:

| Field | Purpose |
| --- | --- |
| `authority_id` | Names the pinned collection authority. |
| `asset_id` | Provides the unique on-chain identity. |
| `actor_id` | Provides the durable kernel actor identity. |
| `first_metadata_hash` | Pins the identity used at first materialization. |
| `current_metadata_hash` | Allows a reviewed cosmetic metadata refresh. |
| `profile_version` | Keeps deterministic profile mappings replayable. |
| `status` | Records rostered, anchored, offstage, or quarantined state. |
| `legacy_avatar_id` | Links an imported V1 avatar without treating its Mongo id as a kernel id. |
| `legacy_agent_id` | Preserves the V1 deterministic identity and its external references. |

Materialization is one journaled action with the claim key
`proxim8:actor:v1:<authority_id>:<asset_id>`. Retrying it returns the existing
actor and never emits a second creation event. The action must fail without a
partial actor when collection verification, metadata validation, capacity, or
the journal commit fails.

Before creating a new profile, materialization looks for a matching exported V1
record. A match imports its approved identity fields and records one migration
receipt. An ambiguous match is quarantined for review; it never creates two V2
actors or guesses from the NFT name alone.

### Connection and presence

- The first verified connection creates the actor offstage, then places it in
  the Threshold Interface.
- Later connections recover the same actor, memories, bonds, inventory, and
  mission state.
- A wallet may roster every Proxim8 it owns.
- V1's default of eight active avatars per channel becomes the initial V2 room
  capacity. When a room is full, additional Proxim8s wait in the Threshold
  Array and still exist as durable actors.
- Capacity selection uses a deterministic, inspectable order with holder swaps
  at the Threshold. It does not repeat V1's random owned-avatar selection.
- The holder selects which eligible actors enter the active set, but each
  selected actor remains autonomous.
- A disconnected wallet removes its anchors after the normal presence grace
  period. Proxim8s in sanctuary go offstage. A Proxim8 in combat, holding a
  focused turn, or resolving a consequential scene extracts only at the next
  safe boundary, so disconnecting cannot evade consequences.
- Offstage is a presence state, not deletion. No history or inventory is
  discarded.

### Transfer and revocation

Ownership refresh revokes the former wallet's anchor and any pending mission
instruction. The actor itself follows the NFT: its CosyWorld history, bonds,
profile, advancement, and actor-owned inventory persist for the next verified
holder.

Account-bound rewards belonging to the former human player do not follow the
Proxim8. They return to that player's account before the actor can be
re-anchored. World items explicitly held by the Proxim8 do follow it. The UI
must explain this distinction before the holder gives a transferable item to
an agent.

No transfer, disconnect, or metadata refresh changes the actor id. Revocation
must also invalidate cached ownership decisions and fail closed when the
protected ownership feed is unavailable.

### Metadata safety

- Collection and asset identity come from the protected server-side adapter,
  never browser-supplied card ids.
- Names and text are sanitized with the normal moderation path.
- Image, animation, and VRM addresses use allowlisted schemes and size limits.
- Metadata cannot author actions, prompts, stat values, item effects, URLs to
  execute, or pack ids.
- Known visual attributes are cosmetic. Unknown attributes remain visible in
  provenance but do not affect mechanics.
- A changed metadata document may update approved cosmetic fields after review.
  It cannot rewrite history, role, drive, advancement, or actor identity.

## Proxim8 character design

Every Proxim8 begins with equal mechanical power. NFT rarity and visual traits
never improve stats, action economy, damage, access, or reward rates.

### Identity layers

| Layer | Source | Rule |
| --- | --- | --- |
| Provenance | Verified asset and metadata | Immutable asset reference and first metadata hash. |
| Appearance | Approved metadata traits and media | Cosmetic only. Missing traits use a neutral 3D-agent presentation. |
| Callsign | Sanitized NFT name or `Proxim8 <serial>` | The holder may set a public alias without changing provenance. |
| Operational role | Chosen at first activation | One of six balanced mechanical lanes. |
| Core drive | Chosen at first activation | Shapes goals and dialogue, not power. |
| Memory seed | Deterministic asset seed plus played history | Never invents Project 89 canon or claims about the holder. |

### Operational roles

| Role | Lane | Starting skill | Signature offer |
| --- | --- | --- | --- |
| Echo Runner | Dexterity and infiltration | Listening | Scout a guarded route without revealing the whole map. |
| Signal Weaver | Intelligence and systems | Listening | Decode, disrupt, or reroute a device. |
| Memory Diver | Wisdom and investigation | Listening | Recover an additional lead from archives or testimony. |
| Reality Anchor | Constitution and protection | Steadiness | Hold a route or stabilize an ally under pressure. |
| Bridge Envoy | Charisma and alliance | Kindness | Turn a rescued or neutral actor into mission help. |
| Chimera Breaker | Strength and direct action | Steadiness | Break a physical restraint or suppress a construct. |

Each role uses the same attribute budget, one starting skill, and one
contextual offer. A role opens another approach to a problem; it does not skip
the problem or provide exclusive rewards.

### Core drives

- **Liberate** prioritizes trapped people and open routes.
- **Remember** prioritizes archives, testimony, and continuity.
- **Connect** prioritizes allies, communication, and repaired bonds.
- **Repair** prioritizes damaged systems, places, and actors.
- **Reveal** prioritizes evidence and public truth.

A drive controls the actor's desire ordering and dialogue context. It cannot
fill a clock, change access, or create a reward by itself.

### Independent behavior

Each actor has three inspectable intention slots:

- **Bond:** the human avatar or resident the Proxim8 currently trusts.
- **Directive:** one holder-selected job strategy, such as scout, rescue,
  recover, protect, or return. Directives are authored choices, not free-form
  commands.
- **Need:** one world item or condition the actor is seeking.

At an action opportunity, deterministic policy ranks immediate safety,
focused-turn duties, the directive, the need, and the core drive. AI can phrase
the resulting intention but cannot change the ranking or select an unavailable
action. A Proxim8 never spends a holder's currency, transfers an NFT, gives
away an account-bound item, enters gated danger, or starts player-versus-player
conflict autonomously.

## Character list

The dynamic Proxim8 row represents any number of collection-backed actors. The
other rows are fixed residents authored by the worldpack.

| Character | Location | Function | Source status |
| --- | --- | --- | --- |
| **Proxim8 agent** | Threshold Interface on first entry | Dynamic autonomous companion; one actor per verified asset. | Collection-backed. |
| **Seraph** | Threshold Interface | Guide, mission dispatcher, and voice of the optimal-timeline objective. | Public Project 89 canon. |
| **Parzival** | 89 Archives | First witness who explains the token's emergence and opens the archive investigation. | Public Operation Liberation canon. |
| **Mara Quell** | Sector 89 Safehouse | Quartermaster who turns broad goals into bounded directives. | New CosyWorld adaptation. |
| **The Custodian** | 89 Archives | Archive process with strict evidence rules and incomplete access. | New CosyWorld adaptation. |
| **Iri Vale** | Meme Farm 17 | Rescued consciousness who can identify the Chimera route. | New CosyWorld adaptation. |
| **Chimera Warden** | Project Chimera Lab | Silent construct guarding captured consciousness capsules. | Adaptation of the public Chimera concept. |
| **Oneirocom Auditor** | Oneirocom Tower | Calm antagonist who offers safety in exchange for convergence. | New CosyWorld adaptation. |
| **Convergence Voice** | Convergence Engine | System antagonist that turns accumulated danger into final-scene pressure. | Adaptation of repository prototype vocabulary; approval required. |
| **Loom Steward Anja** | Green Loom Assembly | Covenant host who records the operation's durable consequence. | New CosyWorld adaptation. |

Director Voss, Agent Chen, Kira-7, Agent Zero, and Neo-Tokyo appear in public
Project 89 repository demonstrations or examples. They stay out of the first
pack until Project 89 confirms that they are approved story canon rather than
prototype fixtures.

## Three-ring world map

The Project 89 pack owns its internal routes. A separate composition pack owns
the route between CosyWorld Core and the Threshold Interface.

The world grows outward through three rings:

1. **Operation Loop:** nine fully authored locations and routes.
2. **Perimeter Relay:** eight authored anchors connected by persisted,
   Holy-Land-style generated pathways.
3. **Open Signal Frontier:** four authored sanctuary hubs with generated
   routes, waypoints, and places beyond them.

The complete topology, unlock contract, Ring 2 anchors, Ring 3 hubs, generation
budgets, and safety rules live in
[`project-89-world-map.md`](project-89-world-map.md).

### Ring 1 location list

| Location | Safety | Purpose and exits |
| --- | --- | --- |
| **Threshold Interface** | Sanctuary | Wallet arrival, Proxim8 roster, active-trio selection, and return to CosyWorld. Connects the safehouse and interference market sides of the loop. |
| **Sector 89 Safehouse** | Sanctuary | Social hub, equipment exchange, directives, and recovery. Leads onward to the archives; a market chord opens during the operation. |
| **89 Archives** | Safe investigation | Parzival, the Custodian, archive evidence, and the first operation clock. The decoded route leads to the meme farm. |
| **Meme Farm 17** | Danger | Infiltration and consciousness rescue. Its forward edge reaches Oneirocom Tower after a rescue. |
| **Oneirocom Tower** | Danger | Social or stealth confrontation with the Auditor. Requires archive evidence, a rescue, or the access spine. Leads to the convergence engine. |
| **Convergence Engine** | Severe danger | Final operation with liberation and suppression clocks. Retreat returns to the tower; success opens the assembly. |
| **Green Loom Assembly** | Sanctuary | Resolution, covenant choice, advancement, and the first unlock into Ring 2. The inner loop continues toward the Chimera lab. |
| **Project Chimera Lab** | Danger | Construct conflict, evidence, and the access-spine objective. Its loop edges lead between the assembly and market; the access spine opens an authored chord to the tower. |
| **Interference Market** | Safe frontier | Contacts, repairs, rumors, and the final loop edge back to the threshold. Authored chords reach the safehouse and meme farm when their leads open. |

The stable authored cycle is:

```text
Threshold -> Safehouse -> Archives -> Meme Farm -> Tower -> Engine
    ^                                                  |
    |                                                  v
Market <- Chimera Lab <- Green Loom Assembly <---------+
```

Story locks and authored mission chords can change available approaches
without changing the authored loop.
Resolving the engine and recording the result at Green Loom Assembly sets
`project89.inner_loop_liberated` and opens the first Ring 2 path. The
safehouse, threshold, assembly, and all authored outer hubs never receive
offscreen danger or irreversible loss. Failure closes an approach, advances
suppression, moves an actor, or costs a world item. It does not delete a
Proxim8, alter its NFT, or spend Orbs.

## Item list

The NFT itself remains a wallet asset. None of the following rows represents,
wraps, burns, or transfers the NFT.

| Item | Role | Source or placement | Ownership rule |
| --- | --- | --- | --- |
| **Agent Memory Seed** | Personal relic | Created with each Proxim8 actor. | Actor-bound; follows the actor on NFT transfer; cannot be dropped, stolen, or consumed. |
| **Charged 89 Sigil** | Mission key | Seraph's opening objective. | Unique world item; spent to open one protected archive path, then retained as an inert relic. |
| **Archive Cipher** | Tool | Earned from the Custodian. | Transferable; decodes evidence and the meme-farm route. |
| **Memory Lantern** | Tool | 89 Archives. | Transferable; adds an investigation approach but never fabricates a memory. |
| **White Rabbit Relay** | Communication tool | Interference Market contact job. | Transferable; calls one authored ally response in a mission scene. |
| **Data Spike** | Systems tool | Interference Market. | Transferable and stealable while carried; one use against a terminal or restraint. |
| **Signal Veil** | Skill charm | Safehouse quartermaster. | Transferable; enables a stealth approach with the same power budget as other role tools. |
| **Coherence Nail** | Defensive tool | Safehouse project. | Transferable; reduces one authored instability consequence and is then exhausted. |
| **Loopbreaker Patch** | Consumable | Meme Farm 17. | One use to wake or stabilize a trapped consciousness. |
| **Consciousness Capsule** | Rescue objective | Meme Farm 17 and Chimera Lab. | Bulky world item; cannot be sold, equipped, or taken out of the Project 89 world. |
| **Chimera Access Spine** | Mission key | Chimera Warden encounter. | Unique world item; opens the lab route into the tower. |
| **Neural Disruptor** | Weapon | Project Chimera Lab. | Transferable and stealable; bounded combat profile, ineffective in sanctuary. |
| **Oneirocom Reality Anchor** | Deployable device | Tower security. | Bulky, transferable world item; stabilizes a room while active but advances suppression if left in Oneirocom control. |
| **Convergence Key** | Finale relic | Tower or Auditor bargain. | Unique world item; changes the available engine approaches, not the final outcome by itself. |
| **Green Loom Thread** | Covenant relic | Green Loom Assembly resolution. | Actor-bound after acceptance; records one completed-operation choice and provides no raw stat bonus. |

`Agent Memory Seed` requires a typed actor-materialization receipt and a
dynamic item instance. The other items are authored world items. No
`card_binding` alone moves any item between a wallet and the world.

## Campaign spine

The first playable job is **Operation Liberation**:

- **Progress clock — Liberation Signal (8):** advances through verified
  evidence, rescued consciousness, opened communication, and the final engine
  action.
- **Danger clock — Oneirocom Suppression (6):** advances through failed risky
  approaches, abandoned evidence, and leaving active anchors under Oneirocom
  control.
- **Front — Convergence Protocol:** uses the meme farm, Chimera lab, Auditor,
  and engine as escalating threats.
- **Resolution:** the group chooses to expose, reroute, or dismantle the
  engine. Each ending opens the Green Loom Assembly with a different durable
  world memory; none is selected by NFT rarity or token spend.

Proxim8 directives map to authored strategies on this job. A Signal Weaver
might decode a terminal while a Bridge Envoy organizes an escape, but both
still use checks, costs, clocks, and visible consequences.

Operation Liberation is the Ring 1 campaign, not the end of the world:

| Progression | Deterministic unlock | New play |
| --- | --- | --- |
| Resolve the Convergence Engine and record the outcome at Green Loom Assembly | `project89.inner_loop_liberated` | Opens Ring 2 at Memory Delta. |
| Stabilize one cardinal Ring 2 beacon | Beacon-specific journal flag | Opens its corresponding Ring 3 sanctuary hub. |
| Stabilize all four beacons and close the Perimeter Relay | `project89.perimeter_complete` | Opens all cardinal backlinks and allows generated frontiers from different hubs to meet. |
| Accept a legal survey action at a hub or discovered frontier place | Idempotent generated-route receipt | Adds one bounded, persisted Ring 3 expansion. |

Ring progression is earned through authored play and exploration. NFT rarity,
portrait redraws, and Orb balance cannot open a ring or improve its generated
rewards.

## Pack and runtime shape

The content should be split into:

1. `project89.operation-liberation`, the fully authored Ring 1 pack containing
   the operation locations, residents, items, cards, factions, job, front, and
   clocks.
2. `project89.perimeter-relay`, the Ring 2 pack containing eight authored
   anchors and a `regional_mesh` generated-pathway policy derived from the
   Holy Land contract.
3. `project89.open-signal-frontier`, the Ring 3 pack containing four authored
   hubs and an `open_frontier` generated-descendant policy.
4. `project89.composition.three-rings`, an internal composition bridge owning
   the declared authored routes and unlocks between the three packs.
5. `cosyworld.composition.core-project89`, a composition pack containing the
   route between CosyWorld Core and the Threshold Interface.
6. A new Rust-owned NFT actor materialization capability. Manifest v1 can
   declare collection entitlements and card bindings, but it cannot currently
   declare a wallet-backed actor template or materialize an actor.

Using separate ring packs lets each generated descendant retain one
unambiguous owner, collision namespace, migration policy, and topology budget
under the current schema. The mounted composition is still presented to
players as one Project 89 world.

The new NFT capability must not land in the oversized orchestrator `main.rs`.
It needs a focused module that owns:

- collection authority resolution;
- asset-to-actor bindings and profile receipts;
- V1 catalog, profile, history, and item-receipt import;
- anchor presence and the eight-actor room capacity;
- transfer and revocation;
- snapshot and journal replay;
- protected actor-roster projection; and
- fresh materialization, V1 migration, reconnect, disconnect, ambiguous-match,
  and transfer tests.

The C kernel remains wallet-blind. It receives a normal create, place, move,
item, or combat action with stable numeric ids. Rust proves ownership and
chooses whether an anchored actor may be offered an authored directive; it
does not decide the result of that directive.

## Inputs required before implementation

- Export the V1 Proxim8 `collection_configs` row without API keys or secrets.
- Export representative V1 `avatars` records plus related `agent_events`,
  `agent_blocks`, and inventory records. The importer should be developed
  against a sanitized fixture before it touches a production export.
- Validate that the collection address found in V1 is the tested current Core
  collection `5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf`. The Callum
  fixture confirms Metaplex Core, but the migration still needs to prove that
  the V1 configuration names the same authority.
- Retain at least twenty representative metadata documents from the V1 sync,
  including renamed, missing-trait, and custom-name cases.
- Approve the exact canon tier for Oneirocom Tower, Convergence Engine,
  Neo-Tokyo, Director Voss, Agent Chen, Kira-7, and Agent Zero.
- Confirm media and adaptation rights for NFT art, VRM files, named
  characters, logos, and Project 89 prose.
- Record owner approval and the training-data and derivative-publication basis
  for pinned Project 89 LoRA revision
  `95f3d0eb7bdceb1262a2824c1a623e01b1902b71420013e6bc7b760e9f9255d6`;
  the public model page does not state a license.
- Confirm that a Proxim8's played history and actor-owned world inventory
  should follow the NFT after a sale.
- Confirm whether V1's eight-active-avatars room capacity should be retained or
  changed for the Project 89 world.

Once those inputs are fixed, implementation can start with one asset fixture,
one V1 migration fixture, one transfer fixture, the Threshold Interface,
Seraph, and the Agent Memory Seed before the rest of the Operation Liberation
content is authored.
