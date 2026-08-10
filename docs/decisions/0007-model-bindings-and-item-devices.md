# ADR 0007: model bindings embody actors or power item devices

- Status: Accepted
- Date: 2026-08-09
- Decision owners: CosyWorld maintainers
- Related: ADR 0001, ADR 0002, ADR 0003, Elysium exact-model interactions

## Context

CosyWorld's canonical world has three entity nouns: avatar, item, and location.
The exact-model Elysium pack currently binds every provider model to an actor,
even when that model can only synthesize speech, transcribe audio, create an
image or video, embed text, rerank candidates, or compose audio. This gives a
tool endpoint an actor body, stats, controller, presence, targetability, and the
fictional standing of a resident merely because the original binding schema can
name only actors.

That does not match the rest of the product model. An avatar is a person or
other authored agent in the world. An item is the existing portable,
transferable, equipable, exhaustible, and installable carrier for bounded
capabilities. A location is shared place state and can host installed items and
buildings without becoming an actor. Provider model metadata is execution
configuration, not evidence of personhood.

Void 070 makes the mismatch concrete. ByteDance Seedance 2.0 Fast has one
truthful `create_video` interaction profile and no conversational profile. Its
asynchronous video persistence adapter is not implemented, so the runtime
correctly withholds an executable action. The world nevertheless presents the
model as a silent resident beside an inert token and does not expose the
dormant video capability to the player.

## Decision

A model binding is an execution component attached to a world subject. It is
never, by itself, a world entity or a claim of agency.

### Entity responsibility

| Subject | Required meaning | Model-backed behavior |
| --- | --- | --- |
| **Avatar** | A person or authored agent with presence, a controller, legal actions, condition, memory, relationships, and custody. | A conversational model may supply voice or bounded planning for that actor. |
| **Item** | A physical capability carrier with one live disposition, custody, activation, settings, uses, provenance, and transfer rules. | A model may power a portable, equipped, or installed device item. |
| **Location** | Shared topology, access, contents, memory, projects, buildings, and installed capabilities. | A location may make an installed device usable; it does not receive an actor controller merely to call a model. |

`device` is an item use pattern, not a fourth entity kind. A camera, voicebox,
listener, resonance compass, echo sorter, or instrument remains an Item card,
normally with a `tool` or `relic` role and a versioned device mechanics profile.
A fixed console is an item in the installed zone. A building may construct,
house, require, or expose that item without turning the building or location
into a resident.

### Authored embodiment

Worldpacks must declare whether an exact binding embodies an actor or powers an
item. Catalog modalities may provide a deterministic authoring default, but
they do not make the final ontological decision.

- `Talk` or genuine two-way `VoiceChat` may embody an avatar when the pack
  authors a person with the ordinary actor contract.
- Speech synthesis without conversation powers a voicebox item.
- Transcription without conversation powers a listening item.
- Image or video generation powers a camera, lens, projector, or similar item.
- Embeddings and reranking power bounded semantic instruments.
- Audio or music generation powers an instrument.
- A conversational binding with additional native profiles may remain an
  avatar. Its intrinsic profiles are non-transferable unless the pack also
  represents them with a separate item.

Text-to-text capability is therefore a useful Elysium generation rule, not a
universal definition of personhood. A two-way voice being may be an authored
person, and a text-output endpoint may still be only a tool. The pack must
answer whether the subject perceives, decides, and participates as an agent or
whether an agent uses it.

Provider availability and runtime-adapter readiness never change embodiment. A
temporarily unavailable conversational resident remains an avatar. A dormant
camera remains an item.

### Device activation and settings

Every model-backed item declares one activation mode:

| Mode | Contract |
| --- | --- |
| `carried` | Possessing the active, uncontained item may contribute its bounded one-shot action offers. |
| `equipped` | A typed equipment slot activates persistent settings or modifiers, such as the avatar's selected voicebox. |
| `installed` | The fixed item contributes actions to eligible avatars present at its location under the location's access policy. |

Settings use a closed, versioned schema with authored defaults and bounded
choices. Configuration is an authenticated loadout procedure. Playing an
action freezes the resolved settings in its certificate; the client cannot add
a prompt, model ID, provider parameter, arbitrary tool, or undeclared target.
Unless an authored transfer policy resets them, device configuration and
provenance travel with the item. Removing, containing, exhausting,
transferring, or deactivating the contributing item removes its future offer or
settings overlay at the next authoritative recomposition.

