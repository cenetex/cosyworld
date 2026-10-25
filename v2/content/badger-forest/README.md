# The Steam Clock (`badger-forest`)

A sunlit clearing where an old Steam Clock ticks over Grumpy Badger's patch of
moss. It is the reference card-table world pack: one place, one resident with
moods, and one fixture. See [`v2/docs/card-packs.md`](../../docs/card-packs.md)
for the format.

- `card-world.json` is the reusable world. It does not mention Black pond.
- [`../../worlds/badger-forest/card-bridge.json`](../../worlds/badger-forest/card-bridge.json)
  joins it to the shore: two consecutive bell rings at Black pond open the way
  in for three turns, and a bell sounding at either end (including the Steam
  Clock's own) opens the way back.
- Art lives in `v2/card-game/assets/badger-forest/`; its provenance is in
  [`v2/card-game/assets/PROVENANCE.md`](../../card-game/assets/PROVENANCE.md).

After editing either file, run `npm run v2:card:pack:build`.
