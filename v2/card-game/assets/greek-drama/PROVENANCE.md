# The Wine-Dark Sea: card art

This directory contains the world pack's original SVG illustrations,
painted settings, item sprites and character portraits. The repository's existing
[MIT license](../../../../LICENSE) applies. No image, illustration, character
design, or page asset from the Greek Drama Reader is reproduced.

## Chthonic character portraits

The fifteen `chthonic-*.png` portraits were generated with the built-in
`image_gen` tool on **2026-10-24**, following the user's direction,
**“chthonic Greek.”** They use dark earth, ash, worn cloth, and bronze to
give the mortal characters distinct appearances. The full generation
prompts are recorded in [chthonic-prompts.json](chthonic-prompts.json).

Each portrait is a **1024 × 1536 transparent RGBA PNG**. The original image
outputs were copied unchanged into this directory, retaining their generated
alpha channels. These are generated raster images.

| Portrait | Character identity |
| --- | --- |
| `chthonic-antigone.png` | Antigone |
| `chthonic-ismene.png` | Ismene |
| `chthonic-creon.png` | Creon |
| `chthonic-guard.png` | The Gate Guard |
| `chthonic-baker.png` | Dione the Baker |
| `chthonic-elder.png` | The Chorus Elder |
| `chthonic-shipmaster.png` | Myrto the Shipmaster |
| `chthonic-singer.png` | The Argolid Singer |
| `chthonic-neighbor.png` | The Agora Neighbor |
| `chthonic-attendant.png` | The Delphic Attendant |
| `chthonic-ferryman.png` | The Lower Ferryman |
| `chthonic-helen.png` | Helen |
| `chthonic-menelaus.png` | Menelaus |
| `chthonic-electra.png` | Electra |
| `chthonic-orestes.png` | Orestes |

Fifteen character identities serve the pack's twenty-one resident
embodiments. The two Helen accounts share Helen's portrait and Menelaus's
portrait; the three Atreid accounts share Electra's portrait and Orestes's
portrait. Each history variant shares art only with its own character
identity. The five connective residents each have a distinct portrait.

## Retained SVG illustrations

The original twenty-one SVGs remain in the directory: five settings, seven
legacy figures, and nine object illustrations. The authored character and
item data use PNG artwork. Seven opening settings use painted WebP backdrops.

The visual vocabulary uses terracotta, olive green, parchment, and dark blue,
with simplified architecture and profile figures informed by ancient painted
pottery. The SVG files are the editable sources; they have no external fonts,
scripts, network references, or raster dependencies.

- Five reusable settings: harbor, courtyard, palace, grove, and sea.
- Seven transparent figures: Antigone, Ismene, Creon, guard, baker, elder,
  and guide. All figures face left before the scene's normal mirroring.
- Nine object illustrations: water jar, bread, funeral cloth, oil flask,
  shovel, decree, household token, provisions, and witness tablet.

Setting illustrations are reused across related locations. Distinct IDs,
names, profiles, custody, and choices remain separate in the authored pack
data.

## Greek item artwork — October 25, 2026

Nine transparent PNGs serve all thirteen Greek items: water jar, bread,
funeral cloth, oil flask, shovel, decree, household token, provisions and
witness tablet. The five witness accounts share the tablet design.

The built-in `image_gen` tool created each sprite using the shore's lamp
and cloth as style references. Each original 1254 × 1254 PNG keeps its
generated alpha channel. Prompts, source names, dimensions and SHA256
checksums are in [item-art-provenance.json](item-art-provenance.json).

## Opening scenery — October 25, 2026

The seven opening paintings and ship boarding card were regenerated with
the built-in `image_gen` tool on October 25, 2026. The supplied Git bundle
contained their references and checksums; its WebP files required recovery.
The user requested regeneration. The archive's review sheet supplied the
composition and style reference for each setting.

The original pond and the bundle's transparent ship layer remain the runtime
scene. The boarding portrait was generated from those two images and the
review sheet. It matches the ship, mirror and nighttime setting.

The eight generated outputs are stored as WebP at quality 94. Full prompts
are in [scenery-prompts.json](scenery-prompts.json). Source names, generation
IDs, dimensions, current checksums and the archive's prior records are in
[scenery-provenance.json](scenery-provenance.json).

## Aboard the ship — October 26, 2026

