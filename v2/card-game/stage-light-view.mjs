import {
  EASE_MS,
  hourOf,
  isNeutral,
  lightAt,
  lightPath,
  lightStyle,
} from "./stage-light.mjs";

// Eases the stage's time of day between committed turns. The grade is CSS
// custom properties on the stage (style.css "Time of day").
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const states = new WeakMap();

function apply(stage, light) {
  for (const [name, value] of Object.entries(lightStyle(light)))
    stage.style.setProperty(name, value);
  stage.dataset.hour = String(Math.floor(light.hour));
  stage.dataset.period = light.period;
  stage.dataset.graded = String(!isNeutral(light));
}

// turn is the committed world turn; strength is the share of the grade the
// painting takes; ease is false on arrival at a new place.
export function renderStageLight(stage, { turn, strength = 1, ease = true }) {
  let state = states.get(stage);
  if (!state) states.set(stage, (state = { frame: 0 }));
  if (state.turn === turn && state.strength === strength) return;
  const shown = state.shown ?? { turn, strength };
  const motion = ease && !reducedMotion.matches;
  const path = motion
    ? lightPath(shown.turn, turn)
    : { from: turn, to: turn, duration: 0 };
  // A painting that changes its own light where the turn stays eases too.
  if (motion && !path.duration && shown.strength !== strength)
    path.duration = EASE_MS;
  Object.assign(state, {
    turn,
    strength,
    path,
    fromStrength: path.duration ? shown.strength : strength,
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
    };
    state.shown = now;
    apply(stage, lightAt(hourOf(now.turn), now.strength));
    if (progress < 1) state.frame = requestAnimationFrame(step);
  };
  step();
}
