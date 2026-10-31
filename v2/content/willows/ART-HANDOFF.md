# Willows paintings and notebook cards

Art handoff, 2026-10-31. Related work: [the Willows redesign](https://github.com/cenetex/cosyworld/issues/1626),
[the notebook](https://github.com/cenetex/cosyworld/issues/1629), and
[state backdrops](https://github.com/cenetex/cosyworld/pull/1620).

Each sign changes its own existing place. Keep the camera, shoreline, tent,
canoe, roots, and foreground footing fixed. This is a commission list and a
mapping of existing art, not evidence that the Observe rules or new paintings
have landed. Hold durations below are implementation recommendations where the
owner has not already specified one.

## Exact reference set

All base files below are under `v2/card-game/assets/willows/` at commit
[`8ef5d8eee3ac1f095dc6f16df274e9d968dd83e6`](https://github.com/cenetex/cosyworld/tree/8ef5d8eee3ac1f095dc6f16df274e9d968dd83e6/v2/card-game/assets/willows).
Use those exact bytes; the SHA-256 checks below identify them even after main
moves. All scenery bases are opaque 1672 × 941 WebPs. The normal paintings
occupy the game's day slot but retain their original warm evening light;
do not silently turn an edit into a new daytime composition.

| Base file | SHA-256 |
| --- | --- |
| `landing.webp` | `589d52b6c0d24168c7f57952f2fae3aa6550726c7e1897eef7616979fff55804` |
| `landing-night.webp` | `b6f8aa5cab224eac85b54e677810487c1be6a202df8d9869ab3176a3a444d4e4` |
| `landing-ship-night.webp` | `eccc07e492fe00237e93746026c69d88e515a91553cdc766cbdf97e0e102a887` |
| `camp.webp` | `b45b2f36bca38d187e277b57704bbb9a7600a087d9cb4dcb6406049c74e10314` |
| `camp-lit-night.webp` | `3aeac8f45d6c1422f1ffb410a01a7709d607c25a4f9a4781e6fcef1ed41e2aef` |
| `camp-lit-night-uncanny.webp` | `93e0e8c7cda55b629a25950662b6f725e817a26268958eb916f0a5b405bc7b12` |
| `camp-dark-night.webp` | `cd5e5ea072c79a0a1ea6b7645d6950126db124ebf646d04cf0af2a08408689dd` |
| `thicket.webp` | `ac2324c2edd0d98f8d7ecf11f3b30ccdd891261ba0b5514896305b41064cd95c` |
| `thicket-night.webp` | `d91e0177754a1b9a7ab728d59ce574bfa50068de8e44f0b11672239ce108406d` |
| `bank.webp` | `1b7d169860245febcaccad142b6ee7ecba37d8d302ff75e8128e6584bc07ca19` |
| `bank-night.webp` | `427b7e1e3c12c3c095f9d78a0ac9727f7ae224a1cd70cd45f93d7463924525ae` |
| `map.png` | `d792e96b98f682a901f9022925bb3b42b12c916510c93690980cde4d614b3468` |
| `sheet.png` | `8eedda5b40290ae4ed32d2af1ad1a2a9dac9f3bf7a80701558d21b19fc60a4f0` |
| `rope.png` | `00ed54fffb54e2535f44eadbe68c45c89b5ec4fd08d2f82852ccf3ade865f6ea` |

**Lamp and fire are separate.** The camp paintings contain a fixed campfire.
The portable `lamp` is an ordinary carried item whose saved light and custody
may change. No lamp is painted into these backgrounds. Every camp commission
below must work with that lamp either lit and present or doused/absent; leave
its additional light to the stage. Do not use a doused lamp as evidence that
the campfire is out. The current pack has no saved campfire control.

## Existing paintings: use these first

The paired content change uses the place's first matching `backdrops` entry.
It reads existing committed discovery flags; the Observe work should keep
these receipt identities when it replaces the named discovery buttons.

| Place and sign | Existing painting | Saved condition and behavior |
| --- | --- | --- |
| Landing: ship present in dark mist | `landing-ship-night.webp` | First priority: night, mist on `greek-ship`, and ship at Black Pond or at sea. Holds while that crossing is open. |
| Landing: night without the ship | `landing-night.webp` | Night fallback below the ship entry. Low river mist is already in the painting. Holds through the night. |
| Camp: ordinary night | `camp-lit-night.webp` | Night fallback. Campfire lit; portable lamp independent. |
| Camp: patterings and pressure on the tent | `camp-lit-night-uncanny.webp` | Night plus `willows-patterings-heard`. Same tent, now depressed inward. Holds while night and the saved flag hold. |
| Thicket: bronze forms above the leaves | `thicket-night.webp` | Night plus `willows-shapes-seen`. Holds while night and the saved flag hold. |
| Bank: something caught below the roots | `bank-night.webp` | Night plus `willows-mark-seen`. Holds while night and the saved flag hold. |

There is no timed return in these entries: a 900 ms state crossfade settles on
the chosen painting; a day/night change uses 4000 ms. Travel uses its existing
veil. Reduced motion cuts immediately. These timings come from
`transitions.mjs` and the renderer, not a new rule or timer in the save.

The two night discovery paintings must **not** be unconditional night defaults:
`thicket-night` already contains the bronze form and `bank-night` already
contains the pale shape. Their quiet counterparts are the first commissions
below. Until then, undiscovered thicket/bank scenes retain their existing base.

### Complete sign audit

| Current receipt / future Observe sign | Art decision |
| --- | --- |
| `willows-hull-seen`: slit hull and worn paddle | Keep `landing.webp`; it already has the fine hull seam. The paddle has its own worn item art. No new wide painting. |
| `willows-stores-counted`: missing bread | Keep the camp. The closed sack painting cannot truthfully show its contents; the recorded fact carries the absence. No new wide painting. |
| `willows-hollows-seen`: smooth sand hollows | Keep the thicket's existing hollows. Do not use `landing-uncanny` to move a thicket discovery to the landing. |
| `willows-humming-heard`: metallic humming | Keep the bank; this is an auditory sign. Use the existing hum, not a new visible creature. |
| `willows-mark-seen`: marked shape below the roots | Existing night painting; day counterpart missing (B2). |
| `willows-otter-seen`: yellow-eyed thing in the current | Day alternate missing (L1). |
| `willows-boatman-seen`: passing boatman crosses himself | Day and both night compositions missing (L2–L4). Existing rule allows any hour. |
| `willows-willows-paced`: eleven paces | Keep the ordinary camp as the visual measurement. |
| `willows-willows-nearer`: nine paces | Matched day/night camp alternates missing (C1–C3). The thicket's inward branches are a different place. |
| `willows-patterings-heard`: pressure on the tent | Existing lit-night pressure painting matches exactly; reuse it. |
| `willows-shapes-seen`: bronze ascent | Existing night thicket painting matches; reuse it. |
| `willows-signs-shared`: compare discoveries | Conversation and existing Swede poses; no additional landscape. |

The generic uncanny flickers remain separate from these held discovery states.
`landing-uncanny`, `camp-uncanny`, `thicket-uncanny`, and `bank-uncanny` are
available but do not supply missing day/night versions of unrelated signs.
`camp-dark-night` is finished art awaiting a real fire-state binding; it is
not assigned to `lamp` or to a guessed ending flag.

## Missing scenery: ten exact edits

Target and base filenames are in the pinned Willows folder above. Each row is
one full painting, not a new camera or an independently laid-out scene.
Only the stated feature changes. Match the source exposure and brush texture.

| ID / target filename | Exact base to edit | Day/night and lighting | Observe sign and visual change | Hold or return; intended timing |
| --- | --- | --- | --- | --- |
| T1 `thicket-night-quiet.webp` | `thicket-night.webp` | Cool night; no painted lamp or fire | Before the bronze sign: remove only the faint bronze column; keep every leaf, hollow, path and sky feature | Holds as ordinary night; 4000 ms on day/night change |
| B1 `bank-night-quiet.webp` | `bank-night.webp` | Cool night; no painted lamp or fire | Before the roots sign: remove only the small pale shape beneath the roots; preserve waterline, roots and lighting | Holds as ordinary night; 4000 ms on day/night change |
| C1 `camp-nearer.webp` | `camp.webp` | Day slot, original warm evening exposure; campfire lit; portable lamp independent | Nine paces: move the surrounding willow masses inward, narrow the river gap and space behind the tent; keep tent, pot, fire, guy ropes and camera fixed | Holds after the nearer receipt, including later days; 900 ms in, 4000 ms to its night counterpart |
| C2 `camp-nearer-lit-night.webp` | `camp-lit-night.webp` | Night; original campfire light; portable lamp independent | Same nearer geometry as C1 under the exact existing night lighting | Holds after the nearer receipt at night; 900 ms in, 4000 ms to C1 at dawn |
| C3 `camp-nearer-lit-night-pressure.webp` | `camp-lit-night-uncanny.webp` | Night; original campfire light; portable lamp independent | Add C2's inward willow geometry while retaining the existing tent depression, so learning the second sign does not erase the first | Holds at night while nearer and patterings receipts both hold; 900 ms in, 4000 ms to C1 at dawn |
| B2 `bank-mark-day.webp` | `bank.webp` | Day slot, original evening exposure; no painted lamp or fire | The roots sign: add a small muted pale shape in the same waterline position as `bank-night`; partial, obscured, no new foreground body or gore | Holds after the mark receipt by day; 900 ms in, 4000 ms to the existing night reveal |
| L1 `landing-otter.webp` | `landing.webp` | Day slot, original low-sun exposure; no painted lamp or fire | The otter: one small dark rolling shape in the existing current, two subdued yellow eye points; preserve canoe, bank and scale | Recommended transient: 900 ms in, 6000 ms fully shown, 900 ms back to the current underlying painting |
| L2 `landing-boatman.webp` | `landing.webp` | Day slot, original exposure; no painted lamp or fire | One small flat boat on the far shore; standing boatman making the Cross, distant enough to belong to this river | Recommended transient: 900 ms in, 6000 ms fully shown, 900 ms back |
| L3 `landing-boatman-night.webp` | `landing-night.webp` | Dark misty night; no ship lights, lamp or fire | Same small boatman and gesture as L2, readable in subdued night light; no added light source | Recommended transient: 900 ms in, 6000 ms fully shown, 900 ms back |
| L4 `landing-ship-boatman-night.webp` | `landing-ship-night.webp` | Dark misty night; existing Greek ship lanterns retained; no portable lamp baked in | Same far-shore boatman; retain the complete existing ship and its reflection so the sign does not make the ship vanish | Recommended transient: 900 ms in, 6000 ms fully shown, 900 ms back |

Paint T1/B1 first, then C1–C3, B2, and L1–L4. C3 is a required combination,
not a fourth camp condition guessed by the renderer. The future transient
selector must restore whatever state is current when the hold ends, cancel
on travel, never replay from a saved knowledge flag alone, and cut under
reduced motion. It does not exist in the paired content change.

The approved three-place redesign turns the thicket into a travel painting.
This mapping preserves its current composition and receipts. If the Observe
work moves the bronze sign to the bank, commission a bank edit from `bank.webp`
or its night counterpart before changing the mapping; do not show the thicket
camera while standing at the bank. New fire-out combinations wait until there
is a committed campfire state; no speculative extra set is requested here.

## Traveller's Notebook: three page variants and two assembled cards

The latest owner decision is **nine pages → three readable chapter cards →
one book**, not three separate volumes. Each chapter's three pages can share
one illustration; title/index and the real readable writing belong to the UI.
The chapter themes below are art recommendations, not an invented assignment
of Blackwood passages. The lore/content owner assigns the thirteen passages.

**Existing item reference:** use pinned `map.png` for paper grain, rubbed
edges, dimensional folds, ink and muted blue-grey/ochre colour. Its actual
canvas is **1254 × 1254 RGBA**, despite the older prompt requesting 1024.
Use pinned `sheet.png` for the book's dark waxed-cloth cover and `rope.png`
for its simple flax binding. These are material/style references for new
objects, not backgrounds or literal text to copy.

Keep each object opaque with true transparency around it, fully inside the
same square canvas with breathing room, and use the existing gouache/ink
finish and soft upper-left warmth. One neutral item light serves day and
night; neither the portable lamp nor the campfire is baked into the card.
No scenery, card frame, labels, readable invented writing or drop-shadow box.

| Target filename | Exact existing references | Distinguishing art |
| --- | --- | --- |
| `notebook-page-river.webp` | `map.png` | One cream folded leaf, open and comparatively tidy; sparse river-channel sketch and orderly ink strokes; a small upper-right corner fold |
| `notebook-page-island.webp` | `map.png` | Same paper scale and view; silver willow-leaf study and three smooth hollow diagrams; denser uneven strokes, a small middle-edge notch |
| `notebook-page-watch.webp` | `map.png` | Same paper scale and view; exposed-root and current sketches, interrupted strokes, a damp grey tide mark at the lower edge; no monster drawing |
| `notebook-chapter.webp` | `map.png`, `rope.png` | Three matching leaves lightly bound with one flax stitch; edges visibly layered; chapter title and progress remain UI text |
| `travellers-notebook.webp` | `map.png`, `sheet.png`, `rope.png` | Small closed, worn waxed-cloth notebook, warm paper edges and plain flax binding; a complete volume, with no lettering or extra props |

All five are missing. A page/chapter/book card holds as its item exists;
assembly changes the item, not a timed art flash. The three page designs must
remain distinguishable at the generated 512 × 512 card size by folds, edge
shape and drawings as well as colour.

## Delivery and integration checks

- Supply the ten scenery edits at 1672 × 941, opaque WebP; preserve their
  exact base crops. Supply the five inventory objects at 1254 × 1254 with
  true alpha. Keep original generation output and reference hashes in provenance.
- Register source art, rebuild stage/card variants and the public manifest
  with the repository scripts, and record the actual tool and full prompts.
- Compare each edit with its pinned base at desktop and 390 px phone width.
  The changed detail must remain legible without moving the place's landmarks.
- Validate before/after discovery, night/day, portable lamp lit/doused, ship
  present/absent and both camp flags together. Day/night variants never reveal
  an unearned sign. No new scene replaces the place to make a sign visible.
- Update `card-world.json` only when an asset is registered and its condition
  is supported. A transient needs its presentation mechanism before wiring;
  no entry should point at an unpainted target from this list.
