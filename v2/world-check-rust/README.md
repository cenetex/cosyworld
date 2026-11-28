# World pack authoring checks

Run the Rust checker from the repository root to validate built-in pack documents and the bridges that mount them.

```sh
cargo run --locked --manifest-path v2/world-check-rust/Cargo.toml -- v2
```

Generate editor JSON Schemas from the same Rust types. Choose `pack` for `card-world.json`, `bridge` for `card-bridge.json`, or `table` for `card-table.json`.

```sh
cargo run --locked --manifest-path v2/world-check-rust/Cargo.toml -- --schema pack > pack.schema.json
```

The Rust check covers document structure, place exits, release lists and availability, and entries between released places. It runs through `npm run v2:card:world:check` and CI. The existing `npm run v2:card:pack:check` also checks rule conditions, media, imported packs, and generated runtime assets.
