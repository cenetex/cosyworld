# Project 89 Proxim8 test 001: Callum Synclaire

Date: 2026-07-28

Status: identity and metadata fixture passes; generated candidates remain
unapproved test derivatives.

## Subject

| Field                       | Observed value                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Network                     | `solana/mainnet-beta`                                                                                           |
| Core collection             | `5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf`                                                                  |
| Collection name             | `PROXIM8`                                                                                                       |
| Collection update authority | `8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd`                                                                  |
| Core asset                  | `Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo`                                                                  |
| Current on-chain owner      | `DcXxMstZHwnEMjLTF1Aa2kHB95NBif77nPUEZqD4ZTue`                                                                  |
| Asset name                  | `Callum Synclaire`                                                                                              |
| Metadata token id           | `3759`                                                                                                          |
| Durable identity key        | `solana/mainnet-beta/5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf/Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo` |

The asset account is owned by the MPL Core program. Its update-authority
variant is `Collection`, and its address equals the expected collection. The
collection URL in the original Orb link is therefore an authority/history
reference; the individual actor identity must use the `Bcw...` Core asset
address.

## Normalized profile

| Field             | Result              |
| ----------------- | ------------------- |
| Callsign          | Callum Synclaire    |
| Coordinator       | Iris                |
| Background        | Neon Protocol       |
| Bottom            | Flare Cut           |
| Eye               | Ember               |
| Hair              | Hair 2              |
| Headwear          | Halo                |
| Skin              | Blush Circuit       |
| Top               | Spike Weave         |
| Suggested role    | Signal Weaver       |
| Suggested drive   | Connect             |
| Starting location | Threshold Interface |

The role and drive are versioned suggestions, not mechanical authority. The
NFT's rarity, prose, and visual traits do not change the balanced Proxim8
attribute budget. The long personality attribute is sanitized and retained
only as an untrusted voice seed.

## Media probes

All probes used Project 89 revision
`95f3d0eb7bdceb1262a2824c1a623e01b1902b71420013e6bc7b760e9f9255d6`,
the `P89` trigger, FLUX `dev`, LoRA scale `0.8`, 28 steps, guidance `3`, one
WebP output, and the safety checker.

| Probe                                          |         Seed | Result                                                                                   | Publication decision                                      |
| ---------------------------------------------- | -----------: | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Text-only style probe                          |  `143805103` | Replicate rejected every candidate as NSFW; no output.                                   | Safe failure; revise prompt vocabulary.                   |
| Source image, strength `0.35`, requested `1:1` |  `537747577` | Succeeded in 4.32 seconds; `1088x1088`; strong identity retention.                       | Hold: pseudo-text appeared on headphone display.          |
| Source image, strength `0.55`, requested `2:3` | `1237450361` | Succeeded in 6.43 seconds; returned `1088x1088`; stronger restyle and more facial drift. | Hold: faint signature-like mark and aspect-ratio failure. |

Source image SHA-256:
`75bd3b0a2b8c0defdcba30c6e754213eb5670bbfd9c27f855101faed4823f730`.

Strength `0.35` output SHA-256:
`7df2d79941684fb4e668570ae46ad36330c0e4982bf0bc900e86447a41e51426`.

Strength `0.55` output SHA-256:
`0e65a1c0b315b65e3a92f7bf8587c9419b72b68cdc1a0321f1b9040ab35fd548`.

The source is a square `1080x1080` JPEG. Both image-to-image outputs were
square `1088x1088`, so the current Project 89 endpoint should produce square
identity masters. A tall card should be assembled deterministically around
that master rather than assuming `aspect_ratio: 2:3` will outpaint a square
input.

## Reproducible checks

Run the frozen parser tests:

```sh
node --test v2/scripts/inspect-project89-proxim8.test.mjs
```

Inspect this live asset:

```sh
node v2/scripts/inspect-project89-proxim8.mjs \
  --collection 5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf \
  --asset Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo
```

The live inspector performs read-only RPC and metadata requests. Ownership must
still be rechecked from a signed wallet session before CosyWorld grants an
anchor or holder directive.
