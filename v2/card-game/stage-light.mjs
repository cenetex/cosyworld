// Presentation-only time of day. The rules keep two light settings, each
// DAYLIGHT_TURNS plays long; the stage reads the same committed turn as a
// continuous game hour, so every viewer of a world sees the same sky. Nothing
// here is read by the rules, saves, the journal or the shared engine.
const DAY_TURNS = 48;
const HOURS_PER_TURN = 24 / DAY_TURNS;

// Turn 0 is 06:00 and the painted night starts at turn 24, 18:00.
export const hourOf = (turn) => (((6 + HOURS_PER_TURN * turn) % 24) + 24) % 24;

// shade multiplies the painting, desat greys it, vignette darkens its edges,
// light and saturate grade the figures, stars fill an open sky.
const neutral = {
  shade: [1, 1, 1],
  desat: 0,
  vignette: 0,
  light: 1,
  saturate: 1,
  stars: 0,
};
const key = (hour, period, shade, desat, vignette, light, saturate, stars) => ({
  hour,
  period,
  shade: [0, 2, 4].map((at) => parseInt(shade.slice(at, at + 2), 16) / 255),
  desat,
  vignette,
  light,
  saturate,
  stars,
});
// Initial colour script; tune on .dev. Each key holds from its hour.
export const KEYS = [
  key(0, "midnight", "48558a", 0.5, 0.6, 0.56, 0.5, 1),
  key(4.5, "night", "6c76a8", 0.4, 0.35, 0.7, 0.65, 0.6),
  key(6, "dawn", "f3d2c4", 0.08, 0.12, 0.95, 0.95, 0),
  key(8, "morning", "ffffff", 0, 0, 1, 1, 0),
  key(12, "noon", "ffffff", 0, 0, 1, 1, 0),
  key(15, "afternoon", "fff8ee", 0, 0, 1, 1, 0),
  key(17, "golden hour", "f2c98e", 0, 0.18, 1, 1.06, 0),
  key(18.5, "dusk", "9fb0d8", 0.2, 0.25, 0.85, 0.8, 0.3),
  key(21, "night", "5f6d9e", 0.4, 0.45, 0.68, 0.6, 0.8),
];
const smooth = (x) => x * x * (3 - 2 * x);
const mix = (a, b, t) => a + (b - a) * t;

// A painted night already carries its own dark, so it keeps only this share
// of the grade (#1696: night paintings must not be darkened twice).
export const GENTLE = 0.25;

// The grade at a game hour. strength 1 is the full grade, GENTLE the
// share kept over a night painting, 0 none.
export function lightAt(hour, strength = 1) {
  const h = ((hour % 24) + 24) % 24;
  let at = KEYS.length - 1;
  while (at > 0 && KEYS[at].hour > h) at -= 1;
  const from = KEYS[at];
  const to = KEYS[(at + 1) % KEYS.length];
  const span = (to.hour - from.hour + 24) % 24 || 24;
  const t = smooth(((h - from.hour + 24) % 24) / span);
  const value = (name, i) => {
    const a = i === undefined ? from[name] : from[name][i];
    const b = i === undefined ? to[name] : to[name][i];
    const base = i === undefined ? neutral[name] : neutral[name][i];
    return mix(base, mix(a, b, t), strength);
  };
  return {
    hour: h,
    period: (t < 0.5 ? from : to).period,
    shade: [0, 1, 2].map((i) => value("shade", i)),
    desat: value("desat"),
    vignette: value("vignette"),
    light: value("light"),
    saturate: value("saturate"),
    stars: value("stars"),
  };
}

export const isNeutral = (light) =>
  light.shade.every((v) => v > 0.995) &&
  light.desat < 0.005 &&
  light.vignette < 0.005 &&
  Math.abs(light.light - 1) < 0.005 &&
  Math.abs(light.saturate - 1) < 0.005;

// How a stage moves from the hour on screen to the committed turn: a play
// eases over EASE_MS; a longer jump (a long rest) sweeps through the hours
// between; going back in time (a new game) or a new place cuts.
export const EASE_MS = 4000;
export function lightPath(fromTurn, toTurn) {
  if (fromTurn == null || toTurn < fromTurn || toTurn - fromTurn > DAY_TURNS)
    return { from: toTurn, to: toTurn, duration: 0 };
  return {
    from: fromTurn,
    to: toTurn,
    duration: toTurn > fromTurn ? EASE_MS : 0,
  };
}

const css = (n) => Number(n.toFixed(3));
// The CSS custom properties the stage grade reads.
export function lightStyle(light) {
  const [r, g, b] = light.shade.map((v) => Math.round(v * 255));
  return {
    "--tod-shade": `rgb(${r} ${g} ${b})`,
    "--tod-desat": String(css(light.desat)),
    "--tod-vignette": String(css(light.vignette)),
    "--tod-figure": `brightness(${css(light.light)}) saturate(${css(light.saturate)})`,
  };
}
