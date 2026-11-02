// A passkey's credits pay for spoken voices and scene videos (#1924).
// The server holds the balance; this page shows it and asks for clips.
export function createCredits({ fetcher = globalThis.fetch } = {}) {
  let state = { signed_in: false, balance: 0, prices: { tts: 1, video: 100 } };
  const listeners = new Set();
  const publish = () => listeners.forEach((listener) => listener(state));
  async function refresh() {
    try {
      const response = await fetcher("/card-game/credits", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.ok) state = await response.json();
    } catch {
      /* A static table has no credits service. */
    }
    publish();
    return state;
  }
  const affords = (kind) =>
    state.signed_in && state.balance >= (state.prices?.[kind] ?? Infinity);
  return {
    refresh,
    affords,
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    // A voice client for character-speech.mjs: one credit per new line.
    voices: {
      available: () => affords("tts"),
      timeoutMs: 25_000,
      async clip(speaker, text, signal) {
        const response = await fetcher("/card-game/speech", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speaker, text }),
          signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          void refresh();
          throw new Error(body.error || "This voice needs another try.");
        }
        const blob = await response.blob();
        void refresh();
        return blob;
      },
    },
  };
}

export function creditsText(state) {
  if (!state.signed_in)
    return "Sign in with your passkey to use credits for voices and scene videos.";
  const { tts = 1, video = 100 } = state.prices || {};
  return `Credits: ${state.balance}. A spoken line costs ${tts}; a scene video costs ${video}.`;
}

let shared;
export function playerCredits() {
  return (shared ||= createCredits());
}
