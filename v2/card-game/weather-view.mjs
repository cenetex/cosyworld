import {
  createWeatherRenderer,
  weatherStill,
  weatherUniforms,
} from "./weather-shader.mjs";
import { blendUniforms, WEATHER_EASE_MS } from "./transitions.mjs";

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

// The stage keeps one animated canvas; it stops when weather leaves, the sky
// clears and any change has eased in, or the tab hides, and holds a single
// frame for reduced motion.
function animate(layer, uniforms, ease) {
  let state = live.get(layer);
  if (!state) {
    const canvas = document.createElement("canvas");
    const renderer = createWeatherRenderer(canvas);
    if (!renderer) return;
    state = { renderer, frame: 0, start: performance.now(), since: 0 };
    const draw = () => {
      state.frame = 0;
      if (!layer.isConnected || document.hidden) return;
      const now = performance.now();
      const time = reducedMotion.matches ? 17.3 : (now - state.start) / 1000;
      const progress = reducedMotion.matches
        ? 1
        : (now - state.since) / WEATHER_EASE_MS;
      const uniforms = blendUniforms(state.from, state.uniforms, progress);
      state.shown = uniforms;
      if (!renderer.draw(uniforms, time)) {
        delete layer.dataset.shader;
        return;
      }
      const { rain, cloud, mist } = uniforms;
      if (!reducedMotion.matches && (progress < 1 || rain + cloud + mist > 0))
        state.frame = requestAnimationFrame(draw);
    };
    state.draw = draw;
    state.resize = new ResizeObserver(() => {
      const scale = Math.min(devicePixelRatio || 1, 1);
      canvas.width = Math.max(1, Math.round(layer.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(layer.clientHeight * scale));
      if (!state.frame) draw();
    });
    state.resize.observe(layer);
    canvas.addEventListener("webglcontextlost", () => {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      delete layer.dataset.shader;
    });
    layer.append(canvas);
    live.set(layer, state);
  }
  // A change of weather or light eases from what is on screen now.
  if (!ease) state.from = null;
  else if (JSON.stringify(state.uniforms) !== JSON.stringify(uniforms)) {
    state.from = state.shown || state.uniforms;
    state.since = performance.now();
  }
  state.uniforms = uniforms;
  layer.dataset.shader = "webgl";
  if (!state.frame) state.draw();
}

// Stage scenery and place cards use the same resolved location weather.
// Set the element's data-time-of-day first so night tones apply. A change at
// the same place eases in; a new place starts on its own sky.
export function renderWeather(element, weather, { ease = false } = {}) {
  let layer = element.querySelector(":scope > .weather-layer");
  if (!weather) {
    for (const key of [
      "weather",
      "weatherRegion",
      "weatherVariant",
      "exposure",
    ])
      delete element.dataset[key];
    const state = live.get(layer);
    if (state) {
      cancelAnimationFrame(state.frame);
      state.resize.disconnect();
      state.renderer.release();
      live.delete(layer);
    }
    layer?.remove();
    return;
  }
  element.dataset.weather = weather.condition;
  element.dataset.weatherRegion = weather.region;
  element.dataset.weatherVariant = weather.variant;
  element.dataset.exposure = weather.exposure;
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "weather-layer";
    layer.setAttribute("aria-hidden", "true");
    element.append(layer);
  }
  const night = element.dataset.timeOfDay === "night";
  if (element.classList.contains("stage")) {
    animate(layer, weatherUniforms(weather, night), ease);
    return;
  }
  const still = weatherStill(weather, night);
  if (still) {
    layer.dataset.shader = "webgl";
    layer.style.backgroundImage = `url("${still}")`;
  } else {
    delete layer.dataset.shader;
    layer.style.removeProperty("background-image");
  }
}
