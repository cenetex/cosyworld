# Journal Storybook Pages

The player Journal is a personal storybook, not an event table. Canonical
events remain the replay authority, while rest turns those facts into durable
sentences and illustrated leaves owned by one avatar's Journal.

## Rest cadence

- An open leaf accumulates typed `JournalBeatView` evidence.
- A camp or lodging rest is a **short rest** for Journal presentation. It adds
  one to three first-person sentences to the open leaf. Generation may shape
  voice, but names, places, items, outcomes, and source sequences must all come
  from the frozen semantic beats. A deterministic first-person sentence is the
  provider-offline fallback.
- A hearth rest is a **long rest**. It first adds the short-rest sentences,
  then seals the leaf and schedules one illustration. Sealing is the durable
  commit point; image generation is asynchronous and cannot hold the rest turn
  open.
- A failed or unavailable image route leaves a complete prose page. Retrying
  reuses the same job identity and never rewrites its sentences or spends for
  a second successful image.

## Durable leaf view

The browser accepts the following server-owned projection. It does not infer
rest type, prose, provenance, or ownership from raw events.

```json
{
  "artifact_id": "journal-leaf:v1:<actor-id>:<sealed-seq>",
  "page_index": 4,
  "rest_kind": "long",
  "status": "ready",
  "title": "Rain at the garden gate",
  "source_event_seqs": [120, 121, 125],
  "sentences": [
    "I arrived as the rain began to soften.",
    "The buried stones were still waiting beneath the drain."
  ],
  "illustration_url": "/generated/journal-leaves/<artifact-id>.webp",
  "illustration_alt": "An ink-and-watercolour garden path after rain.",
  "style_revision": "sylvie-field-hand/3",
  "provenance_digest": "sha256:<digest>",
  "transferable": false
}
```

`sentences` are rendered as real text over paper. The model must not draw the
Journal prose into the image: keeping text outside the bitmap preserves
legibility, accessibility, localization, search, and exact replay.

## Illustration route to wire

The server media job should use a new `journal_page` intent and the existing
frozen recipe, candidate storage, review, publication, and attempt-budget
boundaries. The browser contract is ready for the resulting approved URL; this
document does not mean a provider call is active before that worker is shipped.

1. Prefer the capability-registry route for `openai/gpt-image-2`.
2. Allow a reviewed Google image route (the Nano Banana family) as a declared
   fallback or canary, never as an unrecorded provider substitution.
3. Freeze the avatar, place, accepted sentence set, source-event boundary,
   style revision, prompt version, model binding, and optional approved
   references before provider spend.
4. Request a text-free ink/watercolour vignette with generous paper-like edge
   falloff so the browser can compose it naturally into the leaf.
5. Run the normal fail-closed vision publication review. Only the immutable
   approved asset URL enters `journal_pages`.

## Avatar style

Each avatar begins with a worldpack-authored style profile. Accepted pages may
advance a bounded style revision—palette, mark-making, framing habits, and
recurring botanical or geometric motifs—but may not alter canonical identity
or facts. The prior accepted revision is an optional certified style
reference. Rejected candidates never become future style input.

## Collectible boundary

A sealed leaf has a stable artifact identity and provenance digest so it can
later become an in-world tradeable item. Transferring that collectible changes
who carries the artifact; it does not transfer, erase, or fork the originating
avatar's canonical Journal history. External tokenization or wallet authority
remains outside the core world contract and requires a separate product and
ADR decision.

## Acceptance

- No category columns, meters, event keys, source sequences, or provider
  metadata appear on the page.
- Short-rest prose and long-rest media reproduce identically after reconnect,
  snapshot restore, and full journal replay.
- Provider-offline play still seals readable prose leaves.
- One long rest can publish at most one approved image for its artifact id.
- Accessibility text describes the pictured memory without duplicating the
  visible sentences.
- Style evolution is versioned per avatar and can be audited back to accepted
  page assets.
