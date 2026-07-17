# ADR 0001: cards are entitlements, never world entities

- Status: Accepted
- Date: 2026-07-16
- Decision owners: CosyWorld maintainers
- Related: #20, #23, #24, #25, #26, #27, #48, #51, #52

## Context

Rati has three legitimate owners. Core authors the resident who runs the Blue
Cottage. Ruby High: First Bell minted a Rati collectible. Ruby High also adds
school membership and vocabulary when it is mounted. Treating any one of these
records as the other two would either make Core depend on an optional pack or
let wallet state replace shared-shard truth.

The same ambiguity applies to locations and items. A wallet can prove access or
provenance, but it cannot authoritatively say that a shared NPC disappeared, a
door moved, or a shard-local item changed hands.

## Decision

The chain records what a player is entitled to everywhere. The kernel records
what is true in this shard. A card is an entitlement about an entity, never the
entity itself.

The persisted concepts are separate:

| Concept | Canonical identity | Authoritative record | Lifetime |
| --- | --- | --- | --- |
| World entity | `pack://<authoring-pack>/<actor|item|location>/<local-id>` | compiled world resource plus shard snapshot | while its authoring pack is mounted |
| External card | owning `pack_id` plus string `card_id` | pack card catalogue; wallet ownership feed projects possession | independent of a shard |
| Actor facet | `pack://<applying-pack>/actor-facet/<facet-id>` | applying pack's `actor_facets` resource | only while the applying pack is mounted |
| Entitlement grant | namespaced grant string such as `ruby-high.first-bell:location-homeroom` | pack manifest authority and grant declaration | dormant when no mounted resource consumes it |

Numeric actor, item, and location ids remain runtime handles for the C kernel
and legacy snapshots. They are not cross-pack identity. Saved snapshots carry
their canonical mapping in `content_context.references`.

`card_bindings` is the only card-to-entity association. The binding belongs to
the pack that owns the external card and points at the authoring pack's
canonical entity reference. One external card can describe at most one world
entity, and one seed card can have at most one external binding. An entitlement
grant may be consumed by more than one access gate, but it never binds an actor
or facet directly. Facets are separate, removable rows and may condition their
presence with `requires_packs`.

World entity rows are a closed contract. Actor, item, and location resources
cannot contain `card_id`, `external_card_id`, wallet, ownership, grant, or other
undeclared fields. Those coordinates belong in external cards, `card_bindings`,
and entitlement grants. The compiler, compiled-world checker, and Rust registry
all fail closed on an attempted overlap.

Items consequently have one plane at a time:

- a world item is a numeric `items` resource projected into kernel/shard state;
- a wallet keepsake is an asset from the ownership provider and is not inserted
  into `world_items`;
- moving between planes requires a typed, durable receipt that consumes the
  source before creating the destination.

Manifest v1 does not define arbitrary item materialization or crystallization.
The Wooden Box burn/opening flow is the existing receipt pattern: verified burn
state is persisted before the wallet box becomes a local pack entitlement. A
future portable-item bridge must add its own typed receipt contract and prove
that no wallet claim and live world item overlap; a card binding alone can
never perform that transition.

## Rati migration

Rati remains `pack://cosyworld.core/actor/1001`. Core-only composition includes
the actor and its generated/local card surface without an external card id.
When Ruby High is mounted, Ruby contributes:

- `rati-first-bell`, an actor facet targeting the Core canonical reference;
- `rati-first-bell-card`, a binding from Ruby's external `rati` card to that
  same Core actor.

Ruby-only composition omits both dependency-conditioned rows. Removing Ruby
therefore removes the school facet and external binding without changing Rati's
world identity, location, dialogue authority, or Core availability.

## Runtime and API projection

- `registry.resources.actors`, `.items`, and `.locations` hold world truth and
  retain their authoring `pack_id`.
- `registry.external_cards`, `.resources.card_bindings`, and
  `.resources.actor_facets` hold the three separate expansion records.
- `/state.access.owned_card_ids` reports verified wallet cards and
  `/state.access.granted_entitlement_ids` reports resolved grants. Neither is a
  world-entity collection or actor-control list.
- `/content-packs` reports mounted pack access and resource counts; mount state,
  not wallet possession, decides whether a facet exists.
- Server-authored shared-resident lines remain authoritative. A play-as license
  can only apply in a separately instanced campaign shard that explicitly
  creates its own actor state.

## Consequences and follow-ups

Core and Ruby extraction (#24 and #27) implement and test the migration above.
Location-scoped rules (#26) must call the removable records *facets* and must
not persist expansion membership into the Core actor. The action hand (#48)
must call wallet-owned influences *keepsakes* or *passes*, not actors/items in
the scene. The terminology work (#51) must reserve *action card* for a scene
choice, *keepsake/pass* for an entitlement surface, *world item* for kernel
state, and *world pack* for mounted content.

The trade-off is deliberate indirection. Packs must declare bindings, facets,
and grants instead of copying wallet coordinates onto entity rows. In return,
optional packs can unmount safely, shared-world continuity cannot be bought or
disconnected, and item portability cannot duplicate shard-local supply.
