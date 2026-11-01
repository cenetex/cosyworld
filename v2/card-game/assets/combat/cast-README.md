# Remaining avatar combat poses

This work completes Strike, Hit and Guard paintings for the current card-game
cast beyond the eight shared human avatars, Pip and the Keeper.

The inventory contains 56 avatar IDs using 50 distinct canonical portraits:
27 Greek identities, 16 Hoppy Cat identities, the Swede, four Lonely Forest
residents, Badger and BoardyAI. Six Greek account aliases share their existing
identity's artwork. The target is 150 new paintings, with no duplicated art for
those aliases. Strike uses the existing `-attack.webp` filename convention.

The first 94 paintings have been generated, reviewed and encoded. Each
identity's `poses` in `cast-roster.json` lists its accepted files;
`cast-combat-art.mjs` registers and serves those 91 portrait poses, and an
actor without a painted pose keeps its neutral portrait. Oak's three backdrop
edits are committed but not yet shown. The full target
is 147 transparent portrait sprites plus three opaque Oak backdrop edits. `cast-roster.json` pins the canonical
references, actor mappings and intended pose directions. The original 54
combat paintings remain unchanged.

## Art contract

- Edit each existing canonical portrait, preserving its identity, anatomy,
  clothing, attached accessories, palette and painted style.
- Supply separate attack, hit and guard poses as full-body 1024 × 1536
  transparent WebPs, at most 300,000 bytes each. Oak keeps its existing
  1672 × 941 opaque place painting and receives branch/root transformations.
- Keep the complete silhouette inside the canvas with clear margins.
- Preserve generated alpha and dimensions exactly during format encoding.
- Use the official builder for smaller cards and public registration.
- Front-facing neutral characters receive three-quarter left-facing combat
  poses. Directional neutral portraits retain their established direction.
- Keep the original human scarf wardrobes and the Keeper's right-facing
  neutral fallback. Resident state portraits are restored after playback.

This work supplies presentation artwork. Existing rules still decide who may
enter combat; it does not change resident permissions, saves or released rules.

[Exact prompts and revisions](cast-art-prompts.json) and
[provenance, hashes and encoding checks](cast-provenance.json) cover the
accepted files in this checkpoint. Oak remains a backdrop and is not selected
as a portrait sprite.
