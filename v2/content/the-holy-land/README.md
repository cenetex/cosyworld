# The Holy Land

`cosyworld.the-holy-land` is a public CosyWorld narrative pack inspired by the
places and people named in the canonical Gospel traditions. It is designed as
a contemplative journey, not as a claim that every route or traditional site
can be fixed with modern geographic certainty.

The pack includes:

- fifteen Gospel-associated locations from Bethlehem and Nazareth to
  Jerusalem and the road to Emmaus;
- the traditional list of the Twelve; Christ is real within their world but
  remains beyond the authored cast;
- a personal goal for each disciple to search for Christ, with a distinct
  motive that guides resident planning and dialogue without entering the
  public actor projection;
- four composite, unnamed wayside supplicants whose prose-mode conversations
  can produce varied period-grounded needs without impersonating a specific
  historical person;
- long-distance exits that activate CosyWorld's generated pathway, Search,
  Travel, and pathway-art systems; and
- original watercolor card art generated with the `ratimics/b43l` Replicate
  model. No Bible translation is quoted in the authored text.

## Art generation

From the repository root, with `REPLICATE_API_TOKEN` available in `.env`:

```sh
npm run v2:holy-land:art
```

Useful options can be passed after `--`:

```sh
npm run v2:holy-land:art -- --dry-run
npm run v2:holy-land:art -- --ids=holy-land-simon-peter,holy-land-capernaum
npm run v2:holy-land:art -- --force --seed-salt=v2
npm run v2:holy-land:art -- --force --ids=holy-land-simon-peter --sample-dir=/tmp/holy-land-samples
```

`--sample-dir` runs the pinned generation pipeline but writes only preview files;
it does not replace card art or update `cards.json` or `assets/cards/prompts.json`.

The generator pins Replicate model version
`2846199bda89a44676dc5da00bd02faa3f5183b1c1d3e124c966d656874f141f`
and records prompts, seeds, model provenance, and output paths in
`assets/cards/prompts.json`.

New generations begin with a two-line, in-medias-res prompt: the B43L trigger
and rough unfinished-watercolor medium, followed by the named person or place
already encountered on the journey. The default LoRA scale is `1.25` and can
be overridden with `HOLY_LAND_LORA_SCALE`. Existing images and their recorded
prompts remain historical provenance until an image is actually regenerated.
