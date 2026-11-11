import {
  greekBeforeFuneral,
  greekBeforeFuneralDry,
  greekGateOpen,
  greekGateOpenFull,
} from "./greek-before-funeral.mjs";
import { questCards } from "./quest-cards.mjs";

// Every named journey. The builder plays each one and keeps checkpoints.json
// in step; add a journey here after writing its module.
export const journeys = [
  greekBeforeFuneral,
  greekBeforeFuneralDry,
  greekGateOpen,
  greekGateOpenFull,
  questCards,
];
