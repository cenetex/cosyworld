export const VOICE_CHANCE = 0.05;

export function chanceLine(speaker, text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`${speaker}\n${text}`))
    hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0 < VOICE_CHANCE * 2 ** 32;
}
