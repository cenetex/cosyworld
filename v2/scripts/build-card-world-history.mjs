import { readFile, writeFile } from "node:fs/promises";
import { makeHistory } from "./world-history.mjs";

const output = new URL("../card-game/world-history.json", import.meta.url);
const started = performance.now();
const history = makeHistory({
  report: (row) => console.log(`[history] ${JSON.stringify(row)}`),
});
const text = `${JSON.stringify(history)}\n`;
console.log(
  `[history] kept seed ${history.seed} score ${history.score}, ${history.changes.length} changes, ${text.length} bytes, ${Math.round(performance.now() - started)} ms`,
);
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== text)
    throw new Error(
      "Rebuild the world's history with node v2/scripts/build-card-world-history.mjs.",
    );
} else await writeFile(output, text);
