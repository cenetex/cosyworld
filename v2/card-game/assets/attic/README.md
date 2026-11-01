# Attic: refuge, home, and the Black Pond

Three matching 1672 × 941 opaque WebP paintings. Each is below 300,000 bytes.
The same attic camera, room layout, rafters, furniture, city windows and ornate
mirror remain in place. The lower-left foreground is clear for Vale. No painting
contains a person, lantern, lamp, candle or light fixture.

| State                           | Painting                 | Mirror                                  | Stairs                                                   |
| ------------------------------- | ------------------------ | --------------------------------------- | -------------------------------------------------------- |
| Lantern burning, stairs closed | `attic-lit.webp`         | Ordinary warm attic reflection          | Dark; no destination shown                               |
| Lantern burning, stairs open   | `attic-lit-cottage.webp` | Ordinary warm attic reflection          | Clear descent to Cosy Cottage, marked by a heather scarf |
| Lantern doused                  | `attic-doused.webp`      | Moonlit Black Pond, the brightest focus | Dark; no cottage shown                                   |

In both lit paintings, warm amber light comes from Vale's lantern outside the
painting, just in front of and below the camera, slightly left of centre. It
pools on the near floor and trunk fronts, falling off toward the back. The
cottage hearth adds a softer second light only in the scarf state. In the doused
painting, a thin curl of smoke enters from the lower left.

## Records

`art-prompts.json` preserves the exact final prompts, generation IDs, reference
chain, and the cottage's initial generation and inspection-source prompt.
`provenance.json` uses the existing asset schema to record pinned repository
sources, generation IDs, original PNG hashes and sizes, final WebP hashes and
sizes, dimensions, opacity and encoding settings.

The cottage's final edit starts from its initial cottage draft and uses an
enlarged inspection crop to remove two small stairwell fixtures. The final
`generation_id` is the delivered painting; `generation_history` records only
intermediates used in its reference chain. The 1672 × 941 outputs were encoded
to WebP without cropping or resizing.

## Integration

The forest backdrop states select `attic-lit.webp` and `attic-doused.webp`.
The cottage crossing selects `attic-lit-cottage.webp` while its existing
conditions hold: the lamp shines in the attic, and the Black cloth is there
or someone present carries a sewn traveler's scarf. Its left focus keeps the
descent visible on phones. The crossing still controls access; this update
changes only its painting. Dousing the lamp closes the stairs and reveals
the pond instead. All three paintings have registered card and phone variants.

The cottage crossing uses a byte-identical copy at
`assets/shared/places/attic-lit-cottage.webp`, the shared namespace accepted by
pack bridges. The canonical attic source remains here. `runtime_aliases` in
provenance records both paths and their common SHA-256.
