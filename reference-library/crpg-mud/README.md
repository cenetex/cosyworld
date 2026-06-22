# CRPG and MUD Reference Library

Local research library of open-source or source-available CRPG/RPG engine and MUD/MU server codebases.

Latest pull: 80 shallow clones, split across 35 CRPG/RPG references and 45 MUD/MU references.

## Layout

- `catalog.tsv` is the working manifest of researched projects.
- `SOURCES.md` records the main research seed sources.
- `LESSONS_FOR_COSYWORLD.md` distills architecture and product lessons for CosyWorld.
- `repositories/crpg/` contains shallow local clones of CRPG, RPG engine, and open RPG game projects.
- `repositories/mud/` contains shallow local clones of MUD, MU*, MOO, MUSH, and text-world server projects.
- `clone-results.tsv` records what cloned successfully during the latest pull.

## Notes

- Repositories are cloned for reference only; check each upstream license before reusing code, content, or assets.
- Several classic MUD families, especially Diku/Circle/ROM/SMAUG descendants, are source-available but may have non-commercial or attribution restrictions.
- Large historical game-engine projects may require original proprietary game data to run; their code is still useful for architecture, data formats, tooling, and system design.
- The repository clones are intentionally ignored by Git so they can stay as a local reference library without bloating this project history.
