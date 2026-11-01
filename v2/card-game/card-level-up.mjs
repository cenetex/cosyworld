import { levelTier, romanLevel } from "./rarity.mjs";

// A card whose level rises glows once, shifting from its old tier colour to
// the new one, lifts a little and changes its numeral in place. One smooth
// swell, no text, no pulses; reduced motion shows the new level at once.
export const LEVEL_UP_MS = 1100;

export function levelUpPlan(from, to, { reduced = false } = {}) {
  if (reduced || !Number.isSafeInteger(from) || !(to > from)) return null;
  const before = levelTier(from),
    after = levelTier(to);
  return {
    ms: LEVEL_UP_MS,
    lift: after.id === before.id ? 4 : 7,
    glow: after.id === before.id ? 14 : 22,
    from: { color: before.color, numeral: romanLevel(from) },
    to: { color: after.color, numeral: romanLevel(to) },
  };
}

const reduceMotion = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const rest = "0 6px 20px #0006";
const shine = (color, size) =>
  `0 0 0 1px ${color}cc, 0 0 ${size}px ${color}99, ${rest}`;

// A met quest card swells once in its own tier colour before the next
// quest takes its place. Resolves at rest; reduced motion skips it.
export function glowCard(button, color, options = {}) {
  if (options.reduced ?? reduceMotion()) return Promise.resolve(false);
  const motion = button.animate(
    [
      { boxShadow: rest, borderColor: color },
      { boxShadow: shine(color, 22), borderColor: color, offset: 0.5 },
      { boxShadow: rest, borderColor: color },
    ],
    { duration: LEVEL_UP_MS, easing: "ease-in-out" },
  );
  return motion.finished.then(
    () => true,
    () => false,
  );
}

// Plays on a freshly drawn card button already showing its new level.
// Resolves once every added layer is gone and the card is at rest.
export function levelUpCard(button, from, options = {}) {
  const plan = levelUpPlan(from, Number(button.dataset.level), {
    reduced: options.reduced ?? reduceMotion(),
  });
  if (!plan) return Promise.resolve(false);
  const { ms, from: a, to: b, glow } = plan;
  const ease = "cubic-bezier(.3,.6,.3,1)";
  const resting = button.dataset.selected === "true" ? 0.6 : 0;
  button.dataset.levelingUp = "true";
  const marks = [...button.querySelectorAll(".card-level")];
  const layers = [],
    animations = [
      button.animate(
        [
          { boxShadow: rest, borderColor: a.color },
          {
            boxShadow: shine(a.color, glow * 0.6),
            borderColor: a.color,
            offset: 0.25,
          },
          {
            boxShadow: shine(b.color, glow),
            borderColor: b.color,
            offset: 0.55,
          },
          { boxShadow: rest, borderColor: b.color },
        ],
        { duration: ms, easing: "ease-in-out" },
      ),
      button.animate(
        [
          { translate: "0 0" },
          { translate: `0 -${plan.lift}px`, offset: 0.45 },
          { translate: "0 0" },
        ],
        { duration: ms, easing: ease },
      ),
    ];
  for (const mark of marks) {
    mark.style.visibility = "visible";
    const old = mark.cloneNode();
    old.textContent = a.numeral;
    old.style.setProperty("--tier-color", a.color);
    old.classList.add("card-level-old");
    mark.after(old);
    layers.push(old);
    animations.push(
      old.animate(
        [
          { opacity: 0 },
          { opacity: 0.75, offset: 0.2 },
          { opacity: 0, offset: 0.5 },
          { opacity: 0 },
        ],
        { duration: ms, easing: "ease-in-out" },
      ),
      mark.animate(
        [
          { opacity: 0 },
          { opacity: 0, offset: 0.4 },
          { opacity: 0.75, offset: 0.65 },
          { opacity: resting },
        ],
        { duration: ms, easing: "ease-in-out" },
      ),
    );
  }
  return Promise.allSettled(animations.map((x) => x.finished)).then(() => {
    for (const x of animations) x.cancel();
    for (const layer of layers) layer.remove();
    for (const mark of marks) mark.style.visibility = "";
    delete button.dataset.levelingUp;
    return true;
  });
}
