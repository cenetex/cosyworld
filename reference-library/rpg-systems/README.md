# RPG System Reference Library

This folder is a local research shelf for turning CosyWorld into a fuller RPG.
The downloaded upstream sources live under `sources/` and `raw/`; those folders
are intentionally gitignored because they are large and externally licensed.

## Downloaded Sources

| System | Local path | License signal | Useful design notes |
| --- | --- | --- | --- |
| Fate SRD | `sources/fate-srd-content` at `93ed848` | CC-BY 3.0 / OGL options in upstream README | Aspects, compels, stress, consequence-driven scene play. |
| Blades in the Dark SRD | `sources/blades-in-the-dark-srd-content` at `f141ed2` | CC-BY 3.0 in upstream README | Position/effect, clocks, resistance, faction pressure. |
| Dungeon World Markdown | `sources/dungeon-world-markdown` at `3d7118e` | CC-BY 3.0 in upstream LICENSE | GM moves, fronts, play-to-find-out, player-facing moves. |
| Cairn | `sources/cairn` at `154fa1b` | CC-BY-SA 4.0 in upstream README | Inventory pressure, saves, scars, rules-light exploration. |
| 5e CC SRD 5.1 | `sources/cc-srd-5e` at `c05c043` | CC-BY 4.0 in upstream README | Familiar d20 stats, monsters, spells, conditions, equipment. |
| 5e CC SRD 5.2.1 selected data | `raw/srd-5.2.1-cosyworld.json` | CC-BY 4.0 in the official document | The fifteen conditions and three reference-only monster seeds used by the versioned CosyWorld adapter. |
| Ars Magica open license | `sources/ars-magica-open-license` at `af370b5` | CC-BY-SA 4.0 in upstream LICENSE | Deep magic systems, covenants, long-term troupe campaign play. |
| Awesome Tabletop RPGs | `sources/awesome-tabletop-rpgs` at `90b9eef` | Curated list; verify each linked project | Discovery index for additional open systems. |
| 24XX SRD | `raw/24xx-srd.md` | CC-BY 4.0 in document text | Fast risk rolls, compact jobs, gear breakage, rules gaps by design. |
| Charge SRD | `raw/charge-srd.md` | CC-BY 4.0 in document text, also credits Blades | Generic FitD-adjacent action system and creator-facing SRD structure. |
| Breathless SRD | `raw/breathless-srd.md` | CC-BY 4.0 in document text | Step-down resource dice, tension through exhaustion, compact sessions. |

## Licensing Notes

- Prefer CC-BY sources for mechanics wording we may adapt directly.
- Treat CC-BY-SA sources as reference-first unless we are ready for share-alike
  obligations in derived text.
- Treat mixed indexes as discovery aids, not as permission by themselves.
- Keep attribution text with any design notes copied into CosyWorld.

## Refresh Commands

```sh
git -C reference-library/rpg-systems/sources/fate-srd-content pull --ff-only
git -C reference-library/rpg-systems/sources/blades-in-the-dark-srd-content pull --ff-only
git -C reference-library/rpg-systems/sources/dungeon-world-markdown pull --ff-only
git -C reference-library/rpg-systems/sources/cairn pull --ff-only
git -C reference-library/rpg-systems/sources/cc-srd-5e pull --ff-only
git -C reference-library/rpg-systems/sources/ars-magica-open-license pull --ff-only
git -C reference-library/rpg-systems/sources/awesome-tabletop-rpgs pull --ff-only
curl -fsSL https://raw.githubusercontent.com/fariapp/fari-community/main/public/catalog/creators/jason-tocci/24xx/index.md -o reference-library/rpg-systems/raw/24xx-srd.md
curl -fsSL https://raw.githubusercontent.com/fariapp/fari-community/main/public/catalog/creators/fari-rpgs/charge-srd/index.md -o reference-library/rpg-systems/raw/charge-srd.md
curl -fsSL https://raw.githubusercontent.com/fariapp/fari-community/main/public/catalog/creators/fari-rpgs/breathless/index.md -o reference-library/rpg-systems/raw/breathless-srd.md
```
