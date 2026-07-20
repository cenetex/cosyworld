# Authoring SRD-backed action packs

CosyWorld packs target exactly one versioned rules profile. For the official
world that is `cosyworld.srd5/1`, backed by SRD 5.2.1 action identities. A pack
does not copy an action resolver simply to change its language.

Every pack declares `rules_profile` in `pack.json`. Contributions use one of
four resources. Their ids are pack-namespaced, and load order is never
precedence.

## Presentation-only reskin

Ruby High changes Study's visible label at the Library without changing its
ability, DC, timing, targets, or resolver:

```json
{
  "id": "ruby-high.first-bell:study-review-notes",
  "based_on": "srd5.2.1:study",
  "label": "Review your notes",
  "scope": { "kind": "location", "id": 12 },
  "compatibility": "cosyworld.srd5/1",
  "source_reference": "Ruby High: First Bell — Library presentation"
}
```

The reskin schema accepts only presentation fields. Adding `dc`, `modifier`,
`timing`, `resolver`, or another mechanical field fails compilation.

## Contextual offer

An offer says why an existing action is relevant to an authored noun:

```json
{
  "id": "ruby-high.first-bell:library-study-notes",
  "based_on": "srd5.2.1:study",
  "subject": { "kind": "location", "id": 12 },
  "context": { "actor_present": true, "not_claimed": "library_notes" },
  "label": "Review your notes",
  "source_reference": "Ruby High: First Bell — Library contextual offer"
}
```

The runtime still composes legality and resolves Study authoritatively. The
offer cannot grant the location, item, skill charm, or reward it references.

## Justified variant

A variant is a new, versioned rule identity. It declares its complete delta,
scope, rationale, compatibility, explicit precedence, and fixtures:

```json
{
  "id": "example.pack:trackwise-study/1",
  "based_on": "srd5.2.1:study",
  "exact_delta": {
    "default_ability": { "from": "intelligence", "to": "wisdom" }
  },
  "scope": { "kind": "location", "id": 900 },
  "rationale": "This authored subject is interpreted through tracks.",
  "compatibility": { "profile": "cosyworld.srd5/1" },
  "precedence": { "mode": "explicit", "priority": 10 },
  "fixtures": ["example.pack:trackwise-study-success"],
  "source_reference": "Example Pack design notes, Trackwise Study"
}
```

Two contributions to the same slot conflict unless both explicitly name each
other in `compose_with`. A later pack never wins implicitly.

## Namespaced extension

An extension introduces a resolver contract outside the twelve base actions:

```json
{
  "id": "example.pack:communal-ritual/1",
  "based_on": "srd5.2.1:magic",
  "resolver_contract": {
    "kind": "example.pack.communal_ritual_v1",
    "input_schema": "schema://example.pack/communal-ritual-input/1",
    "output_schema": "schema://example.pack/communal-ritual-output/1"
  },
  "fixtures": ["example.pack:communal-ritual-replay"],
  "source_reference": "Example Pack design notes, Communal Ritual"
}
```

Shipping the JSON alone is insufficient. The named resolver, schemas, replay
fixture, invariant tests, and compatibility justification must exist. Active
variant and extension versions become part of world, snapshot, journal, and
offer-composition identity.

## Playable Item cards

Weapons, skill charms, spells, containers, tools, consumables, and relics are
all `Item` roles. A mechanical Item declares a rules/operation binding,
equipment profile, target predicate, resolver, effect budget, weight, size,
uses/exhaustion/recovery, and transfer/theft policy. Prose cannot substitute
for that descriptor.

Ownership is Collection state, not world presence. An owned Item card enters a
shard only through an idempotent materialization receipt. Ownership never
creates bracelet or spell slots, advancement, automatic success, extra turns,
or shared-NPC/location control. `npm run v2:worldpack:inspect` reports
contributions, resolver coverage, modified SRD material, and collectible power
warnings.
