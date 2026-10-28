import compiled from "./poem-catalogs.json" with { type: "json" };

for (const history of Object.values(compiled.packs)) {
  for (const catalog of Object.values(history.catalogs)) {
    for (const row of catalog.rows) {
      Object.freeze(row.lines);
      if (row.after) {
        Object.freeze(row.after.lines);
        Object.freeze(row.after);
      }
      Object.freeze(row);
    }
    catalog.authors.forEach(Object.freeze);
    Object.freeze(catalog.rows);
    Object.freeze(catalog.authors);
    Object.freeze(catalog);
  }
  Object.freeze(history.catalogs);
  Object.freeze(history);
}
export const readingCatalogVersion = compiled.currentVersion;
export const readingCatalogs = Object.freeze(
  Object.fromEntries(
    Object.entries(compiled.packs).map(([pack, history]) => [
      pack,
      history.catalogs,
    ]),
  ),
);
export const currentReadingCatalog = (packId) =>
  readingCatalogs[packId]?.[compiled.packs[packId]?.current] || null;
