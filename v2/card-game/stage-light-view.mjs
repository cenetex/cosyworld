import {
  EASE_MS,
  hourOf,
  isNeutral,
  lightAt,
  lightPath,
  lightStyle,
  nightness,
  tintShade,
} from "./stage-light.mjs";

// Eases the stage's time of day between committed turns. The grade is CSS
// custom properties on the stage (style.css "Time of day").
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const states = new WeakMap();
// The stage shader (weather-view.mjs) follows the eased light each frame.
const listeners = new Set();
export const onStageLight = (listener) => listeners.add(listener);
export const stageLight = (stage) => states.get(stage)?.light;

function apply(stage, light) {
  for (const [name, value] of Object.entries(lightStyle(light)))
    stage.style.setProperty(name, value);
  stage.dataset.hour = String(Math.floor(light.hour));
  stage.dataset.period = light.period;
  stage.dataset.graded = String(!isNeutral(light));
  states.get(stage).light = light;
  for (const listener of listeners) listener(stage, light);
}

// Reuse the lamp prop's rendered bounds, including responsive floor/hand layout.
// No represented lamp means no invented on-screen position or hidden-item leak.
export function portableLampPool(stage) {
  const lamp = [...stage.querySelectorAll('[data-item="lamp"]')].find(
    (el) =>
      el.dataset.lit === "true" &&
      el.dataset.covered !== "true" &&
      el.getBoundingClientRect().width > 0 &&
      !el.closest('[aria-hidden="true"].portrait'),
  );
  const art = stage.querySelector("#backdrop")?.getBoundingClientRect();
  const box = lamp?.getBoundingClientRect();
  if (!art?.width || !art.height || !box?.width || !box.height) return null;
  return {
    x: (100 * (box.left + box.width / 2 - art.left)) / art.width,
    y: (100 * (box.top + box.height / 2 - art.top)) / art.height,
    r: 0.38,
    tint: "lamp",
    on: true,
    portable: true,
  };
}

// turn is the committed world turn; strength is the share of the grade the
// painting takes; pools are the place's lights, each on or off; sky is where
// its stars and moon come out; ease is false on arrival at a new place; tint
// cools the shade as the hour darkens (a place with no night painting).
// Pools glow as the hour darkens.
export function renderStageLight(
  stage,
  {
    turn,
    strength = 1,
    pools = [],
    sky = {},
    ease = true,
    tint = null,
    lamp = false,
  },
) {
  let state = states.get(stage);
  if (!state) {
    states.set(stage, (state = { frame: 0 }));
    state.resize = new ResizeObserver(() => {
      if (state.options)
        renderStageLight(stage, { ...state.options, ease: false });
    });
    state.resize.observe(stage);
  }
  state.options = { turn, strength, pools, sky, ease, tint, lamp };
  const portable = lamp && portableLampPool(stage);
  pools = [...(portable ? [portable] : []), ...pools].slice(0, 4);
  const lit = pools.map((pool) => Number(Boolean(pool.on)));
  const key = JSON.stringify([pools, tint]);
  if (state.turn === turn && state.strength === strength && state.key === key)
    return;
  const shown = state.shown ?? { turn, strength, lit };
  if (!ease || shown.lit.length !== lit.length) shown.lit = lit;
  const motion = ease && !reducedMotion.matches;
  const path = motion
    ? lightPath(shown.turn, turn)
    : { from: turn, to: turn, duration: 0 };
  // A painting or lamp that changes its own light where the turn stays eases.
  if (motion && !path.duration && state.key !== key) path.duration = EASE_MS;
  Object.assign(state, {
    turn,
    strength,
    key,
    path,
    fromStrength: path.duration ? shown.strength : strength,
    fromLit: path.duration ? shown.lit : lit,
    since: performance.now(),
  });
  cancelAnimationFrame(state.frame);
  const step = () => {
    state.frame = 0;
    const progress =
      state.path.duration && !document.hidden
        ? Math.min(1, (performance.now() - state.since) / state.path.duration)
        : 1;
    const t =
      progress < 0.5 ? 2 * progress ** 2 : 1 - (2 - 2 * progress) ** 2 / 2;
    const now = {
      turn: state.path.from + (state.path.to - state.path.from) * t,
      strength: state.fromStrength + (state.strength - state.fromStrength) * t,
      lit: lit.map((on, i) => state.fromLit[i] + (on - state.fromLit[i]) * t),
    };
    state.shown = now;
    const hour = hourOf(now.turn);
    const light = tintShade(lightAt(hour, now.strength), tint, hour);
    light.sky = sky;
    light.pools = pools.map((pool, i) => ({
      ...pool,
      ...(pool.portable ? portableLampPool(stage) : null),
      on:
        now.lit[i] *
        (pool.portable ? Math.max(0.15, nightness(hour)) : nightness(hour)),
    }));
    apply(stage, light);
    if (progress < 1) state.frame = requestAnimationFrame(step);
  };
  step();
}
