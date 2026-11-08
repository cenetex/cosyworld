# Avatar artwork and item variants

Avatar is the cutout; Poses are happy, sad, hit, strike, brace and sleep images.
A wardrobe is a separate presentation field, not the existing temperament
`variants` (awake/asleep/irritated). It does not change inventory or combat rules.

`avatar.wardrobe` is an array of `{items, images}`. Each items array is a unique
set of zero to four item IDs from the same pack. Zero means the default outfit.
Images has required `base` and optional named poses. There are at most 32 sets.
Every image belongs to the pack and is included in media validation/export.

An outfit applies while the actor directly holds every required item. Dropping
or trading an item removes that match. A set with more items wins; equal-sized
matches use sorted item IDs lexically, independent of insertion order. A missing
pose uses that outfit's base, never an unrelated outfit. Attack maps to strike;
guard maps to brace. Combat resolves from its captured portrait so a later
inventory change cannot change clothes halfway through an animated beat.

Existing earned RATi scarves remain permanent upgrades with their current
fallback. No matching authored wardrobe means existing portrait logic applies.
The first scope is authored pack residents; shared traveler wardrobe authoring
and cross-pack item references are not implicitly enabled.

## Remaining maker integration

The maker item slot selects a canonical item set; it must not repurpose the
awake/asleep selector. Generate from the accepted base avatar plus only explicit
physical descriptions of selected items. Save each result to the durable image
archive before selection, and retain old revisions. First art auto-selects;
replacement selection changes only the corresponding wardrobe set. The library
must retain the item-set metadata so selecting old art cannot equip the wrong
outfit. Generation and authoring acceptance wiring is a separate dependent PR.

This foundation wires base, sleeping and combat presentation. Happy/sad assets
are retained but this does not invent emotional state rules. Add their triggers
explicitly through the existing authored pose system when that behavior is defined.
