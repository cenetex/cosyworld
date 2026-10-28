// Base-schema migration tests keep the mounted cast and use its earlier pack
// shape. Shared reading archives joined after these save formats.
export function legacySaveFixture(world, schema) {
  if (!Number.isInteger(schema) || schema < 1 || schema > 6)
    throw new Error("Choose an earlier base save format.");
  const saved = structuredClone(world);
  saved.schema = schema;
  for (const pack of Object.values(saved.packs || {})) {
    const archive = pack.poemReadings;
    if (
      archive &&
      (archive.stanzas.length ||
        ["readings", "drafts", "pins", "decisions"].some(
          (field) => Object.keys(archive[field]).length,
        ))
    )
      throw new Error("Use a fixture from before shared readings.");
    delete pack.poemReadings;
  }
  const ids = Object.keys(saved.actors);
  for (const [id, actor] of Object.entries(saved.actors)) {
    if (schema < 6) delete actor.trust;
    else
      actor.trust = {
        ...Object.fromEntries(
          ids.filter((peer) => peer !== id).map((peer) => [peer, 0]),
        ),
        ...actor.trust,
      };
  }
  return saved;
}
