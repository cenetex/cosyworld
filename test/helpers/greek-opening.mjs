import "./still-cast.mjs";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeSave } from "../../v2/card-game/world.mjs";

// Recorded rules-103 journeys keep the retired opening paths available for
// migration and later-story tests. Each state enters through the save loader.
export function openingFixture(branch, { water = true, reportFirst = true } = {}) {
  const name = `${branch}${reportFirst ? "" : "-late-report"}${water ? "" : "-dry"}`;
  const states = JSON.parse(gunzipSync(readFileSync(new URL(
    `../fixtures/greek-before-funeral/${name}.json.gz`, import.meta.url,
  ))));
  return Object.fromEntries(Object.entries(states).map(([key, world]) =>
    [key, decodeSave(JSON.stringify(world))]));
}
