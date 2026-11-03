# The Warren (`warren`)

A patient burrow beneath Black pond, reached through a crack in the stone.
Whatever the surface discards drifts down here, and the residents keep it:
memory-spores on cool shelves, small refusals recorded as soft chalk marks.
Nothing down here is thrown away twice.

- `card-world.json` is the reusable world. It does not mention the hub by
  name; the bridge joins it to Black pond.
- [`../../worlds/warren/card-bridge.json`](../../worlds/warren/card-bridge.json)
  joins it to the shore: the crack beneath Black pond is always open, and the
  way back is the same crack climbed slowly.
- Art lives in `v2/card-game/assets/warren/`; its provenance is in
  [`v2/card-game/assets/PROVENANCE.md`](../../card-game/assets/PROVENANCE.md).

Places: the Threshold (burrow mouth), the Spore Shelf (kept memory), the
Ledger Nook (kept refusals). Residents: the Hissling, a patient coil that
hatched itself, keeps the Threshold; the Sifter turns each spore jar a
quarter-turn a day so memories fade evenly — tending, not rescuing.

After editing either file, run `npm run v2:card:pack:build`.
