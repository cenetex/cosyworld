# Ruby High: First Bell

`ruby-high.first-bell` is an independently bootable CosyWorld peer pack. It
owns the six school locations, their internal routes and room sheets, the Ruby
High faction, First Bell cards and assets, entitlement grants, access gates,
default rules capability, and school vocabulary.

The school is inhabited by six students (Lyra, Sami, Ravi, Indra, Mika, and
Noor) and three teachers (Ruby, Sally Science, and Professor Edward). All nine
are authored actors with event-triggered autonomy and explicit roaming enabled,
so they can react to committed player turns and move through the school's
ordinary exits without becoming directly controlled player pieces. Six school items are materialized alongside
them as ordinary world objects.

World presentation uses the borderless source artwork under `assets/world`:
wide environment paintings for locations, full-body portraits for every person
in the First Bell catalog, and square object illustrations for items. The First Bell set numbers, rarities,
profile ids, and chain image URIs remain collectible metadata; the framed NFT
card renders are not used as room, avatar, or item art.

The optional `cosyworld.core` dependency supplies no required Ruby content.
Rows marked with `requires_packs: ["cosyworld.core"]` add only the eight
cross-world routes, Rati's removable school facet, and her First Bell card
binding when Core is mounted. The compiler omits those rows from the standalone
`v2/worlds/ruby-high-only` composition, so no dangling Core reference remains.

Legacy location ids 10–15 remain the runtime handles for the new canonical
references `pack://ruby-high.first-bell/location/<id>`.
