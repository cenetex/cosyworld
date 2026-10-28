# House of Blood scene art

Eight native PNG paintings cover three places in both light settings and both
Tauris berth states. Every file keeps the complete original generated pixels.
The built-in image generation tool made each painting. Full prompts, references,
source/output hashes, cast references and review hashes are in `scene-provenance.json`.

| Place | Day | Night |
| --- | --- | --- |
| `greek-ares-hill` | `ares-hill-scene.png` | `ares-hill-scene-night.png` |
| `greek-argos-refuge` | `argos-refuge-scene.png` | `argos-refuge-scene-night.png` |
| `greek-tauris-shore`, open berth | `tauris-shore-scene.png` | `tauris-shore-scene-night.png` |
| `greek-tauris-shore`, shared ship at berth | `tauris-shore-ship-at-berth.png` | `tauris-shore-ship-at-berth-night.png` |

All eight paintings are native 1536 by 1024 opaque PNGs. Each saved file matches
its generated source byte for byte. Day/night pairs share their camera and
landmarks. The Tauris pairs share the same temple steps, landing and inlet.
The occupied pair carries the same shared Greek ship with its wooden hull,
red stripe, eye-painted curved prow, mast and furled sail.

## Review

Four browser sheets use the actual source cast: Athena and the Furies after
their agreed court journey; Hermione and the Phrygian Servant at the refuge;
and Thoas at the shore. Both light settings are shown at desktop and in
390 by 580 phone views. Open and occupied Tauris each have their own sheet.
A fifth sheet shows all eight native paintings together. Clear cast/object
foregrounds and central shore water support the phone crop.

## Chapter integration

This draft targets `codex/greek-house-of-blood`. Bind `nightBackdrops` for
all three places and `dockedNightBackdrops` for occupied Tauris. Choose the
occupied background from the saved `greek-ship` dock through crossing
`scenery.backdrop`. Keep the local Tauris to Taurian Shore walk. Book III ship
source owns the landing and draft Piraeus-edge replacement.

Use the location words “on Ares Hill”, “at the Argive Refuge” and “on the
Taurian Shore”. Chapter integration owns optimized variants, public assets,
shared rules, actual scene selection and the full release checks.
