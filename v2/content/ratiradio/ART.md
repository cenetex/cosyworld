# Night Shift at RATiRadio media

Production sources for the approved station worldpack. This branch owns artwork
and the supplied song derivative. Its audio source, stream alias and media
hashes are registered here. Runtime gates, avatar behavior, music cues,
artwork registration and image variants belong to the integration PR.

## Source references

- Approved concept sheet: `exec-6e28c67f-94aa-40a1-bedd-f4f67d659ae9.png`,
  SHA-256 `dfdfee9597920b116de9ee1fe066472e628540e72f2d7e5de53fb5a758a68f5a`.
- Owner's Glass storyboard: page 10 provides human RATi's face; page 30 shows
  living Raven. RATi's green eye is viewer-left; blue eye is viewer-right.
  The PDF SHA-256 is
  `988a8f0de7dfebb00ee9ba0a72a1b41030f79fcf8c52e94562fbdd8679d45621`.
- Full generation specifications: [art-prompts.json](art-prompts.json).
  Artwork uses the built-in image-generation tool. Final production files
  live under `v2/card-game/assets/ratiradio/`.

## Audio provenance

Title: **Night Shift on RatiRadio (Lo-Fi Mix) (Remastered)**.
Artist attribution: **ratimics**.
Owner supplied the master in chat on 2026-11-08.

| Property | Supplied master | Browser derivative |
| --- | --- | --- |
| Filename | `Night Shift on RatiRadio (Lo-Fi Mix) (Remastered).m4a` | `assets/music/night-shift-on-ratiradio-remastered.mp3` |
| Codec | Opus in M4A, stereo, 48 kHz | MP3, stereo, 48 kHz, 160 kb/s |
| Duration reported by container | 359.560 s | 359.616 s, including MP3 frame padding |
| Bytes | 6,044,346 | 7,193,045 |
| SHA-256 | `7f7088d78ff10be5c9cecaefdd1b5e781ea83755160ce5161c5bf2994ae2624e` | `a0ef7697ffc2eedc50a04c35ddd52ed700b567015d3a2feaae03ce01ac2af3d9` |

The supplied metadata identifies Suno generation
`2c3c0edd-a45c-450f-9e67-bf6aa9ddbf18`, created `2026-11-08T01:35:02Z`.
The derivative encodes audio stream 0 with FFmpeg/libmp3lame at 160 kb/s.
It preserves the full source timing and gain; it adds no trim, fade or
normalization. The M4A subtitle stream and repeated lyrics metadata are omitted.
Title, artist and source generation ID remain in ID3 metadata.
Both files decode to 17,259,528 stereo sample frames at 48 kHz. The slight
container-duration difference is encoding padding; the decoded lengths match.

```sh
ffmpeg -i 'Night Shift on RatiRadio (Lo-Fi Mix) (Remastered).m4a' \
  -map 0:a:0 -vn -sn -dn -map_metadata -1 \
  -c:a libmp3lame -b:a 160k -id3v2_version 3 \
  -metadata 'title=Night Shift on RatiRadio (Lo-Fi Mix) (Remastered)' \
  -metadata 'artist=ratimics' \
  -metadata 'comment=Owner-supplied Suno remaster; created=2026-11-08T01:35:02Z; id=2c3c0edd-a45c-450f-9e67-bf6aa9ddbf18' \
  v2/card-game/assets/music/night-shift-on-ratiradio-remastered.mp3
```

## Production artwork

All paths below are relative to `v2/card-game/assets/ratiradio/`.

| File | Dimensions | Bytes | Treatment |
| --- | --- | ---: | --- |
| `staff-kitchen.webp` | 1672 × 941 | 271,146 | Opaque room |
| `dispatch-window.webp` | 1672 × 941 | 266,350 | Opaque room |
| `listening-room.webp` | 1672 × 941 | 296,122 | Opaque room |
| `broadcast-booth.webp` | 1672 × 941 | 296,342 | Opaque room |
| `rati.webp` | 1024 × 1536 | 133,896 | Transparent human avatar |
| `raven.webp` | 1153 × 1364 | 210,416 | Transparent living raven |
| `station-key.webp` | 512 × 512 | 53,568 | Transparent item |
| `red-beanie.webp` | 512 × 512 | 65,954 | Transparent item |
| `thermos.webp` | 512 × 512 | 43,078 | Transparent item |
| `raven-figurine.webp` | 512 × 512 | 43,974 | Transparent item |
| `glass.webp` | 512 × 512 | 49,020 | Transparent item |
| `request-slip.webp` | 512 × 512 | 55,702 | Transparent item |

The Listening Room is RATi's home. Its worn armchair, radio, shaded lamp and
booth door remain legible. Every room has a clear lower-left foreground for
the player. None contains a baked-in actor or movable quest object. The human
avatar has tousled brown hair, an off-white shirt and the specified eye colors.
Living Raven has articulated feet and layered feathers; the separate ceramic
Figurine has a glazed surface and integrated base.

The four room PNGs were generated at the final 1672 × 941 size. They were
encoded without resizing or cropping, at WebP quality 86 or 88, effort 6.
Both portraits retain their original dimensions. The six item illustrations
were mechanically extracted from one generated 1536 × 1024 atlas into
512 × 512 cards. Glass and Request Slip use slightly shifted crop rectangles
to preserve the paper edge without contaminating the adjacent glass card.
No object was redrawn, recolored, reconstructed or manually matted.

[art-provenance.json](art-provenance.json) records every source generation ID,
source hash, output hash, crop rectangle and encode setting. Transparent
outputs use alpha quality 100. Every output alpha value matches its generated
source or atlas crop exactly.

## Validation

- Inspected all generated originals, then a contact sheet of encoded rooms.
- Reviewed all eight transparent outputs against a neutral solid background:
  complete silhouettes, separated objects, correct eye colors, no visible halo.
- Verified four rooms are opaque, exactly 1672 × 941, below 300,000 bytes.
- Compared generated and encoded alpha channels pixel by pixel: identical.
- Checked all six crop boundaries: no subject pixels at the boundary;
  only imperceptible generated alpha-1 noise reaches an edge.
- Probed both audio files with FFprobe; decoded both fully with FFmpeg;
  sample counts match. Artist, title and source ID metadata are present.
- `git diff --check`, `npm run check:version` and `npm run check:ui` pass.
- `node v2/scripts/build-card-music.mjs --check` records all 31 MP3s.
  The new stream skips 245 ID3 bytes; its original source remains unchanged.
- Focused `test/card-music-streams.test.mjs`: all 20 tests pass in 680 ms.

The audio source, stream map and matching public media hashes are included.
The integration owner registers the artwork and builds its image variants.
Game-stage framing and playback behavior are integration checks; this asset
change does not claim those checks.
