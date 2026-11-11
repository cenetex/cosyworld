import { scaresEnabled } from "./transitions.mjs";
import { tellGlow, turnPlan } from "./pack-opening.mjs";
import { tiers as levelTiers } from "./level-tiers.mjs";

// A covered card opens when the player first taps it. Richer level tiers
// get a longer, warmer reveal; every reveal stays under a second, glows at
// most twice (under three flashes a second) and leaves no lasting animation
// or 3D context behind, so the card and the dialogue keep taking clicks.
// A rarer card also holds a breath before its lid moves (`hold`, from
// pack-opening.mjs turnPlan), the glow building through it; a common card
// turns at once.
const tiers = {
  common: { ms: 520, pulses: 0, lift: 0, sheen: false, glow: 10 },
  uncommon: { ms: 620, pulses: 1, lift: 6, sheen: false, glow: 16 },
  rare: { ms: 720, pulses: 1, lift: 9, sheen: true, glow: 20 },
  epic: { ms: 820, pulses: 2, lift: 12, sheen: true, glow: 24 },
  legendary: { ms: 900, pulses: 2, lift: 16, sheen: true, glow: 30 },
  mythic: { ms: 980, pulses: 2, lift: 18, sheen: true, glow: 34 },
};
export const REVEAL_TIERS = Object.keys(tiers);

// Reduced motion crossfades the lid and shows the label without movement.
// With flashes off, the glow stays soft and steady and the sheen is skipped.
export function revealPlan(tier, { reduced = false, scares = true } = {}) {
  const base = tiers[tier] || tiers.common;
  const hold = turnPlan(tier, { reduced }).hold;
  if (reduced)
    return { tier, ms: 600, hold, crossfade: true, pulses: 0, lift: 0, sheen: false, glow: 0 };
  return {
    tier,
    ms: base.ms,
    hold,
    crossfade: false,
    pulses: scares ? base.pulses : Math.min(base.pulses, 1),
    lift: base.lift,
    sheen: scares && base.sheen,
    glow: scares ? base.glow : Math.min(base.glow, 12),
  };
}
export const flashRate = (plan) => plan.pulses / (plan.ms / 1000);
// The whole turn, hold included.
export const revealMs = (plan) => plan.hold + plan.ms;

const reduceMotion = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const running = new Map();

function glowFrames(color, { pulses, glow, hold = 0, ms }) {
  const rest = "0 6px 20px #0006";
  const lit = `0 0 0 1px ${color}cc, 0 0 ${glow}px ${color}88, 0 6px 20px #0006`;
  // The pulses run over the turn itself; a hold in front of it builds the
  // glow up from rest to lit, so the wait is the anticipation. The frames
  // span hold + turn.
  const share = hold ? hold / (hold + ms) : 0,
    at = (offset) => share + offset * (1 - share);
  const frames = [{ boxShadow: rest }];
  if (hold) frames.push({ boxShadow: lit, offset: share });
  if (!pulses) {
    frames.push({ boxShadow: lit, offset: at(hold ? 0.15 : 0.5) }, { boxShadow: rest });
    return frames;
  }
  for (let i = 0; i < pulses; i++)
    frames.push(
      { boxShadow: lit, offset: at((i + 0.5) / (pulses + 0.5)) },
      { boxShadow: rest, offset: at((i + 1) / (pulses + 0.5)) },
    );
  return frames.at(-1).offset >= 1 ? frames : [...frames, { boxShadow: rest }];
}

