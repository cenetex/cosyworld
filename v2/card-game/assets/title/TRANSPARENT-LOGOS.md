# Transparent gold logos

## Scope

These are the TWO original gold wordmarks recovered from the owner's Library:
`lonely-forest-1` (ornate emblem) and `lonely-forest-2` (Pip, lantern and cottage).
They have real exterior alpha transparency. The enclosed navy night paintings
remain part of each logo. They are not isolated gold lettering.

They are NOT PR #2084's three opaque intro artworks. The three teal treatments
labelled lantern-left / bell-and-lantern / lantern-right were recoverable only
as JPEG review sheets; no source pixels from those previews are included here.

## Files

Native transparent sources (full dimensions; source alpha preserved exactly):

- `assets/title/lonely-forest-1-transparent.webp` — 2007 × 783.
- `assets/title/lonely-forest-2-transparent.webp` — 1983 × 793.

Supplied toolbar exports (nonzero-alpha bounds, 8px safety padding, 160px tall):

- `assets/title/toolbar/lonely-forest-1-transparent.webp` — 417 × 160.
- `assets/title/toolbar/lonely-forest-2-transparent.webp` — 407 × 160.

These paths are relative to `v2/card-game/`. Original PNGs are retained in the
handoff's `original-pngs/` folder, not in the candidate repository patch.
`transparent-logos.provenance.json` records source IDs, hashes, dimensions,
encoding settings, crop bounds, byte sizes and measured alpha checks.

## Wiring

The candidate patch adds `toolbar: { src, width, height }` only to the two
matching existing entries in `title-logos.json`. There is NO `crop` property:
the current image builder treats these as supplied files, not generated crops.
The current public-asset list already publishes `toolbar.src` from the registry.

The opaque title `src` fields, their dimensions and backgrounds, the five logo
indices and all three #2084 toolbar entries remain unchanged. No renderer,
selection, save, rules, acknowledgement, audio or reduced-motion code changes.
The native transparent sources are repository source art; only the small toolbar
exports are newly registered for serving.

## In the game

`title-logos.json` names the two toolbar exports as the `toolbar` of their
matching wordmarks, assigned by `src` (indices 0 and 1, unchanged). The
image and asset builders registered them; the natives are not served.
`test/card-title-alternates.test.mjs` checks every toolbar image for an
alpha channel and transparent corners. Alpha, corners, sizes and SHA-256s
were rechecked with Pillow on integration.
