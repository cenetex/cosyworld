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
