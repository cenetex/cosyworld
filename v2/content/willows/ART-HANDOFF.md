# Willows paintings and notebook cards

Art handoff, 2026-10-31; revised 2026-11-01 to the owner's latest painting brief.
Related work: [the Willows redesign](https://github.com/cenetex/cosyworld/issues/1626),
[the notebook](https://github.com/cenetex/cosyworld/issues/1629), and
[state backdrops](https://github.com/cenetex/cosyworld/pull/1620).

The [owner's original brief and paste-ready prompts](ART-BRIEF.md) are preserved
verbatim, with table column whitespace normalized. The commission is **nine
required scenery edits, one optional scenery edit, and five notebook cards**. It replaces the earlier
proposed filenames and extra day/night sets. Each sign transforms its existing
place. Keep the camera, shore, tent, roots and foreground footing consistent;
change the objects only where the brief says to, including turning the mended
canoe upright. This document does not claim that new paintings or Observe rules
have landed. Timing recommendations are separate from current code.

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

## Existing art and safe fallbacks

The owner approved `thicket-uncanny.webp`, `camp-uncanny.webp`,
`camp-dark-night.webp`, and `bank-uncanny.webp` as stand-ins until the new set
arrives. Keep each in its own place and original lighting state:

| Approved stand-in | Existing visual and lighting | Use constraint |
| --- | --- | --- |
| `thicket-uncanny.webp` | Dusk thicket; branches lean into the passage | A daytime thicket stand-in, not a night relight |
| `camp-uncanny.webp` | Original warm camp; tent panel pressed inward | A daytime camp stand-in with the existing fire preserved |
| `camp-dark-night.webp` | Dark camp; fire out with a few dim embers | Available when a real committed fire-out state exists; presently unbound |
| `bank-uncanny.webp` | Dusk bank; an over-tall spray of distant willow vegetation | A daytime bank stand-in, keeping the bank's camera |

**A missing alternate falls back to the existing base painting for the current
place and saved lighting.** A commission filename is not a public asset until
its bytes, variants and registration exist. Do not add a selector for an
unpainted target, change the day/night clock to show one, or substitute another
place's backdrop. Ship scenery retains priority while its crossing is open.

The existing paintings provide these verified matches and lighting bases:

| Place and sign | Existing painting | Available role and saved condition |
| --- | --- | --- |
| Landing: ship in dark mist | `landing-ship-night.webp` | First priority: night, mist on `greek-ship`, and ship at Black Pond or at sea; holds while that crossing is open |
| Landing: night without the ship | `landing-night.webp` | Night fallback below the ship entry; low river mist is already painted |
| Camp: ordinary night | `camp-lit-night.webp` | Night fallback; campfire lit, portable lamp independent |
| Camp: tent pressure | `camp-lit-night-uncanny.webp` | Night plus `willows-patterings-heard`; holds while the conditions hold |
| Thicket: ordinary night | `thicket-night.webp` | Quiet night base; it does not show a bronze column |
| Bank: ordinary night | `bank-night.webp` | Quiet night base; it does not show the pale shape or drowned man |

The camp pressure match reads an existing discovery receipt. It does not
replace the named discovery choices with Observe. The Observe work should
retain the receipt identities. The generic uncanny flickers remain separate
from held discoveries. Full-size visual review confirms that the thicket and
bank night files are lighting bases, not sign paintings; the earlier handoff's
claim that they already showed the bronze ascent and pale body was incorrect.
Only the new named targets can supply those specific visual discoveries.

The prepared entries have no timed return. Their current state change uses
900 ms; a day/night change uses 4000 ms. Travel uses its existing veil and
reduced motion cuts. The new transient recommendations below need presentation
support before they can be promised as behavior.

## Exact scenery commission

Every target is an **opaque 1672 × 941 WebP, at most 300 KB**. Filenames and
exact bases are in the pinned Willows folder above. Preserve the source
composition, materials and painted finish. Each row describes the intended
lighting; none bakes the portable lamp into the background.

| Target filename | Exact base to edit | Day/night and lighting | Observe sign and visual change | Recommended hold or return |
| --- | --- | --- | --- | --- |
| `landing-otter.webp` | `landing.webp` | Day slot; original low sun; no painted lamp/fire | A black wet otter rolls in the current twenty feet out, turning like a drowned man, with **one yellow eye** catching the low sun | 900 ms in, 6000 ms fully shown, 900 ms back to the current base |
| `landing-boatman.webp` | `landing.webp` | Day slot; original sunset; no painted lamp/fire | On the far shore, a man stands in a flat boat swept downstream, one arm raised making the sign of the Cross toward the island | 900 ms in, 6000 ms fully shown, 900 ms back; night observations retain their matching base |
| `landing-mended.webp` | `landing.webp` | Day slot; source light; no painted lamp/fire | Canoe upright and mended at the edge, paddle across it, rope coiled and sheet folded ready to launch | Holds after a committed repair completion; 900 ms in; night falls back to the available night base until a matching repair image exists |
| `camp-closer.webp` | `camp.webp`; use `camp-lit-night.webp` only as a lighting reference | **Night treatment** of the exact camp composition; retain the fixed campfire; portable lamp may be lit or doused independently | The willow ring is visibly nearer than by day, with branches reaching over the fire | Holds after the nearer receipt while night; 900 ms in, 4000 ms back to the day base at dawn |
| `camp-tent-pressure.webp` | `camp-lit-night.webp` | Night; existing lit campfire and its glow; portable lamp independent | Canvas sagging inward as if pressed from above, with faint wet patter marks on the sand around it; keep poles, ropes, stakes and tent position | 900 ms in, 6000 ms fully shown, 900 ms back to the current camp state |
| `thicket-bronze.webp` | `thicket-night.webp` | Cool night; no painted lamp/fire | Dim dull-bronze fluid shapes ascend in a bending column through the willow tops, without faces | 900 ms in, 6000 ms fully shown, 900 ms back to the current thicket state |
| `thicket-hollows.webp` **optional** | `thicket.webp` | Day slot; original dusk exposure; no painted lamp/fire | Many smooth cup- or bowl-shaped hollows between the roots | Holds after the hollows receipt while its light matches; 900 ms in |
| `bank-humming.webp` | `bank.webp` | Original dusk; no painted lamp/fire | The far willows shimmer while water near the bank is still | 900 ms in, 6000 ms fully shown, 900 ms back to the current bank state |
| `bank-roots.webp` | `bank.webp` | Day slot; original dusk; no painted lamp/fire | A pale shape caught beneath bare roots; concentrate the edit there while retaining the full bank camera | Holds after the roots discovery while its light matches; 900 ms in |
| `bank-drowned.webp` | `bank-night.webp` | Cool night; no painted lamp/fire | A face-up drowned man caught in the roots, with small smooth hollow marks on his skin | Holds after the marked-body receipt at night; 900 ms in, 4000 ms to the available day state at dawn |

For a transient, restore the currently valid base or held painting when its
hold ends, not an image remembered before a ship, lamp or clock change. Cancel
on travel; do not replay a six-second reveal from a permanent knowledge flag
alone. Reduced motion changes paintings instantly. Where two signs are known,
the current event may briefly take the frame, then restore the valid held
state. No combined new painting is implied by this list.

`landing-mended` awaits the repair completion from the scattered-kit work.
Today's `willows-gear-laid` means preparation, not a mended canoe. Use the
ordinary landing until the real repair receipt exists. The approved map
redesign makes the thicket a travel painting; keep its imagery with that
passage if it moves. Do not render a thicket camera while standing at the bank.

### Receipt map for implementation

| Existing receipt / future Observe sign | Requested target or retained base |
| --- | --- |
| `willows-hull-seen`: slit hull and worn paddle | Existing landing and worn-paddle item |
| `willows-stores-counted`: missing bread | Existing camp; the recorded fact describes the closed sack's missing contents |
| `willows-hollows-seen`: sand hollows | Optional `thicket-hollows`; existing thicket or approved matching stand-in until supplied |
| `willows-humming-heard`: metallic humming | `bank-humming` in matching dusk light |
| `willows-mark-seen`: marked shape below the roots | `bank-roots` by day, `bank-drowned` by night; retain the matching lighting base until supplied |
| `willows-otter-seen`: thing in the current | `landing-otter` by day |
| `willows-boatman-seen`: passing boatman | `landing-boatman` in its sunset light; existing night base otherwise |
| `willows-willows-paced`: eleven paces | Existing ordinary camp |
| `willows-willows-nearer`: nine paces | `camp-closer` at night |
| `willows-patterings-heard`: tent pressure | `camp-tent-pressure` at night |
| `willows-shapes-seen`: bronze ascent | `thicket-bronze` at night |
| `willows-signs-shared`: compare discoveries | Conversation and existing Swede poses |
| Future committed repair completion | `landing-mended`; no fabricated receipt identifier |

## Traveller's Notebook: exact card set

Nine pages assemble into three readable chapter cards, then one book. Three
page illustrations provide the visual variants; page identity, chapter,
title/index and the real readable writing remain item/UI data. Assignment of
the thirteen Blackwood passages belongs to the lore/content work.

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

## Delivery and integration checks

- Preserve the original generation output, exact base hashes, tool and complete
  prompts in provenance. Check every scenery file is at most 300 KB, 1672 × 941
  and opaque; all five notebook sources are 1254 × 1254 PNGs with true alpha.
- Register delivered source art and build stage/card variants and public assets
  with repository scripts. Update the manifest from actual bytes.
- Inspect each alternate against its base at desktop and 390 px phone width.
  Keep each place's framing stable across a sign. The camp's prepared runtime
  uses one 82% horizontal focus so the tent remains visible on a phone.
- Validate before/after the receipt, day/night, lamp lit/doused, ship
  present/absent and missing alternate. Held art must not reveal an unearned
  discovery; the separately governed uncanny flicker keeps its existing rules.
- Missing or unregistered art uses the current base. A requested transient is
  not complete until its presentation mechanism, timing and restoration are
  tested. A finished image alone does not establish a working Observe event.
