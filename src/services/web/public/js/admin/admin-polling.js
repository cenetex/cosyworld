// admin-polling.js: simple abortable polling utility
export function createPoller(fn, { interval = 1000, immediate = true, signal } = {}) {
  let timer = null;
  let stopped = false;
  async function tick() {
    if (stopped) return;
    try { await fn(); } catch (e) { /* swallow; handler decides */ }
    if (!stopped) timer = setTimeout(tick, interval);
  }
  if (immediate) tick(); else timer = setTimeout(tick, interval);
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); };
  if (signal) {
    if (signal.aborted) stop();
    signal.addEventListener('abort', stop, { once: true });
  }
  return { stop };
}
