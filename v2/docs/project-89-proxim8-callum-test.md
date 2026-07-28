# Project 89 Proxim8 test 001: Callum Synclaire

Date: 2026-07-28

Status: identity and metadata fixture passes; the full-strength P89 plus
FLUX.2 result passes the initial two-stage visual gate and remains an
unpublished test derivative.

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

The P89 probes used Project 89 revision
`95f3d0eb7bdceb1262a2824c1a623e01b1902b71420013e6bc7b760e9f9255d6`,
the `P89` trigger, FLUX `dev`, 28 steps, guidance `3`, one WebP output, and
the safety checker. The final P89 base used full LoRA scale `1.0`. The
refinement used pinned FLUX.2 revision
`7bba46bdde863cfd7aaee87649a5aa49f39f368495dbea500998d1fcbb262050`.

| Probe                                                     |         Seed | Prediction                   | Result                                                                                   | Publication decision                                                   |
| --------------------------------------------------------- | -----------: | ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Text-only style probe                                     |  `143805103` | —                            | Replicate rejected every candidate as NSFW; no output.                                   | Safe failure; revise prompt vocabulary.                                |
| P89 scale `0.8`, strength `0.35`, requested `1:1`         |  `537747577` | —                            | Succeeded in 4.32 seconds; `1088x1088`; strong identity retention.                       | Hold: pseudo-text appeared on headphone display.                       |
| P89 scale `0.8`, strength `0.55`, requested `2:3`         | `1237450361` | —                            | Succeeded in 6.43 seconds; returned `1088x1088`; stronger restyle and more facial drift. | Hold: faint signature-like mark and aspect-ratio failure.              |
| P89 scale `1.0`, strength `0.45`, requested `1:1`         |  `728375885` | `ngaayc3v1drmw0cznb7twbp0ew` | `1088x1088`; strong P89 anime treatment with stable defining traits.                     | Hold base: false lettering on the left headphone.                      |
| FLUX.2 refinement, P89 base first and original NFT second |  `475257086` | `78m18zan45rp00cznb8byzya30` | `1088x1088`; removes false lettering and adds a washed graphite/watercolor finish.       | Pass initial gate: identity, crop, palette, and composition preserved. |

Source image SHA-256:
`75bd3b0a2b8c0defdcba30c6e754213eb5670bbfd9c27f855101faed4823f730`.

Strength `0.35` output SHA-256:
`7df2d79941684fb4e668570ae46ad36330c0e4982bf0bc900e86447a41e51426`.

Strength `0.55` output SHA-256:
`0e65a1c0b315b65e3a92f7bf8587c9419b72b68cdc1a0321f1b9040ab35fd548`.

Full-strength P89 base SHA-256:
`5a885830f3f255e64e5a229e0176fc712268c1781806da4ea7858c42ed569236`.

FLUX.2 refinement SHA-256:
`ebf4787ebdc48b57f548c19fcdd951542239dd71ba231863746899a5f966f1f7`.

The source is a square `1080x1080` JPEG. Both image-to-image outputs were
square `1088x1088`, and the full-strength base and refinement remained square.
The current Project 89 endpoint should therefore produce square identity
masters. FLUX.2 may compose a visual card around that master, while readable
card type and rules remain deterministic code-native overlays.

This live test does not authorize generation on wallet connection. The
original NFT remains the free default. A currently verified holder must fund
an Orb-priced redraw before the two-stage job is queued; safe retries of that
same funded job do not debit again.

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
