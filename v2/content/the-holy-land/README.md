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
- a shared project that advances through testimony and ordinary acts of help,
  alongside a danger clock for contradictory rumors and eventual false
  claimants;
- ten carried objects: five humble tools and supplies that answer concrete
  needs, plus five parable objects with distinct gameplay roles;
- four composite, unnamed wayside supplicants whose prose-mode conversations
  can produce varied period-grounded needs without impersonating a specific
  historical person;
- long-distance exits that activate CosyWorld's generated pathway, Search,
  Travel, and pathway-art systems; and
- original watercolor card art generated with the `ratimics/b43l` Replicate
  model. No Bible translation is quoted in the authored text.

## Authored goals and secrecy

The disciples' motives are planner-only, not cryptographically secret. They
are omitted from the public actor view, but this is an MIT-licensed open-source
pack: anyone who reads `actors.json`, a compiled bundle, a server prompt, or a
debug trace may discover them. This boundary prevents casual UI disclosure; it
does not provide security against a player who controls the host.

Truly unpredictable private traits would need a future runtime system that
samples from a pool larger than the cast, stores each assignment in
server-controlled state, and releases only consequences appropriate to a
player's view. Even then, an administrator of a self-hosted server could inspect
the state.

## Narrative and editorial boundary

Runtime memories speak from inside the world: Christ is real and has gone
ahead, but no authored actor, card, project completion, or clock effect
instantiates him. The search may produce testimony, disagreement, changed
lives, false claimants, and new roads.

The geography is deliberately atemporal and literary. Exact identifications of
Cana, Bethsaida, Emmaus, individual teaching sites, and some traditional
routes remain debated; their placement here is a playable arrangement, not a
claim of modern geographic certainty. Composite supplicants never impersonate
named figures or speak for a living community. Judas is written as an
individual without using his betrayal to blame a living people or faith.

The parable objects are playable teaching objects, not fabricated
archaeological relics. The Pearl of Great Price, Lost Silver Coin, Mustard Seed
Pouch, Waiting Wedding Lamp, and Samaritan Oil and Linen can be found and used
in the world; their descriptions identify them through the stories they help
people tell rather than claiming that Christ handled those exact instances.

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
npm run v2:holy-land:art -- --force --ids=holy-land-simon-peter --sample-dir=/tmp/holy-land-ab --style="Half-painted wet watercolor study, raw paper."
```

`--sample-dir` runs the pinned generation pipeline but writes only preview files;
it does not replace card art or update `cards.json` or `assets/cards/prompts.json`.

The generator pins Replicate model version
`2846199bda89a44676dc5da00bd02faa3f5183b1c1d3e124c966d656874f141f`
and records prompts, seeds, model provenance, and output paths in
`assets/cards/prompts.json`.

New generations begin with a two-line, in-medias-res prompt: the B43L trigger
and rough unfinished-watercolor medium, followed by the named person or place
already encountered on the journey. The prompt intentionally avoids defensive
negative lists; occasional visual mistakes remain material for later orb
upgrades. The default model-native LoRA scale is `1.25` and can be overridden
with `HOLY_LAND_LORA_SCALE`. Existing images and their recorded prompts remain
historical provenance until an image is actually regenerated.

## Official-world bridge

The separately versioned `cosyworld.composition.core-holy-land` bridge owns the
long route between The Cosy Cottage and Bethlehem. Its generated waypoints use
the Holy Land media profile, the current ecology-grounded pathway prose
contract, and the same cairn terminology as generated places inside this pack.
Upgrades preserve already-discovered descendants rather than renaming or
reallocating them.

The compact action hand, deterministic fallback waypoint naming, and
direct-avatar reaction context remain runtime concerns rather than pack
authority. Their playtest contracts are tracked in
[`docs/backlog/holy-land-integration-playtest.md`](../../../docs/backlog/holy-land-integration-playtest.md).
