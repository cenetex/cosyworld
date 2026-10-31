# Combat pose art

Full-body transparent portraits for attack and hit reactions. The original painted character identities and wardrobes are preserved. Each source is 1024 × 1536 WebP, at most 300,000 bytes, with the generated PNG's alpha preserved exactly.

These files are published for subsequent client-side combat integration. Current combat presentation still animates the neutral portraits. No rules or save changes are included. Empty hands keep carried items separate. Pip uses the existing character ID `moth`.

| File | Character | Pose | Wardrobe | Native facing | Bytes |
| --- | --- | --- | --- | --- | ---: |
| keeper-attack.webp | Keeper | attack | plain | left | 200,944 |
| keeper-hit.webp | Keeper | hit | plain | left | 212,138 |
| moth-attack.webp | Pip | attack | plain | left | 298,146 |
| moth-hit.webp | Pip | hit | plain | left | 291,018 |
| vale-attack.webp | Vale | attack | plain | right | 196,360 |
| vale-hit.webp | Vale | hit | plain | right | 220,730 |

`art-prompts.json` preserves each complete generation prompt and its pinned canonical portrait reference. `provenance.json` records generation identifiers, original PNG hashes, per-image WebP quality, output hashes, and exact alpha checks. The normal image builder supplies smaller card variants and records their hashes in `image-variants.json`.
