# Project 89 art direction

Status: proposed default visual profile, validated with one character, one
location, one item, and one two-stage portrait pilot.

Profile id: `project89-washed-anime/1`

Prompt template: `project89-art/2`

## Direction

The visual target is named **Washed Signal Anime**. It combines:

- clean, expressive anime linework;
- soft cel-painted forms under translucent watercolor glazing;
- slightly faded midtones with a crisp focal silhouette;
- diffuse lantern bloom and restrained atmospheric depth;
- gentle paper grain rather than photoreal surface noise; and
- a muted rose-lavender, deep-teal, and warm coral-amber palette.

The user-provided reference image informed these generic art-direction terms.
It was not uploaded to Replicate, copied into the project, or made a runtime
dependency. The profile does not name or imitate a specific artist.

## Frozen prompt block

Every FLUX.1/P89 base prompt begins with the trigger and explicit style phrase:

```text
P89, anime style,
```

Every prompt then includes its canonical subject facts followed by this exact
shared block:

```text
softly washed watercolor anime illustration,
clean expressive anime linework,
soft cel-painted forms under translucent watercolor glazing,
muted rose-lavender, deep teal and warm coral-amber palette,
diffuse bloom, gentle paper grain, slightly faded midtones,
crisp focal silhouette
```

The block is copied unchanged across characters, locations, and items. Subject
prompts may add framing and physical facts but cannot replace palette, medium,
or rendering terms. `P89` is a LoRA trigger for the FLUX.1 base stage. It is
not added to FLUX.2 prompts; FLUX.2 receives the rendered P89 base as its first
ordered image reference.

## Two-stage pipeline

The registered pipeline separates generation from editorial work:

1. Profile `project89.world-art.base/1` selects
   `replicate.ratimics-project89.v95f3d0eb`, which uses the P89 LoRA at full
   `lora_scale: 1.0` to create the basic character, location, or item.
2. Profile `project89.world-art.refinement/1` selects
   `replicate.project89-flux2.refinement`, which receives that P89 result as
   image 1 and performs cleanup, refinement, or composition. For a Proxim8
   portrait, the immutable original NFT is image 2 and remains the identity
   reference.

FLUX.2 must not invent an actor identity, item definition, location fact, or
world state. It may remove artifacts, improve line and material continuity,
preserve/reframe an approved composition, and combine ordered approved
references. The output is still held for the same visual and provenance
review as the base.

## Subject rules

### Proxim8 portraits

- Use the approved NFT image as the identity input.
- Use LoRA scale `1.0` and prompt strength `0.45`.
- Preserve face, hair pattern, eye color, headset silhouette, clothing
  silhouette, and collection traits.
- Ask for blank, unmarked materials wherever the source includes tiny labels
  or logos.
- Generate a square identity master; tall cards are deterministic
  compositions around that master.
- Hold every candidate for identity, typography, logo, signature, and
  watermark review.

The current P89 endpoint accepts one image input. That input is reserved for
the NFT identity source, so the style reference cannot also be passed as a
second image. Consistency in the base comes from the frozen text profile.
FLUX.2 then receives the P89 base first and the original NFT second. Additional
references are permitted only when their order and purpose are explicit and
the total does not exceed four.

### Locations

- Use text-to-image at `16:9`, LoRA scale `1.0`.
- Use plain, unmarked architectural surfaces and simple light shapes.
- Explicitly exclude scale figures, humanoids, statues, mannequins, robots,
  signs, terminals, screens, labels, glyphs, logos, signatures, and
  watermarks.
- Reject any location containing a person, creature, text-like mark, or
  watermark even if the overall style is correct.
- Send the base through FLUX.2 only when it needs artifact cleanup, controlled
  reframing, or composition with other approved pack references.

### Items

- Use text-to-image at `1:1`, LoRA scale `1.0`.
- Center one readable object silhouette with generous negative space.
- Use the shared palette and watercolor glazing without making the item
  photoreal.
- Exclude hands, holders, people, characters, labels, glyphs, logos,
  signatures, and watermarks.
- Generate once per item definition and art revision, not per item instance.
- Use FLUX.2 for cleanup or composition after the P89 object exists, never to
  infer an item definition from pixels.

## Pilot

All P89 jobs used revision
`95f3d0eb7bdceb1262a2824c1a623e01b1902b71420013e6bc7b760e9f9255d6`,
FLUX `dev`, 28 steps, guidance `3`, WebP quality `80`, and the enabled safety
checker.

| Subject                                |         Seed | Prediction                   | Result                                                                                              |
| -------------------------------------- | -----------: | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Callum Synclaire, strength `0.45`      | `1678370352` | `5q3ddbs4khrmy0cznb5bmkmhz0` | Style and identity pass; reject raw output for false lettering.                                     |
| Callum Synclaire, strength `0.50`      | `1135004083` | `0m1md0zmjnrmr0cznb5r5gxsjc` | Strong identity; reject raw output for false lettering on headset and clothing.                     |
| Callum Synclaire, full LoRA `1.0` base |  `728375885` | `ngaayc3v1drmw0cznb7twbp0ew` | P89 style and identity pass; hold base for false headphone lettering.                               |
| Callum Synclaire, FLUX.2 refinement    |  `475257086` | `78m18zan45rp00cznb8byzya30` | Removes the false lettering while preserving the identity, crop, palette, and P89 base composition. |
| Threshold Interface, attempt 1         | `1870953428` | `2jsadns3d9rmt0cznb58gsseag` | Palette and anime style pass; reject glyph-like wall marks.                                         |
| Threshold Interface, attempt 2         |  `405548169` | `x3vbftr4p5rmt0cznb6a1b8ec8` | Pass initial review: empty, unmarked `1344x768` environment with the target palette.                |
| Agent Memory Seed                      | `1625844702` | `3kb0gb8xy9rmy0cznb58nvgqcw` | Pass initial review: centered `1024x1024` item with strong watercolor-anime treatment.              |

The selected location SHA-256 is
`2e9ca64bdc25df86fdaa6afb05f74e5492452fa3ee7b1e8ae1a519bae43ea099`.

The selected item SHA-256 is
`5432b584d25e4473ee732cd8fddd88701d50004d72d2d309b5a022dba991b679`.

The full-strength Callum base SHA-256 is
`5a885830f3f255e64e5a229e0176fc712268c1781806da4ea7858c42ed569236`.
The FLUX.2 refinement SHA-256 is
`ebf4787ebdc48b57f548c19fcdd951542239dd71ba231863746899a5f966f1f7`.
Both stages use pinned Replicate revisions and retain their complete ordered
parent, prompt, seed, prediction, and output provenance.

## Consistency contract

Consistency is enforced by:

1. one `P89` trigger and the literal `anime style` phrase;
2. one immutable shared style block;
3. fixed full LoRA scale, steps, guidance, output format, and subject shapes;
4. deterministic seeds derived from subject, metadata, profile, and recipe
   revision;
5. canonical palette and framing rules;
6. ordered FLUX.2 parent references, with the P89 base always first;
7. the same automated and human publication review; and
8. explicit version bumps for every future style change.

Changing one adjective in production creates a new profile version. Existing
approved art remains attached to its original profile and is never silently
regenerated.
