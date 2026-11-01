# Combat pose art

Full-body transparent portraits for attack and hit reactions. The original painted character identities and wardrobes are preserved. Each source is 1024 × 1536 WebP, at most 300,000 bytes, with the generated PNG's alpha preserved exactly.

These files are published for subsequent client-side combat integration. Current combat presentation still animates the neutral portraits. No rules or save changes are included. Empty hands keep carried items separate. Pip uses the existing character ID `moth`.

| File | Character | Pose | Wardrobe | Native facing | Bytes |
| --- | --- | --- | --- | --- | ---: |
| [ada-attack.webp](ada-attack.webp) | Ada | attack | plain | right | 292,386 |
| [ada-hit.webp](ada-hit.webp) | Ada | hit | plain | right | 296,898 |
| [ada-scarf-attack.webp](ada-scarf-attack.webp) | Ada | attack | scarf | right | 296,994 |
| [ada-scarf-hit.webp](ada-scarf-hit.webp) | Ada | hit | scarf | right | 289,416 |
| [ash-attack.webp](ash-attack.webp) | Ash | attack | plain | right | 294,066 |
| [ash-hit.webp](ash-hit.webp) | Ash | hit | plain | right | 297,670 |
| [ash-scarf-attack.webp](ash-scarf-attack.webp) | Ash | attack | scarf | right | 293,896 |
| [ash-scarf-hit.webp](ash-scarf-hit.webp) | Ash | hit | scarf | right | 296,804 |
| [keeper-attack.webp](keeper-attack.webp) | Keeper | attack | plain | left | 200,944 |
| [keeper-hit.webp](keeper-hit.webp) | Keeper | hit | plain | left | 212,138 |
| [mara-attack.webp](mara-attack.webp) | Mara | attack | plain | right | 295,164 |
| [mara-hit.webp](mara-hit.webp) | Mara | hit | plain | right | 295,990 |
| [mara-scarf-attack.webp](mara-scarf-attack.webp) | Mara | attack | scarf | right | 292,748 |
| [mara-scarf-hit.webp](mara-scarf-hit.webp) | Mara | hit | scarf | right | 286,718 |
| [moth-attack.webp](moth-attack.webp) | Pip | attack | plain | left | 298,146 |
| [moth-hit.webp](moth-hit.webp) | Pip | hit | plain | left | 291,018 |
| [nell-attack.webp](nell-attack.webp) | Nell | attack | plain | right | 298,542 |
| [nell-hit.webp](nell-hit.webp) | Nell | hit | plain | right | 298,386 |
| [nell-scarf-attack.webp](nell-scarf-attack.webp) | Nell | attack | scarf | right | 290,848 |
| [nell-scarf-hit.webp](nell-scarf-hit.webp) | Nell | hit | scarf | right | 292,660 |
| [orin-attack.webp](orin-attack.webp) | Orin | attack | plain | right | 271,696 |
| [orin-hit.webp](orin-hit.webp) | Orin | hit | plain | right | 278,576 |
| [orin-scarf-attack.webp](orin-scarf-attack.webp) | Orin | attack | scarf | right | 235,814 |
| [orin-scarf-hit.webp](orin-scarf-hit.webp) | Orin | hit | scarf | right | 255,658 |
| [rue-attack.webp](rue-attack.webp) | Rue | attack | plain | right | 225,710 |
| [rue-hit.webp](rue-hit.webp) | Rue | hit | plain | right | 210,380 |
| [rue-scarf-attack.webp](rue-scarf-attack.webp) | Rue | attack | scarf | right | 204,362 |
| [rue-scarf-hit.webp](rue-scarf-hit.webp) | Rue | hit | scarf | right | 215,180 |
| [tavi-attack.webp](tavi-attack.webp) | Tavi | attack | plain | right | 297,090 |
| [tavi-hit.webp](tavi-hit.webp) | Tavi | hit | plain | right | 292,832 |
| [tavi-scarf-attack.webp](tavi-scarf-attack.webp) | Tavi | attack | scarf | right | 276,268 |
| [tavi-scarf-hit.webp](tavi-scarf-hit.webp) | Tavi | hit | scarf | right | 282,228 |
| [vale-attack.webp](vale-attack.webp) | Vale | attack | plain | right | 196,360 |
| [vale-hit.webp](vale-hit.webp) | Vale | hit | plain | right | 220,730 |
| [vale-scarf-attack.webp](vale-scarf-attack.webp) | Vale | attack | scarf | right | 205,690 |
| [vale-scarf-hit.webp](vale-scarf-hit.webp) | Vale | hit | scarf | right | 205,180 |

