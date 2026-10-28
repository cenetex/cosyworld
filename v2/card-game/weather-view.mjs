// Stage scenery and place cards use the same resolved location weather.
export function renderWeather(element, weather) {
  let layer = element.querySelector(":scope > .weather-layer");
  if (!weather) {
    for (const key of [
      "weather",
      "weatherRegion",
      "weatherVariant",
      "exposure",
    ])
      delete element.dataset[key];
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
}
