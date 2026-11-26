import { settleCrossingUnlocks as unlockCrossings } from "./pack-rules.mjs";
import { completeCall } from "./want.mjs";
import { wantAPI } from "./world.mjs";
import { learnTold } from "./quest-learn.mjs";
import { nameOf, theName } from "./world/catalog.mjs";
import { questFactId } from "./knowledge.mjs";

export const ownerWant = (s, owner) =>
  s.actors[owner]?.want ?? s.actors[owner]?.completedQuest?.want;

export function callTeller(s, viewer, owner) {
  const want = ownerWant(s, owner), here = s.actors[viewer]?.place;
  if (want?.step?.verb !== "call" || s.actors[owner]?.place === here) return null;
  const teller = s.knowledge?.known?.[viewer]?.[questFactId(owner, want)]?.teller;
  return teller && s.actors[teller]?.place === here ? teller : null;
}

export function completionWords(actor, want, owner) {
  if (want.step?.verb === "call") return `${nameOf(actor)} calls the ship for ${nameOf(owner)}.`;
  return want.kind === "item"
    ? `${nameOf(want.step?.verb === "give" ? want.step.to : actor)} has ${theName(want.target)} at last.`
    : want.kind === "place"
      ? `${nameOf(actor)} reaches ${nameOf(want.target)}.`
      : want.kind === "connect"
        ? `${nameOf(actor)} makes an introduction at last.`
        : `${nameOf(actor)} and ${nameOf(want.target)} talk at last.`;
}

// This authored conversation predates Vale's arrival; Pip is now at the pond.
export function seedCallLead(s, addLog) {
  if (!s.opening || s.actors.keeper.want?.step?.verb !== "call") return;
  addLog(s, "World", "Before Vale arrived, the keeper told Pip how to call the ship.", {
    kind: "action", verb: "talk", actorId: "keeper", targetId: "moth",
    locationId: "station", cast: ["keeper", "moth"], witnesses: ["keeper", "moth"], items: [],
  });
  learnTold(s, "keeper", "moth");
}

// Capture the caller before residents act; narration may wait for the action.
export function settleCrossingUnlocks(s, senses, { defer = false, initiator = senses.player } = {}) {
  const pending = [];
  unlockCrossings(s, senses, (crossing, by) => {
    for (const [owner, a] of Object.entries(s.actors))
      if (a.want?.step?.verb === "call" && a.want.step.crossing === crossing.id)
        completeCall(s, owner, by, { ...wantAPI(s), log: (...args) => pending.push(args) });
  }, initiator);
  const narrate = () => {
    for (const args of pending.splice(0)) wantAPI(s).log(...args);
  };
  if (!defer) narrate();
  return narrate;
}
