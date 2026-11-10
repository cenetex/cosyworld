// Play every test journey (test/journeys/) on the current rules and compare
// the checkpoints with test/journeys/checkpoints.json. Tests build their own
// starting states from the same journeys at run time; this file is only the
// readable record that makes a rules or pack change reviewable.
//   node v2/scripts/build-test-journeys.mjs           check (the default)
//   node v2/scripts/build-test-journeys.mjs --check   the same, explicitly
//   node v2/scripts/build-test-journeys.mjs --write   rewrite the record
import { readFile, writeFile } from "node:fs/promises";
import { journeys } from "../../test/journeys/index.mjs";
import { playJourney, summarize } from "../../test/helpers/journey.mjs";

const output = new URL("../../test/journeys/checkpoints.json", import.meta.url);
const built = {};
for (const journey of journeys)
  built[journey.name] = summarize(playJourney(journey));
const text = `${JSON.stringify(built, null, 2)}\n`;

if (process.argv.includes("--write")) {
  await writeFile(output, text);
  console.log(
    `Wrote ${journeys.length} journeys to test/journeys/checkpoints.json.`,
  );
} else {
  const kept = JSON.parse(await readFile(output, "utf8").catch(() => "{}"));
  const stale = [];
  for (const name of new Set([...Object.keys(kept), ...Object.keys(built)]))
    for (const point of new Set([
      ...Object.keys(kept[name] ?? {}),
      ...Object.keys(built[name] ?? {}),
    ]))
      if (
        JSON.stringify(kept[name]?.[point]) !==
        JSON.stringify(built[name]?.[point])
      )
        stale.push(
          `${name} / ${point}: recorded ${JSON.stringify(kept[name]?.[point])}, played ${JSON.stringify(built[name]?.[point])}`,
        );
  if (stale.length) {
    console.error(stale.join("\n"));
    throw new Error(
      "Test journeys changed. Read the diff, then run npm run test:journeys:build.",
    );
  }
  console.log(
    `Test journeys match test/journeys/checkpoints.json (${journeys.length}).`,
  );
}
