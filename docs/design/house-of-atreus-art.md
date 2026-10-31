# House of Atreus: matched scene paintings

**Status:** Proposed production brief; no new images have been generated.

This bounded art pack supports [the small-world proposal, #1622](https://github.com/cenetex/cosyworld/issues/1622)
and [its landed design](small-worlds-alternates-specials.md).
Deliver four distinct places with one day painting and one matching night painting each.
Gameplay, route and release decisions belong to that broader design.

## Verified starting point

Checked against `main` at `17dc3cde`. The [Greek catalogue](../../v2/content/greek-drama/card-world.json)
authors these four places, but none appears in its current `release.places` list.
Their art is preparation for a future chapter; these are not gaps in the released scenery.

| Place                                     | Current backdrop                                                     | Distinctive scene to paint                                                           |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `greek-argos-palace` — Argive Palace      | [palace.svg](../../v2/card-game/assets/greek-drama/palace.svg)       | Bronze doors and a royal forecourt; household wax tablets with no readable writing.  |
| `greek-argos-tomb` — Agamemnon's Tomb     | [grove.svg](../../v2/card-game/assets/greek-drama/grove.svg)         | A stone mound beside the palace road, with offerings at its foot.                    |
| `greek-mycenae-palace` — Mycenaean Palace | [palace.svg](../../v2/card-game/assets/greek-drama/palace.svg)       | An elevated palace above a worn approach; a clearly different silhouette from Argos. |
| `greek-argive-farm` — Argive Farmhouse    | [courtyard.svg](../../v2/card-game/assets/greek-drama/courtyard.svg) | A modest house beyond cultivated fields, with a spare seat for a guest.              |

## Eight deliverables

Proposed destination: `v2/card-game/assets/greek-drama/`.
Each image receives a matching prompt file and a generation receipt identifying its references.

| Scene            | Day master                       | Night edit                         |
| ---------------- | -------------------------------- | ---------------------------------- |
| Argive Palace    | `atreus-argos-palace-day.webp`   | `atreus-argos-palace-night.webp`   |
| Agamemnon's Tomb | `atreus-agamemnon-tomb-day.webp` | `atreus-agamemnon-tomb-night.webp` |
| Mycenaean Palace | `atreus-mycenae-palace-day.webp` | `atreus-mycenae-palace-night.webp` |
| Argive Farmhouse | `atreus-argive-farm-day.webp`    | `atreus-argive-farm-night.webp`    |

## Visual references and composition

Use the existing [palace day painting](../../v2/card-game/assets/greek-drama/palace-day.webp),
[burial ground at dusk](../../v2/card-game/assets/greek-drama/burial-ground-dusk.webp),
and [Argive shore sanctuary](../../v2/card-game/assets/greek-drama/suppliants-argive-shore-day.webp)
as references for the mounted Greek world's materials, lighting and painted detail.
Cream stone, red ochre, bronze, olive and cypress give the set a shared visual language.

- Supply **1672 × 941** landscape images, matching the existing Greek scenery.
- Keep every scene character-free and text-free, with an empty foreground for character cutouts.
- Give each place a recognisable landmark and separate foreground, middle distance and background.
- Use the catalogue's ordinary objects and architecture; leave movable quest items to the game.
- Distinguish the two palaces by approach, massing and doorway, not merely by colour.

## Day/night consistency

Select each day master before deriving its night version through an identity-preserving edit.
Lock the camera, crop, perspective, architecture, paths, trees, fixed objects and foreground space.
Change illumination and sky only; night uses moonlight and any fixed lights present in the day master.
Keep entrances, steps and character placement areas readable without making night look like daylight.

## Review acceptance

- Compare each pair by alternating images: no landmark, doorway or horizon should jump.
- Check all four silhouettes at card size; each location must remain recognisable.
- Inspect at stage size for malformed stonework, repeated details, stray people and accidental lettering.
- Check night legibility and a clear foreground against the existing Greek character cutouts.
- Retain source masters, exact prompts, reference paths/hashes and receipts with the reviewed outputs.
- Review this as one eight-painting set before a later integration decision.