// Plays the reveal on a freshly uncovered card button. Returns a promise that
// settles once every added layer is gone.
export function revealCard(button, options = {}) {
  // A quest card has no card id; its quest key names its turn.
  const id = button.dataset.card ?? button.dataset.questKey;
  finishCardReveal(id);
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
          { duration: Math.round(plan.ms * 0.6), delay: plan.hold, easing: ease, fill: "backwards" },
        ),
    button.animate(
      [{ opacity: 0 }, { opacity: 1, offset: plan.crossfade ? 0.4 : 0.3 }, { opacity: 1 }],
      { duration: plan.ms, delay: plan.hold, fill: "backwards", pseudoElement: "::after" },
    ),
  ];
  if (!plan.crossfade) {
    animations.push(
      button.animate(glowFrames(color, plan), { duration: revealMs(plan), easing: "ease-in-out" }),
    );
    if (plan.lift)
      animations.push(
        button.animate(
          [
            { translate: "0 0", scale: 1 },
            { translate: `0 -${plan.lift}px`, scale: 1 + plan.lift / 400, offset: 0.45 },
            { translate: "0 0", scale: 1 },
          ],
          { duration: plan.ms, delay: plan.hold, easing: ease, fill: "backwards" },
        ),
      );
  }
  // A place opens from the upright lid to its wider card as the lid lifts.
  const frame = button.closest(".card-frame");
  if (!plan.crossfade && frame && button.classList.contains("location")) {
    const to = frame.offsetWidth,
      from = Math.round((frame.offsetHeight * 2) / 3);
    if (to - from > 1)
      animations.push(
        frame.animate(
          [
            { width: `${from}px`, flexBasis: `${from}px` },
            { width: `${to}px`, flexBasis: `${to}px` },
          ],
          { duration: Math.round(plan.ms * 0.5), delay: plan.hold, easing: ease, fill: "backwards" },
        ),
      );
  }
  if (plan.sheen) {
    const sheen = document.createElement("span");
    sheen.className = "reveal-sheen";
    button.append(sheen);
    layers.push(sheen);
    animations.push(
      sheen.animate([{ translate: "-120% 0", opacity: 1 }, { translate: "120% 0", opacity: 1 }], {
        duration: Math.round(plan.ms * 0.55),
        delay: plan.hold + Math.round(plan.ms * 0.35),
        easing: "ease-in-out",
        fill: "backwards",
      }),
    );
  }
  const control = { button, finish: () => animations.forEach((a) => a.finish()) };
  running.set(id, control);
  const settle = () => {
    for (const animation of animations) animation.cancel();
    for (const layer of layers) layer.remove();
    delete button.dataset.revealing;
    if (running.get(id) === control) running.delete(id);
  };
  return Promise.allSettled(animations.map((a) => a.finished)).then(settle);
}

// A tap during a reveal completes it instead of selecting the card.
export function finishCardReveal(id) {
  const control = running.get(id);
  if (!control?.button.isConnected) return false;
  control.finish();
  return true;
}

// A face-down card in an open pack with a tell: its tier's colour as a rim
// glow and nothing else (no number, name or art). The rim is a steady
// shadow; the slow pulse is the card's opacity breathing, so only opacity
// moves. Under reduced motion the rim holds still. Found again by its
// animation id after every redraw, never kept by element.
const TELL_ID = "pack-tell";
const tellColor = (tier) =>
  levelTiers.find((entry) => entry.id === tier)?.color ?? "#c8dce6";
export function tellCard(button, tier, reduced = reduceMotion()) {
  if (
    button.getAnimations().some((a) => a.id === TELL_ID && a.effect.tier === tier)
  )
    return;
  clearTell(button);
  const color = tellColor(tier),
    glow = tellGlow(tier) ?? 14,
    rim = `0 0 0 2px ${color}dd, 0 0 ${glow}px ${glow / 4}px ${color}aa, 0 6px 20px #0006`,
    held = button.animate([{ boxShadow: rim }, { boxShadow: rim }], {
      duration: 1000,
      iterations: Infinity,
    });
  held.id = TELL_ID;
  held.effect.tier = tier;
  if (reduced) return;
  const breath = button.animate([{ opacity: 0.8 }, { opacity: 1 }], {
    duration: 2400,
    iterations: Infinity,
    direction: "alternate",
    easing: "ease-in-out",
  });
  breath.id = TELL_ID;
}
export function clearTell(button) {
  for (const animation of button.getAnimations())
    if (animation.id === TELL_ID) animation.cancel();
}