The built-in `image_gen` tool created `ship-deck.webp` for the ship's aboard
location. The painting shows an open wooden deck, a square sail, quiet water,
and lantern light. The existing ship card and harbor painting guided its style.

The 1672 × 941 output was encoded as WebP at quality 94. The full prompt is in
[scenery-prompts.json](scenery-prompts.json). The source name, generation ID,
dimensions and checksums are in [scenery-provenance.json](scenery-provenance.json).

## Harbor berth variants — October 26, 2026

The built-in `image_gen` tool created two matching views at the user's request.
`harbor-open-berth.webp` shows the open water beside a broad stone quay.
`harbor-ship-at-berth.webp` adds the merchant ship at that same berth.
The game selects the ship view from the saved transport dock.

Both approved 1672 × 941 PNG designs were encoded as WebP at quality 94.
Their full prompts and checksums are in `scenery-prompts.json` and
`scenery-provenance.json`. The original harbor remains available at its
published URL.

## Thebes night scenery — October 27, 2026

The built-in `image_gen` tool made eight night paintings from the current
Theban paintings. They cover the seven Theban places and the harbor's ship view.
The ship is part of the complete harbor painting. The open berth was made from
that night painting so the town and moon keep their places when the ship moves.
The final images use WebP at quality 94. Prompts, source names, generation names,
sizes, and SHA-256 checksums are in `night-scenery-provenance.json`.

## Harbor stops and Theban Harbor Road

The built-in image generation tool made eight new paintings on 2026-10-28.
Athens Harbor and Piraeus Quays have matching open-berth and docked-ship views
for night, plus open-berth day views. Their existing day ship paintings remain
the docked views. The Theban Harbor Road has its own day and night paintings,
with the harbor at the left end and Thebes at the right end. Full prompts,
reference files, generation names, sizes and hashes are recorded in
`harbor-road-night-provenance.json`. The WebP stage files and card images are
saved beside the game’s other art.

## Attica and the ship by night — October 29, 2026

The built-in `image_gen` tool made six night paintings from the current game
art: the Athenian Agora, Colonus Grove, the Eleusinian Sanctuary, Marathon Altar,
the Attic roads and the Greek ship's deck. The eight Attic roads share one
painting. These images complete night coverage for the 27 released Greek places.

Each edit preserves its source's full 1672 × 941 canvas, camera and main
landmarks. Cool moonlight and light from existing lamps keep the foregrounds
readable. The ship's twilight view gains a separate deep-night counterpart.
The game still supplies regional rain, cloud and mist.

The generated PNGs were encoded as WebP at quality 94 without resizing or
cropping. Full prompts, the source commit, reference and generated PNG hashes,
output names, dimensions and WebP hashes are recorded in
`attica-night-provenance.json`. The image builder supplies the smaller card
versions. The saved world clock selects the paintings for scenes and road
approach cards.

## Trojan Shores and Greek Inventory — October 30, 2026

The built-in `image_gen` tool made twelve scene paintings and sixteen item
sprites for this pack. Aulis Anchorage, the Trojan Walls, the Trojan Night
Camp, the Lemnian Cave, the Thracian Shore and the Homecoming Beach each have
a day painting and a matching night view. Their open foregrounds leave room
for the game's character layers.

The sixteen inventory paintings distinguish four witness tablets, the return
list, the mothers' petition, the refuge tablet, Teucer's plea, three cloth
objects, the funeral urn, the grove cup, the quay basket, honey and grave
tools. The selected return list includes an image-generation edit that removes
goods and tally pictograms while preserving its blank reply margin.

Each scene is a 1672 × 941 opaque lossless WebP. Its decoded pixels match the
selected generated PNG without cropping or resizing. The WebP retains those
pixels without a duplicate scenery PNG in the repository. Each item is an
unchanged 1254 × 1254 RGBA PNG with its generated transparency.

[trojan-shores-art-provenance.json](trojan-shores-art-provenance.json) records
source names and hashes, runtime hashes, dimensions, alpha checks and the
retained prompts. Exact prompts survived for 23 assets. Five night prompts
were lost with the earlier workspace; their entries explicitly mark that gap
and provide separately labeled descriptive briefs. The Thracian Shore and
Homecoming Beach night records also lack their original tool generation IDs;
their retained source filenames and hashes identify the selected paintings.
