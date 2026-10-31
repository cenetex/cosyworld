import { scaresEnabled } from "./transitions.mjs";

// A covered card opens when the player first taps it. Richer level tiers
// get a longer, warmer reveal; every reveal stays under a second, glows at
// most twice (under three flashes a second) and leaves no lasting animation
// or 3D context behind, so the card and the dialogue keep taking clicks.
const tiers = {
  common: { ms: 520, pulses: 0, lift: 0, sheen: false, glow: 10 },
  uncommon: { ms: 620, pulses: 1, lift: 6, sheen: false, glow: 16 },
  rare: { ms: 720, pulses: 1, lift: 9, sheen: true, glow: 20 },
  epic: { ms: 820, pulses: 2, lift: 12, sheen: true, glow: 24 },
  legendary: { ms: 900, pulses: 2, lift: 16, sheen: true, glow: 30 },
};
export const REVEAL_TIERS = Object.keys(tiers);

// Reduced motion crossfades the lid and shows the label without movement.
// With flashes off, the glow stays soft and steady and the sheen is skipped.
export function revealPlan(tier, { reduced = false, scares = true } = {}) {
  const base = tiers[tier] || tiers.common;
  if (reduced)
    return { tier, ms: 600, crossfade: true, pulses: 0, lift: 0, sheen: false, glow: 0 };
  return {
    tier,
    ms: base.ms,
    crossfade: false,
    pulses: scares ? base.pulses : Math.min(base.pulses, 1),
    lift: base.lift,
    sheen: scares && base.sheen,
    glow: scares ? base.glow : Math.min(base.glow, 12),
  };
}
export const flashRate = (plan) => plan.pulses / (plan.ms / 1000);

const reduceMotion = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const running = new Map();

function glowFrames(color, { pulses, glow }) {
  const rest = "0 6px 20px #0006";
  const lit = `0 0 0 1px ${color}cc, 0 0 ${glow}px ${color}88, 0 6px 20px #0006`;
  if (!pulses) return [{ boxShadow: rest }, { boxShadow: lit, offset: 0.5 }, { boxShadow: rest }];
  const frames = [{ boxShadow: rest }];
  for (let i = 0; i < pulses; i++)
    frames.push(
      { boxShadow: lit, offset: (i + 0.5) / (pulses + 0.5) },
      { boxShadow: rest, offset: (i + 1) / (pulses + 0.5) },
    );
  return frames.at(-1).offset >= 1 ? frames : [...frames, { boxShadow: rest }];
}

// Plays the reveal on a freshly uncovered card button. Returns a promise that
// settles once every added layer is gone.
export function revealCard(button, options = {}) {
  finishReveal(button.dataset.card);
  const plan = revealPlan(button.dataset.tier, {
    reduced: options.reduced ?? reduceMotion(),
    scares: options.scares ?? scaresEnabled(),
  });
  const color = getComputedStyle(button).getPropertyValue("--tier-color").trim() || "#c8dce6";
  const back = button.querySelector(".card-back");
  const lid = document.createElement("img");
  lid.className = "reveal-lid";
  lid.alt = "";
  lid.src = back?.src || "";
  const layers = [lid];
  button.dataset.revealing = plan.tier;
  button.append(lid);
  const ease = "cubic-bezier(.2,.7,.25,1)";
  const animations = [
    plan.crossfade
      ? lid.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out" })
      : lid.animate(
          [
            { transform: "perspective(700px) rotateX(0deg)", opacity: 1 },
            { transform: "perspective(700px) rotateX(62deg) translateY(-6%)", opacity: 0.85, offset: 0.6 },
            { transform: "perspective(700px) rotateX(88deg) translateY(-16%)", opacity: 0 },
          ],
          { duration: Math.round(plan.ms * 0.6), easing: ease },
        ),
    button.animate(
      [{ opacity: 0 }, { opacity: 1, offset: plan.crossfade ? 0.4 : 0.3 }, { opacity: 1 }],
      { duration: plan.ms, pseudoElement: "::after" },
    ),
  ];
  if (!plan.crossfade) {
    animations.push(
      button.animate(glowFrames(color, plan), { duration: plan.ms, easing: "ease-in-out" }),
    );
    if (plan.lift)
      animations.push(
        button.animate(
          [
            { translate: "0 0", scale: 1 },
            { translate: `0 -${plan.lift}px`, scale: 1 + plan.lift / 400, offset: 0.45 },
            { translate: "0 0", scale: 1 },
          ],
          { duration: plan.ms, easing: ease },
        ),
      );
  }
  if (plan.sheen) {
    const sheen = document.createElement("span");
    sheen.className = "reveal-sheen";
    button.append(sheen);
    layers.push(sheen);
    animations.push(
      sheen.animate([{ translate: "-120% 0" }, { translate: "120% 0" }], {
        duration: Math.round(plan.ms * 0.55),
        delay: Math.round(plan.ms * 0.35),
        easing: "ease-in-out",
      }),
    );
  }
  const control = { button, finish: () => animations.forEach((a) => a.finish()) };
  running.set(button.dataset.card, control);
  const settle = () => {
    for (const animation of animations) animation.cancel();
    for (const layer of layers) layer.remove();
    delete button.dataset.revealing;
    if (running.get(button.dataset.card) === control) running.delete(button.dataset.card);
  };
  return Promise.allSettled(animations.map((a) => a.finished)).then(settle);
}

// A tap during a reveal completes it instead of selecting the card.
export function finishReveal(id) {
  const control = running.get(id);
  if (!control?.button.isConnected) return false;
  control.finish();
  return true;
}

// A newly met card settles into its stack, covered, instead of popping in.
export function arriveCard(button, reduced = reduceMotion()) {
  const frames = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, translate: "0 28px", scale: 0.96 },
        { opacity: 1, translate: "0 -3px", scale: 1, offset: 0.75 },
        { opacity: 1, translate: "0 0", scale: 1 },
      ];
  const animation = button.animate(frames, {
    duration: reduced ? 200 : 460,
    easing: "cubic-bezier(.2,.7,.25,1)",
  });
  return animation.finished.catch(() => {}).then(() => animation.cancel());
}