`art-prompts.json` preserves each complete generation prompt and its pinned canonical portrait reference. `provenance.json` records generation identifiers, original PNG hashes, per-image WebP quality, output hashes, and exact alpha checks. The normal image builder supplies smaller card variants and records their hashes in `image-variants.json`.

## Player gallery

Scarf variants use their matching plain combat pose as the edit target and the canonical scarf portrait as the wardrobe reference. These are the 512-pixel card variants.

| Character | Attack | Hit | Scarf attack | Scarf hit |
| --- | --- | --- | --- | --- |
| Vale | <img src="../optimized/card/webp/combat/vale-attack.webp" width="140" alt="vale attack"> | <img src="../optimized/card/webp/combat/vale-hit.webp" width="140" alt="vale hit"> | <img src="../optimized/card/webp/combat/vale-scarf-attack.webp" width="140" alt="vale scarf-attack"> | <img src="../optimized/card/webp/combat/vale-scarf-hit.webp" width="140" alt="vale scarf-hit"> |
| Mara | <img src="../optimized/card/webp/combat/mara-attack.webp" width="140" alt="mara attack"> | <img src="../optimized/card/webp/combat/mara-hit.webp" width="140" alt="mara hit"> | <img src="../optimized/card/webp/combat/mara-scarf-attack.webp" width="140" alt="mara scarf-attack"> | <img src="../optimized/card/webp/combat/mara-scarf-hit.webp" width="140" alt="mara scarf-hit"> |
| Ash | <img src="../optimized/card/webp/combat/ash-attack.webp" width="140" alt="ash attack"> | <img src="../optimized/card/webp/combat/ash-hit.webp" width="140" alt="ash hit"> | <img src="../optimized/card/webp/combat/ash-scarf-attack.webp" width="140" alt="ash scarf-attack"> | <img src="../optimized/card/webp/combat/ash-scarf-hit.webp" width="140" alt="ash scarf-hit"> |
| Nell | <img src="../optimized/card/webp/combat/nell-attack.webp" width="140" alt="nell attack"> | <img src="../optimized/card/webp/combat/nell-hit.webp" width="140" alt="nell hit"> | <img src="../optimized/card/webp/combat/nell-scarf-attack.webp" width="140" alt="nell scarf-attack"> | <img src="../optimized/card/webp/combat/nell-scarf-hit.webp" width="140" alt="nell scarf-hit"> |
| Tavi | <img src="../optimized/card/webp/combat/tavi-attack.webp" width="140" alt="tavi attack"> | <img src="../optimized/card/webp/combat/tavi-hit.webp" width="140" alt="tavi hit"> | <img src="../optimized/card/webp/combat/tavi-scarf-attack.webp" width="140" alt="tavi scarf-attack"> | <img src="../optimized/card/webp/combat/tavi-scarf-hit.webp" width="140" alt="tavi scarf-hit"> |
| Rue | <img src="../optimized/card/webp/combat/rue-attack.webp" width="140" alt="rue attack"> | <img src="../optimized/card/webp/combat/rue-hit.webp" width="140" alt="rue hit"> | <img src="../optimized/card/webp/combat/rue-scarf-attack.webp" width="140" alt="rue scarf-attack"> | <img src="../optimized/card/webp/combat/rue-scarf-hit.webp" width="140" alt="rue scarf-hit"> |
| Orin | <img src="../optimized/card/webp/combat/orin-attack.webp" width="140" alt="orin attack"> | <img src="../optimized/card/webp/combat/orin-hit.webp" width="140" alt="orin hit"> | <img src="../optimized/card/webp/combat/orin-scarf-attack.webp" width="140" alt="orin scarf-attack"> | <img src="../optimized/card/webp/combat/orin-scarf-hit.webp" width="140" alt="orin scarf-hit"> |
| Ada | <img src="../optimized/card/webp/combat/ada-attack.webp" width="140" alt="ada attack"> | <img src="../optimized/card/webp/combat/ada-hit.webp" width="140" alt="ada hit"> | <img src="../optimized/card/webp/combat/ada-scarf-attack.webp" width="140" alt="ada scarf-attack"> | <img src="../optimized/card/webp/combat/ada-scarf-hit.webp" width="140" alt="ada scarf-hit"> |
