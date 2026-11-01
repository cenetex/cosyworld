# Strike, Hit and Guard for the remaining cast

This delivery completes the set of 150 source paintings for 56 avatar IDs in
the current card-game roster. It recovers the last 56 paintings after the 94
integrated in PR #1701. Those IDs use 50 distinct canonical identities; six
Greek account aliases share the artwork of the person they already depict.

[Browse the complete reference-and-pose gallery](cast-gallery.md).

| Cast                             | Canonical identities | Avatar IDs | Pose sources |
| -------------------------------- | -------------------: | ---------: | -----------: |
| Greek drama                      |                   27 |         33 |           81 |
| Hoppy Cat                        |                   16 |         16 |           48 |
| The Swede                        |                    1 |          1 |            3 |
| RATi, Skull, Whiskerwind and Oak |                    4 |          4 |           12 |
| Badger                           |                    1 |          1 |            3 |
| BoardyAI                         |                    1 |          1 |            3 |
| **Total**                        |               **50** |     **56** |      **150** |

The original 54 pose sources for the eight humans, Pip and Keeper are unchanged.
Together, the two deliveries cover the current 66 avatar IDs. Existing rules
still determine who may enter a standoff.

This integration recovers the completed local checkpoint `982fd533` that followed
the 94 paintings published in PR #1701. All 150 source files and their original
generated PNGs match the recorded hashes and alpha channels. The separate Arc
Epic and Hoppy Mythic forms keep their existing portraits and combat selection.

## Source art and references

Strike uses the existing `-attack.webp` suffix. Every identity has a separate
`-attack.webp`, `-hit.webp` and `-guard.webp` source in this folder.

- The 49 portrait families supply 147 transparent 1024 × 1536 WebPs.
- Oak supplies three opaque 1672 × 941 edits of its existing place painting.
- Every source is at most 300,000 bytes and retains the complete silhouette or
  scene canvas.
- The official image builder supplies 512-pixel card previews and phone stages
  no larger than 960 pixels on their longer side.

Each edit uses the existing character or place as its identity reference. It
preserves age, anatomy, clothing, attached accessories, palette and painted
style. Held props are removed for the combat poses; worn identity details such
as Teucer's quiver, RATi's scarf and Glim's mechanical equipment remain.

[The roster](cast-roster.json) records exact reference paths, actor aliases and
native directions. [Prompts and revision history](cast-art-prompts.json) and
[provenance and encoding evidence](cast-provenance.json) record canonical
reference commits and SHA256 hashes, generated PNG IDs and hashes, final WebP
hashes, dimensions, alpha checks, silhouette bounds and visual reviews.

Source encoding preserves every generated alpha value and output dimension.
It does not crop, retouch or resize the source paintings. Generated near-opaque
alpha and faint edge residues are retained and measured. The per-file reviews
also record small pose variations, including Hoppy Cat's satchel changing
screen side in Guard.

## Selection and playback

The shared `cast-combat-art.mjs` adapter maps each actor to its canonical pose
family. The combat selector uses only a registered stage image. Shared Greek accounts therefore use the same
three files. The original human plain/scarf selection is preserved.

The new portrait families have 45 native left directions and four native right
directions. Front-facing neutral portraits keep their existing metadata; their
combat poses turn toward the opponent. Pose images use the established wide
phone framing. After playback, the renderer restores the exact original
source, flip, framing and pose, including state portraits such as the sleeping
Badger or listening Swede.

Keeper's existing right-facing neutral remains the fallback for that direction,
so its clock is never mirrored. Unregistered art keeps the original portrait;
beat playback also retains the original when preload fails or exceeds 1500 ms.
Standing Guard uses the existing direct image assignment, so it does not gain
that preload recovery path in this change.

Oak remains a backdrop, excluded from the portrait selector. Its branch sweep,
recoil and protective arch are registered artwork for a future backdrop
presentation. Oak's authored `standoffs: false` means no current legal combat
event can select these scenes. This delivery does not add combat permission or
new state rules for Oak or any other resident.

## Validation

The source audit covers roster completeness, original-source preservation,
exact output hashes, generated alpha and file limits. Unit tests cover every
current avatar in all three poses and both directions, public image
registration, Greek aliases, neutral portraits, missing-art fallback and the
existing Hoppy and Arc rarity forms.

The combat browser smoke retains the Pip journey and also exercises Antigone
at desktop and phone sizes, including reduced motion, defeat, arrival and
portrait restoration. The gallery links every source and card-size preview.

Commands and observed final results are recorded in the pull request.
