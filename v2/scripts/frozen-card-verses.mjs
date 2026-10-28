// Released verse identities keep their exact wording and selection rules.
// A later wording joins the catalog under a new choice earned in play.
const stable = (value) =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );

export function frozenVerseProblems(pack, catalog) {
  if (pack.id !== catalog.packId)
    return ["The frozen verse catalog needs its original pack."];
  const verses = new Map(
    (pack.recital?.verses || []).map((v) => [v.choice, v]),
  );
  return catalog.verses.flatMap((verse) =>
    stable(verses.get(verse.choice)) === stable(verse)
      ? []
      : [
          `${pack.id}: released verse ${verse.choice} needs its original definition; earn changed wording with a new choice`,
        ],
  );
}
