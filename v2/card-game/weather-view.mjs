import {
  createWeatherRenderer,
  weatherStill,
  weatherUniforms,
} from "./weather-shader.mjs";
import { blendUniforms, WEATHER_EASE_MS } from "./transitions.mjs";
import { onStageLight, stageLight } from "./stage-light-view.mjs";
import { isNeutral, LIGHT_TINTS, nightness } from "./stage-light.mjs";

const live = new Map();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function wake() {
  for (const state of live.values()) {
    cancelAnimationFrame(state.frame);
    state.draw();
  }
}
document.addEventListener("visibilitychange", wake);
reducedMotion.addEventListener("change", wake);

// Pools sit on the painting, so they follow its frame on the stage.
function pools(stage, light) {
  const art = stage.querySelector(".stage-figures")?.getBoundingClientRect();
  const box = stage.getBoundingClientRect();
  if (!art?.height || !box.height) return [];
  return (light?.pools || []).map((pool) => ({
    at: [
      (art.left - box.left + (art.width * pool.x) / 100) / box.width,
      1 - (art.top - box.top + (art.height * pool.y) / 100) / box.height,
      (art.height * pool.r) / box.height,
      pool.on,
    ],
    tint: LIGHT_TINTS[pool.tint] || LIGHT_TINTS.lamp,
  }));
}
// The time of day eases on its own clock; each eased frame redraws.
onStageLight((stage) => {
  const state = live.get(stage.querySelector(":scope > .weather-layer"));
  if (state && !state.frame) state.draw();
});

// The stage keeps one canvas, present with clear skies too, for weather and
// the hour's grade. It animates only while weather falls or a change eases
// in, draws one frame otherwise, hides when there is nothing to draw and
// stops for hidden tabs. Clear skies draw at half resolution. Reduced motion
// holds a single frame.
function animate(layer, weather, ease) {
  const stage = layer.parentElement;
  let state = live.get(layer);
  if (!state) {
    const canvas = document.createElement("canvas");
    const renderer = createWeatherRenderer(canvas);
    if (!renderer) return;
    state = { renderer, frame: 0, start: performance.now(), since: 0 };
    const resize = () => {
      const scale = state.weather ? Math.min(devicePixelRatio || 1, 1) : 0.5;
      canvas.width = Math.max(1, Math.round(layer.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(layer.clientHeight * scale));
    };
    const draw = () => {
      state.frame = 0;
      if (!layer.isConnected || document.hidden) return;
      const light = stageLight(stage);
      const idle = !state.weather && (!light || isNeutral(light));
      canvas.style.visibility = idle ? "hidden" : "";
      if (idle) return;
      if (state.scaled !== Boolean(state.weather)) {
        state.scaled = Boolean(state.weather);
        resize();
      }
      const now = performance.now();
      const time = reducedMotion.matches ? 17.3 : (now - state.start) / 1000;
      const progress = reducedMotion.matches
        ? 1
        : (now - state.since) / WEATHER_EASE_MS;
      const uniforms = {
        ...blendUniforms(state.from, state.uniforms, progress),
        dark: light ? nightness(light.hour) : 0,
        lights: pools(stage, light),
        shade: light?.shade ?? [1, 1, 1],
        vignette: light?.vignette ?? 0,
      };
      state.shown = uniforms;
      if (!renderer.draw(uniforms, time, true)) return lost();
      const { rain, cloud, mist } = uniforms;
      if (!reducedMotion.matches && (progress < 1 || rain + cloud + mist > 0))
        state.frame = requestAnimationFrame(draw);
    };
    state.draw = draw;
    state.resize = new ResizeObserver(() => {
      resize();
      if (!state.frame) draw();
    });
    state.resize.observe(layer);
    // A lost context falls back to the CSS grade and weather.css.
    const lost = () => {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      delete layer.dataset.shader;
      delete stage.dataset.stageShader;
    };
    canvas.addEventListener("webglcontextlost", lost);
    layer.append(canvas);
    live.set(layer, state);
  }
  // A change of weather eases from what is on screen now.
  const uniforms = weatherUniforms(weather, 0);
  if (!ease) state.from = null;
  else if (JSON.stringify(state.uniforms) !== JSON.stringify(uniforms)) {
    state.from = state.shown || state.uniforms;
    state.since = performance.now();
  }
  state.uniforms = uniforms;
  state.weather = weather;
  layer.dataset.shader = "webgl";
  stage.dataset.stageShader = "webgl";
  if (!state.frame) state.draw();
}

// Stage scenery and place cards use the same resolved location weather.
// Set the element's data-time-of-day first so night tones apply on cards. A
// change at the same place eases in; a new place starts on its own sky.
export function renderWeather(element, weather, { ease = false } = {}) {
  let layer = element.querySelector(":scope > .weather-layer");
  const stage = element.classList.contains("stage");
  for (const [key, value] of [
    ["weather", weather?.condition],
    ["weatherRegion", weather?.region],
    ["weatherVariant", weather?.variant],
    ["exposure", weather?.exposure],
  ])
    if (value) element.dataset[key] = value;
    else delete element.dataset[key];
  if (!weather && !stage) {
    layer?.remove();
    return;
  }
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "weather-layer";
    layer.setAttribute("aria-hidden", "true");
    element.append(layer);
  }
  if (stage) {
    animate(layer, weather, ease);
    return;
  }
  const night = element.dataset.timeOfDay === "night";
  const still = weatherStill(weather, night);
  if (still) {
    layer.dataset.shader = "webgl";
    layer.style.backgroundImage = `url("${still}")`;
  } else {
    delete layer.dataset.shader;
    layer.style.removeProperty("background-image");
  }
}
