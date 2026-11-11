// Face art by avatar id, like the sleep portraits: a client-only map. An
// avatar with no entry here (every shipped avatar today) keeps its portrait.
// The maker's accepted poses (happy, sad, strike, brace, hit) register here
// when a private world is opened in the table. A pack avatar may also carry
// `moods: {happy, sad}`; that field needs the rules bump to pass the schema.
import { packPeople } from "./pack-registry.mjs";
import { moodOf } from "./mood.mjs";

export const faceArt = {};
// poses: {happy?, sad?, strike?, brace?, hit?} as paths relative to the table.
export const registerFaceArt = (id, poses) => {
  faceArt[id] = { ...faceArt[id], ...poses };
};
const art = (id) => faceArt[id] || packPeople[id]?.moods || null;

export function moodPortrait(world, id) {
  const mood = moodOf(world, id);
  const file = mood && art(id)?.[mood];
  return file || null;
}
// Fight art for avatars that bring their own: strike attacks, brace guards.
const FIGHT = { attack: "strike", guard: "brace", hit: "hit" };
export const fightPortrait = (id, pose) => art(id)?.[FIGHT[pose]] || null;
