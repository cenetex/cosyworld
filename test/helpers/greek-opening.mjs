import "./still-cast.mjs";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeSave } from "../../v2/card-game/world.mjs";
import { journeyWorlds } from "./journey.mjs";
import {
  greekBeforeFuneral,
  greekBeforeFuneralDry,
} from "../journeys/greek-before-funeral.mjs";

// The errands before the funeral, played on the current rules each run by the
// journey in test/journeys/greek-before-funeral.mjs. Checkpoints: arrival,
// waterOffer, water, decree, traded, writ, opened (the dry journey has arrival and decree).
// Prefer this to `openingFixture` whenever the test stops before a branch.
export const greekErrands = ({ water = true } = {}) =>
  journeyWorlds(water ? greekBeforeFuneral : greekBeforeFuneralDry);

// Recorded rules-103 journeys keep the retired opening paths available for
// migration and later-story tests. Each state enters through the save loader.
// They are scheduled to go with the rules bump (docs/design/wants-and-arcs.md,
// "the Theban-response branch"); new tests use `greekErrands` or a journey.
export function openingFixture(branch, { water = true, reportFirst = true } = {}) {
  const name = `${branch}${reportFirst ? "" : "-late-report"}${water ? "" : "-dry"}`;
  const states = JSON.parse(gunzipSync(readFileSync(new URL(
    `../fixtures/greek-before-funeral/${name}.json.gz`, import.meta.url,
  ))));
  return Object.fromEntries(Object.entries(states).map(([key, world]) =>
    [key, decodeSave(JSON.stringify(world))]));
}
