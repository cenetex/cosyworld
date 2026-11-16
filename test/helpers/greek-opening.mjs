import "./still-cast.mjs";
import { journeyWorlds } from "./journey.mjs";
import {
  greekBeforeFuneral,
  greekBeforeFuneralDry,
} from "../journeys/greek-before-funeral.mjs";

// The errands before the funeral, played on the current rules each run by the
// journey in test/journeys/greek-before-funeral.mjs. Checkpoints: arrival,
// waterOffer, water, decree, traded, writ, opened (the dry journey has arrival and decree).
export const greekErrands = ({ water = true } = {}) =>
  journeyWorlds(water ? greekBeforeFuneral : greekBeforeFuneralDry);
