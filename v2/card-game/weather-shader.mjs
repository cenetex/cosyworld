// The stage shader: one WebGL fragment shader draws location weather and, on
// the stage, the time-of-day grade (stage-light.mjs). The stage animates it;
// place cards reuse cached still frames so the hand never holds a context per
// card. Callers fall back to weather.css when WebGL is unavailable.

const vertex = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fragment = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_rain;
uniform float u_slant;
uniform float u_cloud;
uniform float u_mist;
uniform float u_mistHeight;
uniform vec3 u_mistTint;
uniform float u_dark;
uniform vec3 u_shade;
uniform float u_vignette;
uniform float u_hard;
// Up to four pools stay lit as the room darkens: x, y (0..1), radius (a share
// of the height) and how lit; each with its own tint.
uniform vec4 u_lights[4];
uniform vec3 u_lightTint[4];
// Stars come out in the painting's open sky (x0, y0, x1, y1); the moon is
// x, y and radius.
uniform float u_stars;
uniform vec4 u_starBox;
uniform vec3 u_moon;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
    mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
    f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return v;
}

// One sheet of falling streaks. Columns get their own speed and phase, and
// each cell may hold one drop whose bright head trails a fading tail.
float rainSheet(vec2 q, float density, float stretch, float speed, float seed) {
  float pixel = density / u_resolution.y;
  vec2 p = q * density;
  float column = floor(p.x);
  float r = hash(column * 7.13 + seed);
  float y = p.y / stretch + u_time * speed * (0.75 + 0.5 * r) + r * 31.0;
  float cell = floor(y);
  float r2 = hash(column * 13.7 + cell * 1.31 + seed);
  float f = fract(y);
  float x = fract(p.x) - 0.5 + (r2 - 0.5) * 0.7;
  float width = 0.035 + 0.025 * r;
  float soft = max(width, pixel * 0.9);
  float body = smoothstep(soft, 0.0, abs(x)) * (width / soft);
  float tail = smoothstep(0.0, 0.04, f) * pow(1.0 - f, 2.5);
  return body * tail * step(r2, 0.42);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 st = vec2(uv.x * aspect, uv.y);
  vec3 color = vec3(0.0);
  float alpha = 0.0;

  // Stars and moon sit behind the weather; cloud hides them.
  if (u_stars > 0.0) {
    vec2 inBox = smoothstep(u_starBox.xy, u_starBox.xy + 0.03, uv) *
      smoothstep(u_starBox.zw, u_starBox.zw - 0.03, uv);
    vec2 g = gl_FragCoord.xy / 3.0;
    vec2 id = floor(g);
    float star = step(0.986, hash2(id)) * (0.35 + 0.65 * hash2(id + 1.3)) *
      smoothstep(0.5, 0.1, length(fract(g) - 0.5));
    float d = length((uv - u_moon.xy) * vec2(aspect, 1.0));
    float moon = u_moon.z > 0.0 ? smoothstep(u_moon.z, u_moon.z * 0.7, d) * (0.5 + 0.12 * smoothstep(0.0, u_moon.z, d)) +
      0.22 * exp(-d / (u_moon.z * 2.0)) : 0.0;
    float sky = u_stars * (1.0 - 0.8 * u_cloud);
    float lit = clamp(sky * (star * inBox.x * inBox.y + moon), 0.0, 1.0);
    color = vec3(0.86, 0.9, 1.0) * lit;
    alpha = lit;
  }

  // Cloud shadow drifts slowly across the scene and gathers overhead.
  if (u_cloud > 0.0) {
    float c = fbm(st * 1.4 + vec2(u_time * 0.018, u_time * 0.004));
    float shade = u_cloud * (0.25 + 0.55 * smoothstep(0.35, 0.8, c));
    shade *= mix(0.55, 1.0, smoothstep(0.1, 1.0, uv.y));
    vec3 tone = mix(vec3(0.16, 0.19, 0.27), vec3(0.04, 0.05, 0.09), u_dark);
    color = tone * shade + color * (1.0 - shade);
    alpha = shade + alpha * (1.0 - shade);
  }

  // Rain falls in three parallax sheets, thickened by passing gusts.
  if (u_rain > 0.0) {
    float s = sin(u_slant);
    float co = cos(u_slant);
    vec2 q = mat2(co, s, -s, co) * st;
    float gust = smoothstep(0.25, 0.85,
      fbm(vec2(q.x * 0.9 + u_time * 0.35, q.y * 0.3 + u_time * 0.1)));
    float far = rainSheet(q, 58.0, 4.0, 5.5, 3.1);
    float mid = rainSheet(q + 0.37, 34.0, 4.5, 4.2, 7.9);
    float near = rainSheet(q + 0.71, 17.0, 5.0, 3.1, 1.7);
    float streaks = far * 0.35 + mid * 0.6 + near * 0.95;
    streaks *= u_rain * mix(0.55, 1.15, gust);
    float haze = u_rain * (0.08 + 0.14 * gust) * (1.0 - 0.5 * uv.y);
    vec3 hazeTone = mix(vec3(0.58, 0.64, 0.72), vec3(0.18, 0.22, 0.3), u_dark);
    color = hazeTone * haze + color * (1.0 - haze);
    alpha = haze + alpha * (1.0 - haze);
    // Splashes flicker as flattened rings across the lower ground.
    vec2 g = vec2(st.x * 26.0, uv.y * 70.0);
    vec2 id = floor(g);
    float phase = hash2(id);
    float life = fract(u_time * (1.1 + phase) + phase * 7.0);
    vec2 centre = vec2(0.2 + 0.6 * hash2(id + 3.7), 0.5);
    vec2 d = (fract(g) - centre) * vec2(1.0, 2.6);
    float ring = smoothstep(0.07, 0.0, abs(length(d) - life * 0.42)) * (1.0 - life);
    streaks += ring * step(0.86, phase) * smoothstep(0.32, 0.04, uv.y) * 1.4;
    vec3 dropTone = mix(vec3(0.86, 0.91, 0.96), vec3(0.74, 0.81, 0.92), u_dark);
    float drop = clamp(streaks * mix(0.75, 0.62, u_dark), 0.0, 0.9);
    color = dropTone * drop + color * (1.0 - drop);
    alpha = drop + alpha * (1.0 - drop);
  }

  // Mist banks rise from the ground and fold over themselves as they drift.
  if (u_mist > 0.0) {
    vec2 m = st * vec2(1.3, 2.4);
    vec2 warp = vec2(
      fbm(m + vec2(u_time * 0.03, 0.0)),
      fbm(m + vec2(5.2, 1.3) - vec2(u_time * 0.02, 0.0)));
    float bank = fbm(m + 2.2 * warp + vec2(u_time * 0.045, 0.0));
    float ground = 1.0 - smoothstep(u_mistHeight * 0.25, u_mistHeight, uv.y);
    float wisps = smoothstep(0.55, 0.9, fbm(m * 0.7 + warp - vec2(u_time * 0.06, 0.0)));
    float fog = smoothstep(0.38, 0.82, bank + 0.3 * ground) * ground;
    fog = u_mist * (fog * 0.8 + wisps * 0.18 * (1.0 - uv.y * 0.6));
    fog = clamp(fog, 0.0, 0.72);
    vec3 tone = u_mistTint * mix(1.0, 0.42, u_dark);
    color = tone * fog + color * (1.0 - fog);
    alpha = fog + alpha * (1.0 - fog);
  }

  if (u_hard < 0.5) {
    gl_FragColor = vec4(color, alpha);
    return;
  }
  // On the stage the canvas blends hard-light: below mid grey multiplies,
  // above it screens. The grade (shade, edge vignette) multiplies; weather is
  // laid over it, matched on a mid-tone painting.
  vec2 e = vec2((uv.x - 0.5) / 0.8, (0.55 - uv.y) / 0.75);
  float edge = clamp((length(e) - 0.45) / 0.55, 0.0, 1.0);
  vec3 grade = u_shade * mix(vec3(1.0), vec3(0.04, 0.05, 0.13), u_vignette * edge);
  for (int i = 0; i < 4; i++) {
    vec4 l = u_lights[i];
    float d = length((uv - l.xy) * vec2(aspect, 1.0));
    float pool = l.w * smoothstep(l.z, 0.0, d);
    grade = mix(grade, u_lightTint[i], pool * pool * (3.0 - 2.0 * pool));
  }
  const float mid = 0.42;
  vec3 target = mid * grade * (1.0 - alpha) + color;
  vec3 layer = mix(target / (2.0 * mid),
    0.5 + (target - mid) / (2.0 * (1.0 - mid)), step(mid, target));
  layer += (hash2(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(layer, 1.0);
}
`;

const exposures = {
  coast: { rain: 1, slant: 0.32, mistHeight: 0.75, tint: [0.75, 0.81, 0.86] },
  open: { rain: 0.9, slant: 0.2, mistHeight: 0.6, tint: [0.76, 0.8, 0.84] },
  court: { rain: 0.9, slant: 0.12, mistHeight: 0.5, tint: [0.74, 0.78, 0.84] },
  grove: { rain: 0.5, slant: 0.06, mistHeight: 0.62, tint: [0.74, 0.8, 0.76] },
  shelter: {
    rain: 0.22,
    slant: 0.1,
    mistHeight: 0.3,
    tint: [0.72, 0.77, 0.83],
  },
  // The Willows: a soft drizzle and low, green-grey river mist.
  river: { rain: 0.35, slant: 0.04, mistHeight: 0.62, tint: [0.7, 0.78, 0.74] },
  underground: {
    rain: 0,
    slant: 0,
    mistHeight: 0.42,
    tint: [0.42, 0.55, 0.6],
  },
};

const NEUTRAL = { shade: [1, 1, 1], vignette: 0 };
// weather may be null on the stage, which still draws the hour's grade.
export function weatherUniforms(weather, night, grade = NEUTRAL) {
  const place = exposures[weather?.exposure] || exposures.open;
  const condition = weather?.condition;
  return {
    rain: condition === "rain" ? place.rain : 0,
    slant: place.slant,
    cloud:
      condition === "rain"
        ? 0.75
        : condition === "cloud"
          ? 0.6
          : condition === "mist"
            ? 0.2
            : 0,
    mist:
      condition === "mist"
        ? weather?.exposure === "shelter"
          ? 0.35
          : 0.95
        : condition === "rain"
          ? 0.3
          : condition === "cloud"
            ? 0.12
            : 0,
    mistHeight: place.mistHeight,
    tint: place.tint,
    dark: Number(night),
    shade: grade.shade,
    vignette: grade.vignette,
  };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(shader) || "weather shader failed");
  return shader;
}

export function createWeatherRenderer(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  try {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) || "weather link failed");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const at = (name) => gl.getUniformLocation(program, `u_${name}`);
    const u = Object.fromEntries(
      [
        "resolution",
        "time",
        "rain",
        "slant",
        "cloud",
        "mist",
        "mistHeight",
        "mistTint",
        "dark",
        "shade",
        "vignette",
        "hard",
        "lights",
        "lightTint",
        "stars",
        "starBox",
        "moon",
      ].map((name) => [name, at(name)]),
    );
    return {
      canvas,
      release() {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      },
      draw(uniforms, time, hard = false) {
        if (gl.isContextLost()) return false;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(u.resolution, canvas.width, canvas.height);
        gl.uniform1f(u.time, time);
        gl.uniform1f(u.rain, uniforms.rain);
        gl.uniform1f(u.slant, uniforms.slant);
        gl.uniform1f(u.cloud, uniforms.cloud);
        gl.uniform1f(u.mist, uniforms.mist);
        gl.uniform1f(u.mistHeight, uniforms.mistHeight);
        gl.uniform3fv(u.mistTint, uniforms.tint);
        gl.uniform1f(u.dark, uniforms.dark);
        gl.uniform3fv(u.shade, uniforms.shade);
        gl.uniform1f(u.vignette, uniforms.vignette);
        gl.uniform1f(u.hard, hard ? 1 : 0);
        const pools = [0, 1, 2, 3].map((i) => uniforms.lights?.[i]);
        gl.uniform4fv(
          u.lights,
          pools.flatMap((l) => l?.at ?? [0, 0, 0, 0]),
        );
        gl.uniform3fv(
          u.lightTint,
          pools.flatMap((l) => l?.tint ?? [1, 1, 1]),
        );
        gl.uniform1f(u.stars, uniforms.stars ?? 0);
        gl.uniform4fv(u.starBox, uniforms.starBox ?? [0, 0, 0, 0]);
        gl.uniform3fv(u.moon, uniforms.moon ?? [0, 0, 0]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return true;
      },
    };
  } catch (error) {
    console.warn(error);
    return null;
  }
}

// Card frames are stills, so one small canvas paints and caches each look.
const stills = new Map();
let stillRenderer;
export function weatherStill(weather, night) {
  const key = `${weather.variant}:${night ? "night" : "day"}`;
  if (stills.has(key)) return stills.get(key);
  if (stillRenderer === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 320;
    stillRenderer = createWeatherRenderer(canvas);
  }
  const url =
    stillRenderer?.draw(weatherUniforms(weather, night), 17.3) &&
    stillRenderer.canvas.toDataURL("image/png");
  stills.set(key, url || null);
  return url || null;
}
