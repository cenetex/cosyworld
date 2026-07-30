# The CosyWorld Referee's Guide

This directory contains the publication source for CosyWorld's dungeon
master's guide. The book is written for referees and world designers. It
separates live rules, accepted target rules, playtest rules, and general
referee advice so it never presents backlog work as shipped behavior.

## Build

Requirements:

- Node.js 18.18 or newer
- the repository dependencies installed with `npm ci`
- Pandoc 3.8 or newer
- Playwright Chromium (`npx playwright install chromium`)

Build the HTML, tagged PDF, and EPUB 3 editions:

```sh
npm run docs:dm-guide
```

Build and validate the publication:

```sh
npm run docs:dm-guide:check
```

The full validation command also requires qpdf, Poppler (`pdfinfo`,
`pdffonts`, and `pdftotext`), EPUBCheck, and `unzip`.

Generated files are written to:

```text
dist/publications/dm-guide/
```

Build outputs are deliberately ignored by Git. The ordered source list lives
in `manifest.json`; do not replace it with a glob. Each build also records
input and output SHA-256 hashes plus tool versions in `build-manifest.json`,
allowing the checker to reject stale artifacts.

## Source rules

- Use internal `#anchor` links. Do not link one chapter source file to another.
- Give every image meaningful alt text.
- Keep mechanical prose plain, imperative, and concrete.
- Use ASCII hyphens rather than typographic dash characters.
- Keep internal implementation vocabulary out of player-facing examples.
- Record every generated illustration in
  `assets/illustrations/PROVENANCE.md`.
