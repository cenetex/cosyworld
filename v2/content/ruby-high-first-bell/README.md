# Ruby High: First Bell

`ruby-high.first-bell` is an independently bootable CosyWorld peer pack. It
owns the six school locations, their internal routes and room sheets, the Ruby
High faction, First Bell cards and assets, entitlement grants, access gates,
default rules capability, and school vocabulary.

The optional `cosyworld.core` dependency supplies no required Ruby content.
Rows marked with `requires_packs: ["cosyworld.core"]` add only the eight
cross-world routes, Rati's removable school facet, and her First Bell card
binding when Core is mounted. The compiler omits those rows from the standalone
`v2/worlds/ruby-high-only` composition, so no dangling Core reference remains.

Legacy location ids 10–15 remain the runtime handles for the new canonical
references `pack://ruby-high.first-bell/location/<id>`.
