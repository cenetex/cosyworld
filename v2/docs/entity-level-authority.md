# Item and location levels

Item and location level contract 1 is carried by the optional
`entity_level_contract` field on a journal record. Snapshot version 22 stores
the resulting `entity_levels` ledger. Avatar levels keep their existing rules.

## Fresh worlds

Items start at level 1. Locations start at level 0, the Unsettled state.
Location self-description and numbered community-art pools open at level 1.
Authored location cards remain available at level 0.

An item gains one level for each distinct authored use milestone. Its source
pack can provide `level_policy` with `schema_version: 1` and one to nineteen
criteria. Each criterion has a stable `id`, a `location_id`, and a `feature_key`
that names a real room feature with a use for that item. For example:

```json
{
  "schema_version": 1,
  "criteria": [
    {"id": "fit-the-scarf-basket", "location_id": 1, "feature_key": "scarf_basket"}
  ]
}
```

The server records the accepted criterion, owner pack and version, and feature
target in the journal before the action commits. Credit requires both the
matching use mutation and its successful `item.used` receipt. The ledger uses
the feature target as the identity, so later wording or criterion-name changes
preserve the prior credit. Repeating a milestone retains the same level.

A location gains one level for each completed construction, authored building
upgrade, or civic slot expansion. Each completed project contributes its
stable job ID and event sequence once. Traffic, conversation, clock segments,
and repeatable service work retain the current level. Levels are capped at 20.

## Existing worlds and replay

A journal record without the optional contract field selects the historical
level rules during replay. A snapshot without the ledger uses those same rules.
The first accepted record carrying contract 1 freezes the existing item and
location levels before applying that record. These entries are marked
`grandfathered`. Previously completed development projects and recorded room
feature uses are entered as already consumed receipts.

This boundary preserves existing self-description levels and numbered art
pools, including their funding and saved plans. Further progress follows the
receipt rules above. Both a full historical replay and a snapshot followed by
the same journal suffix reach the same ledger. The frozen item-use claims allow
future pack revisions to replay the original milestone decision.

The contract covers level authority. Location class and slot allocation keep
their existing development rules. The tests exercise the action handler,
historical JSON with the new fields omitted, snapshot restore, generated-place
construction, upgrade and civic completion, and repeated service receipts.
