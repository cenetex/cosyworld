import list from "./world-names.json" with { type: "json" };

// A world's name comes from its run seed, so it is the same for every player
// and survives sharing (v2/docs/card-table/avatar-menu.md). The list is frozen.
export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text))
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

const { words, places } = list.the;
export const worldNameCount = list.names.length + words.length * places.length;

export function worldName(seed) {
  if (!Number.isSafeInteger(seed) || seed < 0) return null;
  const index = fnv1a32(String(seed)) % worldNameCount;
  if (index < list.names.length) return list.names[index];
  const pair = index - list.names.length;
  return `The ${words[Math.floor(pair / places.length)]} ${places[pair % places.length]}`;
}

export const worldNameOf = (world) => worldName(world?.run?.seed);
