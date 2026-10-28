import { makeReadingCatalog } from "../card-game/poem-readings.mjs";
import { humanAvatars } from "../card-game/human-cast.mjs";

const revision = (id) =>
  Number(/^full-card-world\/(\d+)(?:#[0-9a-f]{16})?$/.exec(id)?.[1]);

// The current rules catalog is compiled with its source. Later rules retain
// each earlier catalog so a saved reading keeps its exact published words.
export function compileReadingCatalogs(packs, version, previous = null) {
  if (!revision(version) || (previous && previous.schemaVersion !== 1))
    throw new Error("Choose a published rules identity for the poem catalog.");
  const histories = structuredClone(previous?.packs || {});
  for (const pack of packs.filter((pack) => pack.recital)) {
    const history = histories[pack.id] || { current: null, catalogs: {} };
    const earlier = history.catalogs[history.current] || null;
    if (earlier && revision(earlier.id) > revision(version))
      throw new Error(
        "Build the poem catalog with its current or later rules.",
      );
    const authors = new Map(
      humanAvatars.map((actor) => [
        actor.id,
        { id: actor.id, name: actor.name },
      ]),
    );
    for (const [id, actor] of Object.entries(pack.avatars))
      if (!authors.has(id)) authors.set(id, { id, name: actor.name });
    const input = {
      id: version,
      pack: pack.id,
      title: pack.recital.title,
      verses: pack.recital.verses,
      authors: [...authors.values()],
      previous: earlier,
    };
    const draft = makeReadingCatalog(input);
    const id = `${version}#${draft.digest.slice(0, 16)}`;
    const catalog = makeReadingCatalog({ ...input, id });
    if (
      history.catalogs[id] &&
      JSON.stringify(history.catalogs[id]) !== JSON.stringify(catalog)
    )
      throw new Error("Use a distinct identity for the changed poem catalog.");
    history.catalogs[id] = catalog;
    history.current = id;
    histories[pack.id] = history;
  }
  return { schemaVersion: 1, currentVersion: version, packs: histories };
}
