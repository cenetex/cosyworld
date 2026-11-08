# Advisory worldpack catalog

`v2/worldpacks/catalog.json` keeps `name`, `author`, `description`, `tags`, `rating`,
`reviews`, keyed by exact `id` plus `source.repo`. The gate, compiler, build, runtime
never import it. Pins, refs, mount state stay in `store.json`; popularity grants no admission.

Run `node v2/scripts/card-store-catalog.mjs` for offline validation.
Explicitly run `node v2/scripts/refresh-card-store-ratings.mjs` for public GitHub
stars, forks, `rating.updated`. Only the catalog changes. Text, reviews,
`rating.note` stay fixed. Requests have five-second timeouts, 256 KiB responses,
no redirects, exact repository identity checks. Failures retain old observations;
Failures produce a nonzero exit; successes refresh. File edits abort writes.

Use `rating: null` before any observation. Recorded ratings require `source: "github"`,
nonnegative integer stars/forks, UTC `updated`, optional `note`. Earlier date-only
observations remain valid. Reviews are PR-curated plain-text `{author, note, updated}`.
Limits: 1 MiB file, 32 identities, 12 distinct 32-character tags, eight reviews.
Names allow 120 characters, authors 160, descriptions/review notes 1,200, rating notes 600.
Control characters are rejected. No votes or automatic scores.

After Warren admission, add its original name, author, description, tags under
`id: "warren"` plus the admitted repository's exact spelling. Begin with
`rating: null`, `reviews: []`; refresh explicitly. Admission pins stay separate.
