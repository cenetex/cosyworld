# Willows art handoff and integration status

Reconciled 2026-11-01 with [Observe PR #1640](https://github.com/cenetex/cosyworld/pull/1640) at
[fca8307c](https://github.com/cenetex/cosyworld/tree/fca8307c40e60129598df90a867b45fa71eb0f48).
The [owner's original brief and paste-ready prompts](ART-BRIEF.md) are preserved
verbatim, with table column whitespace normalized.

## Art complete; integration remains separate

All **fifteen requested source assets are produced**: nine required scenery
edits, the optional thicket hollows, and five notebook cards. The ten scenery
files were checked as opaque RGB 1672 × 941 WebPs, 279,596–298,776 bytes each.
The five notebook sources are 1254 × 1254 RGBA PNGs with transparent surroundings.
Public registration, optimized variants and landing belong to the art change;
a finished source file does not establish a live sign binding.

This handoff introduces no competing Willows rule or painting selector. The
local experiment based on permanent knowledge flags is parked and unpublished.
The owner’s newest-sign behavior below replaces that experiment and the
earlier six-second return proposal.

### What #1640 implements, and what its design plans next

At the pinned head, #1640 marks twelve existing choices `on: "wait"`.
Each human Observe commits at most one feasible sign, selected by a seeded
hash, while preserving the existing choice ids, receipts and flags. It is
still Willows revision 1 with **four places**. Hollows and bronze shapes still
have `at: willows-thicket`. There are **no Willows `backdrops` entries or
newest-sign art selector** in that head. Its PR body describes the art contract;
the code has not yet implemented those bindings.

The [pinned design](https://github.com/cenetex/cosyworld/blob/fca8307c40e60129598df90a867b45fa71eb0f48/docs/design/willows-kit-and-signs.md)
separates the next work into steps:

- Step 2 folds the thicket into the camp-to-bank travel painting. Its hollows
  and shapes are Observed at camp and shown on that travel painting. The kit
  gates the canoe and the Swede through four `item_near` conditions at camp.
- Step 3 records the Swede’s departure and closes the canoe route after he
  takes it. No fallback returns him.
- Step 4 retires the otter and boatman as signs and uses seeded per-turn
  `chance` windows for their landing paintings. Odds and window length are
  not specified in the design; do not invent seconds or a new knowledge flag.
- The notebook remains nine pages → three readable chapter cards → one book.

These are design stages, not claims that the thicket relocation, kit gate,
departure or chance condition has already landed in #1640.

## Hold and fade contract

**A sign painting holds while that sign is the place’s newest sign.** When a
newer sign is recorded, select that sign’s matching-light alternate, or the
ordinary base if it has none. Missing or unregistered art must show the base;
it must not revive an older known sign. Persistent knowledge flags alone do
not determine the selected painting.

There is **no six-second return timer**. The existing
[presentation transitions](../../card-game/transitions.mjs) use 900 ms for a
state change and 4000 ms for day/night changes; reduced motion cuts and travel
uses its existing veil. These transitions do not establish the missing
newest-sign selector. The later random landing windows follow their own
committed chance conditions, once implemented.

Preserve the saved time and actual lighting. A daytime-only alternate leaves
the appropriate night base in place at night. Keep thicket imagery on the
thicket travel composition when step 2 lands; do not substitute that camera
for the camp or bank painting.

## Exact reference set

All base files below are under `v2/card-game/assets/willows/` at commit
[`8ef5d8eee3ac1f095dc6f16df274e9d968dd83e6`](https://github.com/cenetex/cosyworld/tree/8ef5d8eee3ac1f095dc6f16df274e9d968dd83e6/v2/card-game/assets/willows).
Use those exact bytes; the SHA-256 checks below identify them even after main
moves. All scenery bases are opaque 1672 × 941 WebPs. The normal paintings
occupy the game's day slot but retain their original warm evening light;
preserve it except for the explicitly requested night treatment of camp-closer.

| Base file | SHA-256 |
| --- | --- |
| `landing.webp` | `589d52b6c0d24168c7f57952f2fae3aa6550726c7e1897eef7616979fff55804` |
| `landing-uncanny.webp` | `fc10feeaa45b6bd2e6e653dcd8f360ff0dd8ef9894b89a78896c84bd2ca3f15c` |
| `landing-night.webp` | `b6f8aa5cab224eac85b54e677810487c1be6a202df8d9869ab3176a3a444d4e4` |
| `landing-ship-night.webp` | `eccc07e492fe00237e93746026c69d88e515a91553cdc766cbdf97e0e102a887` |
| `camp.webp` | `b45b2f36bca38d187e277b57704bbb9a7600a087d9cb4dcb6406049c74e10314` |
| `camp-lit-night.webp` | `3aeac8f45d6c1422f1ffb410a01a7709d607c25a4f9a4781e6fcef1ed41e2aef` |
| `camp-lit-night-uncanny.webp` | `93e0e8c7cda55b629a25950662b6f725e817a26268958eb916f0a5b405bc7b12` |
| `camp-uncanny.webp` | `2322acd0f14dee3fe4034a297ddad18ee5fbf376bc5c42e66894d6fd0179ea68` |
| `thicket-uncanny.webp` | `555a3fcf3d51185f2777dbd4b0a73293479dec7d399abec387053ffc073fddaa` |
| `bank-uncanny.webp` | `83dc4e3c118c6348448e54b6043ad5f74c469c6f73857fbcdc355bd0737f9843` |
| `camp-dark-night.webp` | `cd5e5ea072c79a0a1ea6b7645d6950126db124ebf646d04cf0af2a08408689dd` |
| `thicket.webp` | `ac2324c2edd0d98f8d7ecf11f3b30ccdd891261ba0b5514896305b41064cd95c` |
| `thicket-night.webp` | `d91e0177754a1b9a7ab728d59ce574bfa50068de8e44f0b11672239ce108406d` |
| `bank.webp` | `1b7d169860245febcaccad142b6ee7ecba37d8d302ff75e8128e6584bc07ca19` |
| `bank-night.webp` | `427b7e1e3c12c3c095f9d78a0ac9727f7ae224a1cd70cd45f93d7463924525ae` |
| `map.png` | `d792e96b98f682a901f9022925bb3b42b12c916510c93690980cde4d614b3468` |
| `sheet.png` | `8eedda5b40290ae4ed32d2af1ad1a2a9dac9f3bf7a80701558d21b19fc60a4f0` |
| `rope.png` | `00ed54fffb54e2535f44eadbe68c45c89b5ec4fd08d2f82852ccf3ade865f6ea` |

**Lamp and fire are separate.** The camp paintings contain a fixed campfire.
The portable `lamp` has its own saved light and custody. No portable lamp is
painted into these backgrounds: each camp edit must work with it lit and
present, or doused/absent. Preserve the painted campfire's actual state. The
current pack has no saved campfire control, so dousing the lamp cannot select
the fire-out painting. Do not invent a fire flag to make an asset selectable.

## Existing art mapped by the owner

The interim mapping comes from #1640’s art handoff. Its partial fits and
lighting differences remain explicit; the new named assets replace the
interims once registered and integrated.

| Sign / planned surface | Interim file | Fit and lighting |
| --- | --- | --- |
| Sand hollows / thicket travel | `thicket-uncanny.webp` | Owner’s good interim: foreground hollows; original dusk light |
| Paced nearer / camp at night | `camp-uncanny.webp` | Owner’s fair interim: wrong sky; warm dusk painting |
| Tent pressure / camp at night | `camp-dark-night.webp` | Owner’s partial interim: fire out with embers, tent not sagging; do not equate that fire with the portable lamp |
| Mark under roots / bank | `bank-uncanny.webp` | Owner’s partial interim: dusk river shapes; no explicit drowned body |
| Slit hull / landing (outside the new set) | `landing-uncanny.webp` | Owner’s additional existing match: hollows beside the canoe |

The plain `landing-night.webp`, `thicket-night.webp` and
`bank-night.webp` are night lighting bases. Full-size review confirms that
the thicket night base has no bronze column and the bank night base has no
pale or drowned body. `camp-lit-night.webp` is the lit-fire night base;
`camp-lit-night-uncanny.webp` visibly depresses its tent canvas. These facts
identify available art, not completed sign bindings.

## Exact scenery set

All targets are under `v2/card-game/assets/willows/`. Every scenery file is
opaque 1672 × 941 WebP and at most 300 KB. The complete owner prompts are in
`ART-BRIEF.md`; the table below adds exact bases, lighting and the integration
contract. It preserves the source camera, horizon, shore, tent and foreground.

| Target filename | Exact base to edit | Lighting and visual change | Hold / return |
| --- | --- | --- | --- |
| `landing-otter.webp` | `landing.webp` | Original low sun; black wet otter rolls twenty feet out, turning like a drowned man, one yellow eye. No painted lamp/fire. | Step 1: newest landing sign in daylight. Planned step 4: seeded chance window; duration unspecified. Use existing 900 ms state fade. |
| `landing-boatman.webp` | `landing.webp` | Original sunset; man in flat boat swept down the far shore, one arm raised crossing himself toward the island. No painted lamp/fire. | Step 1: newest landing sign in daylight. Planned step 4: daylight chance window; duration unspecified. 900 ms state fade. |
| `landing-mended.webp` | `landing.webp` | Original daylight-slot light; canoe upright and mended at the edge, paddle across it, rope coiled and sheet folded. | Planned kit/canoe availability state, not a sign or repair flag. Holds only while its route conditions hold and this light matches; 900 ms state fade. |
| `camp-closer.webp` | `camp.webp`; `camp-lit-night.webp` as lighting reference | Night treatment of the exact camp composition; willow ring nearer the tent, branches over the fixed lit fire. Portable lamp independent. | Holds only while the nearer sign is newest at camp and it is night; 900 ms state change, 4000 ms day/night change. |
| `camp-tent-pressure.webp` | `camp-lit-night.webp` | Night, existing lit campfire; canvas sags inward from above, wet patter marks on surrounding sand. Portable lamp independent. | Holds while tent pressure is the newest camp sign and it is night. No fixed return; 900 ms state change. |
| `thicket-bronze.webp` | `thicket-night.webp` | Cool night; dull-bronze fluid shapes ascend in a bending column through willow tops, without faces. No painted lamp/fire. | Newest-sign hold on the thicket painting at night; step 2 observes it at camp and renders it on thicket travel. No fixed return. |
| `thicket-hollows.webp` (optional, produced) | `thicket.webp` | Original dusk/day slot; many smooth cup- to bowl-sized basins between roots. No painted lamp/fire. | Newest-sign hold in matching light on the thicket painting; step 2 moves its observation to camp and its display to travel. No fixed return. |
| `bank-humming.webp` | `bank.webp` | Original dusk; faint shimmer above distant willows, still water near the bank. No painted lamp/fire. | Holds while humming is the newest bank sign and this light matches; otherwise the appropriate base. 900 ms state change. |
| `bank-roots.webp` | `bank.webp` | Original dusk/day slot; pale shape caught beneath bare roots. “Close on” focuses the edit, without cropping or moving the camera. | Holds while the roots discovery is the newest bank sign in matching daylight. 900 ms state change. |
| `bank-drowned.webp` | `bank-night.webp` | Cool night; drowned man face-up in the roots with smooth hollow marks on skin. No painted lamp/fire. | Night companion to the newest roots discovery; 900 ms state change and 4000 ms when the saved day/night phase changes. |

All four kit objects in the planned canoe condition are the Worn Paddle,
Waterproof Sheet, Tent Rope and Food Sack at camp. Carrying one away makes the
canoe and the Swede wait again. The existing `willows-gear-laid` flag only
records the old preparation chain; it must not select `landing-mended`.
The planned departure then removes the canoe with the Swede. Follow the
owner’s kit/departure implementation; do not fabricate a repair receipt.

### Existing identities for the owner’s selector

The choice ids below are the actual receipt keys retained by #1640. Their
flags preserve knowledge and poses; selecting the newest painting needs the
owner’s receipt-order rule rather than testing those booleans alone.

| Choice / receipt key | Knowledge flag | Requested art or base |
| --- | --- | --- |
| `willows-examine-hull` | `willows-hull-seen` | Existing landing / owner’s landing-uncanny interim |
| `willows-count-stores` | `willows-stores-counted` | Existing camp base |
| `willows-examine-hollows` | `willows-hollows-seen` | thicket-hollows; thicket travel in step 2 |
| `willows-hear-humming` | `willows-humming-heard` | bank-humming in its dusk light |
| `willows-look-beneath-roots` | `willows-mark-seen` | bank-roots by day / bank-drowned at night |
| `willows-watch-otter` | `willows-otter-seen` | landing-otter; later replaced by chance selection |
| `willows-watch-boatman` | `willows-boatman-seen` | landing-boatman; later replaced by chance selection |
| `willows-pace-willows` | `willows-willows-paced` | Existing camp base |
| `willows-pace-again` | `willows-willows-nearer` | camp-closer at night |
| `willows-listen-tent` | `willows-patterings-heard` | camp-tent-pressure at night |
| `willows-look-up-willows` | `willows-shapes-seen` | thicket-bronze; thicket travel in step 2 |
| `willows-compare-signs` | `willows-signs-shared` | Existing camp and Swede poses |

## Traveller's Notebook: exact card set

Nine pages assemble into three readable chapter cards, then one book. Three
page illustrations provide the visual variants; page identity, chapter,
title/index and the real readable writing remain item/UI data. Readable
passage assignment belongs to the lore/content work.

The existing item reference is pinned **`map.png`**: paper grain, rubbed edges,
dimensional folds, muted colour and tangible painted material. Its actual
canvas is **1254 × 1254 RGBA**. Use pinned `sheet.png` for the book's oilcloth
material and `rope.png` for simple string. These are exact style/material
references for new objects, rather than a background to copy.

All five deliverables are **1254 × 1254 transparent PNGs**. Keep the object
opaque, its surroundings genuinely transparent, and its complete silhouette
inside the canvas with breathing room. Use the existing item set's painted
finish, pencil handwriting and drawings on the pages, and soft upper-left warmth. One neutral
item light serves day and night, with no portable lamp or campfire baked in.

| Target filename | Existing references | What distinguishes it |
| --- | --- | --- |
| `notebook-page-1.png` | `map.png` | One torn page with a pencil drawing of the canoe on the sand spit |
| `notebook-page-2.png` | `map.png` | A matching torn page with a pencil drawing of willow tops |
| `notebook-page-3.png` | `map.png` | A matching torn page with a pencil drawing of round sand hollows |
| `notebook-chapter.png` | `map.png`, `rope.png` | Three river-damp pages stitched together, visibly layered |
| `notebook-book.png` | `map.png`, `sheet.png`, `rope.png` | A 1900s oilcloth-bound notebook tied with string |

The page drawings, folds and torn silhouettes must distinguish the three
variants at 512 × 512 card size. The full readable text stays in the Read view;
avoid invented legible prose in the paintings. Cards hold as their items exist;
assembly replaces items through the rules, with no timed image reversion.

## Framing handoff

The source edits preserve the intended place geometry. They were previewed
as state backdrops against the current four-place stage at 1440 × 900 and
390 × 844. Source-loading/reload checks passed; that is separate from whether
the clue is actually visible through the cast and interface.

| Painting | Observed result | Integration follow-up |
| --- | --- | --- |
| `camp-closer.webp` | The closer branches and tent remain visible with the same 82% horizontal focus across camp paintings. | Retain one stable crop. This image keeps the moon/star from camp.webp; ordinary camp-lit-night lacks them, so the sky detail also changes in the night fade. |
| `thicket-hollows.webp` | Extra low hollows are partly obscured by the central player and dialogue/card dock on a tall phone. | Recheck the planned thicket travel presentation; the old four-place preview does not establish its final framing. |
| `bank-roots.webp` | Pale shape below the roots is behind the central player on desktop and under the dialogue/card dock on a tall phone. | Expose the root area consistently before and after discovery; horizontal focus alone cannot fix the phone’s vertical obstruction. |
| `bank-drowned.webp` | Face and marked torso are mostly behind the central player on desktop and below the unobstructed phone scene. | Expose the same roots/body area across day and night without repainting or moving the bank camera. |

The existing image-first controls, cropped card unveiling and dialogue beats
do not provide a full-painting receipt view. No global CSS or new event system
was added to force these previews through. Keep the framing findings with the
owner’s integration work and do not claim that image availability alone
finishes the mobile presentation.

## Delivery and integration checks

- Preserve the generation output, complete prompts, exact base hashes and
  provenance. The fifteen source files pass the dimensions/opacity/alpha
  checks stated above; optimized variants and public registration belong to
  their art landing.
- Keep `ART-BRIEF.md` verbatim. This handoff follows the owner’s newest-sign
  hold contract and explicitly separates current #1640 code from later steps.
- Validate before a sign, after it becomes newest, after a different sign
  becomes newest, after save/reload, and after day/night changes. A newer sign
  without a suitable image must restore the base, never an older known sign.
- Skip an authored alternate that has no available stage entry in
  `image-variants.json`; a small client-only guard can enforce this without
  changing the rules or adding a saved flag. That guard does not implement
  receipt ordering.
- Preserve actual portable-lamp state, the painted campfire and ship-crossing
  priority. Do not use the fire-out interim merely because the lamp is doused.
- Recheck desktop, phone and the planned thicket travel stage before calling
  a binding visually complete. No new timer, repair flag, Observe conversion
  or competing permanent-knowledge binding is introduced by this art handoff.
