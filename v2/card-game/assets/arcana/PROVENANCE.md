# Full-size woodcut arcana

The built-in `image_gen` tool regenerated the first six cards on November 14,
2026, for [the full-size deck backlog](https://github.com/cenetex/cosyworld/issues/2758).
Each card uses its existing owner-supplied crop as its design reference.

The six unchanged generated PNGs are in `full-size/`. Each is 1024 × 1536,
with an opaque background. `arcana.json` selects them for the deck. The earlier
owner crops and their public URLs remain available.

[The prompt set](full-size-six-prompts.json) records the exact shared prompt and
the card-specific suffixes. Concatenate them with two newline characters to
recover each submitted prompt. [The receipts](full-size-six-provenance.json)
record reference hashes, selected source filenames, generated and saved PNG
hashes, dimensions, and alpha checks. The normal image builder supplies the
stage, phone, and card WebPs.

Visual checks covered each title and numeral, the Fool's blank number plate
and absent corner emblems, the six compositions, and the red scarves on the
Fool, Magician, and Empress. The generated art retains the owner's woodcut
designs with newly drawn details. These are regenerated paintings, not original
full-resolution exports of the owner's deck.

This batch covers 0–V. Sixteen arcana, the two backs, and the Listener's deck
item remain outside this batch. The deck's acts and card-back assignments are
unchanged.