An inference-controlled avatar receives the same device-derived action offers
as a directly controlled avatar. Its controller may select only a certified
current-hand offer or Pass. A device grants no open-ended provider tool-call
authority and cannot let a model invent a world action.

### Availability, cards, and attribution

A dormant device remains visible and inspectable with its exact sanitized
reason. It does not occupy either playable slot in the two-action hand and
cannot be submitted until its provider route, adapter, policy, custody,
activation, and scene requirements are ready. This distinguishes honest
discovery from a dead action card.

Every successful publication attributes the acting avatar, source device,
exact requested and resolved model, profile, settings version, payer, and
originating world event. Player-facing narration identifies the avatar as the
actor: for example, "Mira speaks through the Copper Voicebox." The model or
device does not masquerade as the speaker unless it is separately authored as
an avatar.

Asynchronous device actions freeze a durable receipt before dispatch. It names
the acting avatar, item instance and entity version, exact binding and profile,
resolved settings, scene context, payer, source location, custody policy, and
state revision. The item becomes busy or exhausted according to its mechanics
so it cannot start duplicate work. Retry, transfer, drop, disconnect, and
restart follow the frozen receipt and explicit item policy rather than silently
rerouting or losing attribution.

## Binding and schema direction

The compatibility-first pack change is additive:

1. retain `actor_model_bindings` for actor subjects;
2. add a versioned `item_model_bindings` resource for item subjects;
3. normalize both at runtime into one discriminated exact-binding contract with
   a canonical subject reference;
4. key interaction profiles and durable jobs to that binding and subject rather
   than assuming `target_actor_id`; and
5. keep exact-model, no-fallback, frozen-profile, publication-gate, and replay
   requirements unchanged.

An item binding belongs to the authored item profile. Each live item instance
still has its own custody, zone, settings, exhaustion, provenance, and action
certificate. The browser submits the certified offer identity; it never selects
the provider model independently.

## Elysium migration

For interaction snapshot `openrouter-interactions-2026-08-08.2`, the generated
pack contains 485 exact bindings: 362 have `Talk` or two-way `VoiceChat`, while
123 are tool-only. Of the tool-only bindings, 75 currently have a provider-
available runtime adapter and 48 are dormant.

The next Elysium pack version should:

1. retain the 362 conversational subjects as avatars;
2. retire the 123 tool-only actor references through an explicit content
   migration rather than changing their canonical kind in place;
3. repurpose each affected room's existing Void Token item as the model-backed
   device, preserving the exact model and profile snapshot identities;
4. update room aspects, boons, memory, and cards so they truthfully describe a
   resident or a device rather than promising conversation everywhere;
5. make the 75 ready devices actionable under their item mechanics and keep the
   48 unavailable devices visibly dormant; and
6. turn Void Token 070 into a Seedance motion camera, dormant until the
   asynchronous video adapter and persistence contract ship.

An actor canonical reference cannot silently become an item canonical
reference. Migration records the retired actor, replacement item, old and new
bundle identities, and the disposition of any persisted actor state. The
existing item identity is preferred over reusing the numeric actor handle.

## Consequences

- Elysium stops granting fictional personhood and actor mechanics to tool
  endpoints.
- Portable AI capabilities participate in existing custody, trade, theft,
  loadout, exhaustion, provenance, and scene-composition rules.
- Fixed capabilities reuse installed items and location access instead of
  adding location controllers.
- Human- and AI-controlled avatars can carry and use the same devices.
- Dormant capabilities remain discoverable without creating unplayable hand
  entries or false promises.
- Item equipment needs typed device slots, generalized capability projection,
  and mechanics validation beyond the current shelter-specific tool path.
- Model-interaction plans, jobs, action categories, browser presentation, and
  exact binding lookup must stop assuming that every target is a resident.

## Relationship to earlier decisions

[ADR 0001](0001-cards-are-entitlements.md) still separates external card
representation from canonical world entities. Model-backed devices are
ordinary physical world items, not wallet entitlements.

[ADR 0002](0002-action-hand-is-authoritative-state.md) remains authoritative.
A ready active device may contribute a held-item or location-scoped offer; a
dormant device is inspectable but never dealt.

[ADR 0003](0003-one-canonical-world.md) remains authoritative. Actor-to-item
migration and every asynchronous device result preserve one canonical world,
stable references, frozen receipts, and replay-safe history.
