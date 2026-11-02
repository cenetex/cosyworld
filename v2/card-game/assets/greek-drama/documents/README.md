# Greek document items

Five distinct document illustrations address the document-art portion of
[issue #1851](https://github.com/cenetex/cosyworld/issues/1851) and its
[material and seal brief](https://github.com/cenetex/cosyworld/issues/1851#issuecomment-6564242922).

| Card ID | Runtime art path | Material and silhouette |
| --- | --- | --- |
| `greek-guard-tablet` | `assets/greek-drama/guard-tablet.webp` | Narrow dark wax board in worn walnut, with a bound bronze stylus |
| `greek-burial-account` | `assets/greek-drama/burial-account.webp` | Loose pale papyrus folio, partly unrolled, with a plain linen tie |
| `greek-pyre-account` | `assets/greek-drama/pyre-account.webp` | Squat ash-grey and terracotta clay record, scorched at the rim, with linen binding |
| `greek-marathon-record` | `assets/greek-drama/marathon-record.webp` | Broad open wax diptych, red-ochre faces, pale olive-wood frames and cord hinges |
| `greek-creon-writ` | `assets/greek-drama/creon-writ.webp` | Closed cream papyrus roll, wine-red cords and a large plain bronze seal |

The items share the existing Greek art's warm upper-left amber light, cool
self-shadow, worn materials and painterly texture. Their blank surfaces contain
no writing, pseudoletters, glyphs or emblems. Full object silhouettes and alpha
gaps support both inventory cards and floor props. Material, colour and shape
distinguish the records at small display sizes.

## Records and encoding

[art-prompts.json](art-prompts.json) preserves all five final prompts and
generation IDs, plus the four initial generations used for layout corrections.
Repository references are pinned to commit
`6fa9600a88a68c21d03c883f2eb991edb3500fa3` and identified by SHA-256.
Generated reference images are identified by generation ID and PNG hash.

[provenance.json](provenance.json) records original PNG hashes and sizes, final
WebP measurements, encoding settings and official card/phone derivatives.
Each source WebP retains the complete 1254 × 1254 generated canvas and is below
300,000 bytes. Encoding uses quality 88 and preserves alpha byte for byte,
including any near-transparent generator residue. There is no source resizing,
cropping, compositing or alpha thresholding.

## Integration

The five art fields are authored in
`v2/content/greek-drama/card-world.json` and carried into the runtime catalogs by
the official compilers. The flat `assets/greek-drama/<name>.webp` namespace
matches the pack schema; this directory holds documentation and metadata.

The existing card IDs, item text, placement, appearance conditions and programs
remain unchanged. This artwork update does not change the pack revision or
rules engine. The official image builder produces card and phone variants from
the source WebPs; the public registry and media manifest include the runtime
files.
