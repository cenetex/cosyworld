// Read-only station transport. The server supplies UTC; only monotonic elapsed
// time advances a listener's clock. Failed media uses the same bounded retry.
export function createRadioStation({
  fetchStation = (signal) =>
    fetch("/card-game/radio", { signal, cache: "no-store" }).then(
      (response) => {
        if (!response.ok) throw new Error("Station unavailable");
        return response.json();
      },
    ),
  now = () => performance.now(),
  changed = () => {},
  failed = () => {},
} = {}) {
  let active = false,
    epoch = 0,
    request,
    timer,
    snapshot,
    received,
    serverTime,
    retry = 1000;
  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(refresh, ms);
  };
  function cancel() {
    epoch++;
    clearTimeout(timer);
    request?.abort();
    request = null;
    snapshot = null;
  }
  function failure() {
    cancel();
    failed();
    if (active) {
      schedule(retry);
      retry = Math.min(30000, retry * 2);
    }
  }
  async function refresh() {
    if (!active || request) return;
    const attempt = epoch,
      began = now(),
      controller = new AbortController();
    request = controller;
    let timeout;
    try {
      const data = await Promise.race([
        fetchStation(controller.signal),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("Station timed out"));
          }, 8000);
        }),
      ]);
      if (attempt !== epoch) return;
      if (
        data.station !== "ratiradio" ||
        !data.version ||
        !/^[a-zA-Z0-9_.-]+$/.test(data.track?.file || "") ||
        ![
          data.serverTimeMs,
          data.startedAtMs,
          data.endsAtMs,
          data.track?.durationMs,
        ].every(Number.isFinite) ||
        data.track.durationMs <= 0 ||
        data.endsAtMs <= data.serverTimeMs ||
        data.serverTimeMs < data.startedAtMs
      )
        throw new Error("Invalid station");
      const retune =
        snapshot &&
        (snapshot.track.file !== data.track.file ||
          snapshot.startedAtMs !== data.startedAtMs ||
          snapshot.version !== data.version);
      snapshot = data;
      received = now();
      serverTime = data.serverTimeMs + (received - began) / 2;
      schedule(Math.max(100, Math.min(15000, data.endsAtMs - serverTime)));
      changed(data, Boolean(retune));
    } catch {
      if (attempt === epoch) failure();
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }
  return {
    setActive(value) {
      cancel();
      active = Boolean(value);
      if (active) void refresh();
    },
    refresh,
    failure,
    succeeded() {
      retry = 1000;
    },
    position: () =>
      snapshot ? serverTime + now() - received - snapshot.startedAtMs : 0,
  };
}
