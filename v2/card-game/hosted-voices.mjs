// Hosted voices: a signed-in passkey hears character lines spoken by the
// server's voice provider, free. In a shared world the server speaks only a
// saved scene line, so every player hears the same clip.
export function createHostedVoices({
  fetcher = globalThis.fetch,
  world = "",
} = {}) {
  let state = { signed_in: false };
  const listeners = new Set();
  const publish = () => listeners.forEach((listener) => listener({ ...state }));
  async function refresh() {
    try {
      const response = await fetcher("/auth/account", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.ok)
        state = { signed_in: Boolean((await response.json()).authenticated) };
    } catch {
      /* A static table has no account service. */
    }
    publish();
    return state;
  }
  return {
    refresh,
    world,
    get state() {
      return { ...state };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
    // A voice client for character-speech.mjs.
    voices: {
      available: () => state.signed_in,
      timeoutMs: 25_000,
      voiceIdentity: world ? `world:${world}` : "openrouter",
      async clip(speaker, text, signal, reference) {
        if (world && (!reference?.play || !Number.isInteger(reference.line)))
          throw new Error("Choose a saved character line from this world.");
        const response = await fetcher("/card-game/speech", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            world
              ? { world, play: reference.play, line: reference.line }
              : { speaker, text },
          ),
          signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "This voice needs another try.");
        }
        return response.blob();
      },
    },
  };
}

let shared;
export function hostedVoices() {
  return (shared ||= createHostedVoices({
    world: new URLSearchParams(globalThis.location?.search).get("world") || "",
  }));
}
