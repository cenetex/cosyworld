// Anonymous play counts (#2052). The table counts a fixed set of things it
// does (plays by verb, lines skipped, trips, errors by a coarse code) and
// sends only daily totals: {day, counters}. No account, world, install or
// session id, and no text, ever. Nothing here is read back into play.
//
// On for hosted play unless turned off in Settings or under Global Privacy
// Control; the desktop app opts in. Off, nothing is counted or sent.

// `COUNTERS` in play_metrics.rs; a test keeps the two equal.
export const COUNTERS = new Set(
  `session.start session.end play.accompany play.ask play.attack
  play.choose play.course play.cover play.drop play.give play.guard
  play.intercept play.light play.move play.refuel play.retreat play.ring
  play.sleep play.snuff play.take play.talk play.threaten play.trade
  play.use play.wait play.other quest.accept quest.abandon quest.met
  line.skip line.finish_early scrollback.open voice.line.lt2s
  voice.line.2to5s voice.line.5to10s voice.line.10to20s voice.line.gt20s
  voice.silent voice.failed travel defeat intro.skip intro.wake
  error.network error.timeout error.rules_reject error.storage
  error.script error.other`.split(/\s+/),
);
export const METRICS_KEY = "cosyworld.play-counts";
export const ENDPOINT = "/card-game/metrics";
const FLUSH_MS = 60_000;
const MAX_COUNT = 1000;
const DAY_MS = 86_400_000;

// The counter for a play: quests have their own, Sleep is a kind of Wait.
export function playCounter(action) {
  if (action?.kind === "focus") return "quest.accept";
  if (action?.kind === "drop" && !action.item) return "quest.abandon";
  if (action?.kind === "wait" && action.sleep) return "play.sleep";
  const name = `play.${action?.kind}`;
  return COUNTERS.has(name) ? name : "play.other";
}

// Thinking-to-line latency, in coarse buckets.
export function lineCounter(ms) {
  if (ms < 2000) return "voice.line.lt2s";
  if (ms < 5000) return "voice.line.2to5s";
  if (ms < 10_000) return "voice.line.5to10s";
  if (ms < 20_000) return "voice.line.10to20s";
  return "voice.line.gt20s";
}

export function createMetrics({
  storage = globalThis.localStorage,
  nav = globalThis.navigator,
  desktop = false,
  now = () => Date.now(),
} = {}) {
  let counters = {};
  const choice = () => {
    try {
      return storage?.getItem(METRICS_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const gpc = () => nav?.globalPrivacyControl === true;
  const enabled = () =>
    !gpc() && (desktop ? choice() === "on" : choice() !== "off");
  return {
    gpc,
    enabled,
    setEnabled(on) {
      try {
        storage?.setItem(METRICS_KEY, on ? "on" : "off");
      } catch {}
      if (!enabled()) counters = {};
    },
    count(name) {
      if (!COUNTERS.has(name) || !enabled()) return;
      counters[name] = Math.min((counters[name] || 0) + 1, MAX_COUNT);
    },
    // One beacon per batch; a lost batch is not retried.
    flush() {
      const batch = counters;
      counters = {};
      if (!enabled() || !Object.keys(batch).length) return null;
      const body = JSON.stringify({
        day: Math.floor(now() / DAY_MS),
        counters: batch,
      });
      nav?.sendBeacon?.(ENDPOINT, new Blob([body], { type: "text/plain" }));
      return body;
    },
  };
}

// Until the page starts counting, nothing is counted.
let metrics = { count() {} };
export const count = (name) => metrics.count(name);

// Start counting this page: a session, a flush a minute and on pagehide.
export function startMetrics(button) {
  metrics = createMetrics({
    desktop: !!document.querySelector('meta[name="cosy-local-app"]'),
  });
  metrics.count("session.start");
  setInterval(() => metrics.flush(), FLUSH_MS);
  window.addEventListener("pagehide", () => {
    metrics.count("session.end");
    metrics.flush();
  });
  window.addEventListener("error", () => metrics.count("error.script"));
  window.addEventListener("unhandledrejection", () =>
    metrics.count("error.other"),
  );
  if (!button) return;
  const show = () => {
    const on = metrics.enabled();
    button.setAttribute("aria-pressed", String(on));
    button.disabled = metrics.gpc();
    button.textContent = `Share anonymous play counts: ${
      metrics.gpc() ? "off (Global Privacy Control)" : on ? "on" : "off"
    }`;
  };
  button.addEventListener("click", () => {
    metrics.setEnabled(!metrics.enabled());
    show();
  });
  show();
}
