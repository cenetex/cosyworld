import "./still-cast.mjs";
import { journeyWorlds } from "./journey.mjs";
import {
  greekBeforeFuneral,
  greekBeforeFuneralDry,
} from "../journeys/greek-before-funeral.mjs";

// The errands before the funeral, played on the current rules each run by the
// journey in test/journeys/greek-before-funeral.mjs. Checkpoints: arrival,
// waterOffer, water, decree, traded, writ, opened (the dry journey has arrival and decree).
// The Theban-response branches (burial, concession, exposure) are gone: the
// Open Door opens by burying Polynices, played by `funeralJourney` in
// test/helpers/greek-funeral.mjs. No recorded save is read.
export const greekErrands = ({ water = true } = {}) =>
  journeyWorlds(water ? greekBeforeFuneral : greekBeforeFuneralDry);
