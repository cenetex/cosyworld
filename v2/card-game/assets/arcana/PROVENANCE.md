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

## Remaining arcana and the backs

The same tool generated VI–XXI and both woodcut backs on November 14, 2026.
All eighteen selected PNGs are unchanged tool outputs at 1024 × 1536, opaque.
The remaining generated cards and XII's labeled alternate are in `full-size/`.
The newly supplied XIII is `arcanum-13.png`; the two backs are `tarot-back.png`
and `tarot-back-locked.png`.

[The continuation prompts](remaining-deck-prompts.json) follow the owner's
November 14 correction in this chat: retain each suit's color. Moths use
periwinkle blue, bells teal, buttons olive, and lanterns terracotta orange.
The original crops also guide those colors within each scene. The World has
one corner emblem in each suit color. Both backs retain their original
cream/black design. The first six cards already preserve their suit colors.

Nine continuation cards first rendered without their suit colors. Individual
image-generation edits restore those colors while preserving their composition
and lettering. [The superseded prompt set](superseded-monochrome-prompts.json)
and [palette correction record](palette-corrections.json) identify those earlier
outputs; the selected files use the corrected palette.

The image service rejected the first attempts at the Hanged Man, Devil, and
Star. [The retry record](generation-retries.json) retains those attempts.
The selected Devil and Star depict clothed adults. Suspended versions of the
Hanged Man were rejected. A fresh supported-handstand interpretation generated
successfully, but the full-set review found that it changes the original
suspension/surrender symbolism. A targeted supported-aerial edit was also
rejected. `full-size/arcanum-12-handstand-alternate.png` is retained as a labeled
alternate. The original owner crop remained live at the time of that review.

XIII and both backs use exact crops from the owner's
`cosyworld-tarot-six-scarves.pdf`. The three crops are retained in
`references/`; their [source record](references/provenance.json) identifies
the PDF by SHA-256, its embedded image, and the exact pixel rectangles.
The other fifteen cards use the repository's existing owner crops.
The keyhole back also uses the generated star back as its layout reference.

[The continuation receipts](remaining-deck-provenance.json) record all input
and selected output hashes, source filenames, dimensions, alpha checks, and
exact prompt references. Visual review covered titles and Marseille numerals,
the blank XIII title plate, the cut scarf, the Devil's closed box, and the
two backs' symbols. The normal builder supplies all smaller WebPs.

The November 14 review accepted full-size art for 21 arcana and both backs.

## XII The Hanged Man

On November 27, the original owner crop guided a full-size redraw. It keeps
the inverted figure tied to the branch by one ankle, the dark figure in the
water, and the original teal suit accents. `arcana.json` selects
`full-size/arcanum-12.png`. The original crop keeps its public URL and serves
as the reference in the [asset record](hanged-man-provenance.json).
