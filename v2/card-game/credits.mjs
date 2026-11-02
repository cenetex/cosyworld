// A passkey's credits pay for spoken voices and scene videos (#1924).
// The server holds the balance; this page shows it and asks for clips.
// In a shared world the world's pool pays, and any passkey may commit
// credits to it.
export function createCredits({ fetcher = globalThis.fetch, world = "" } = {}) {
  let state = { signed_in: false, balance: 0, prices: { tts: 1, video: 100 } };
  let pool = null;
  const listeners = new Set();
  const publish = () =>
    listeners.forEach((listener) => listener({ ...state, pool }));
  async function refresh() {
    try {
      const response = await fetcher("/card-game/credits", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.ok) state = await response.json();
      if (world) {
        const shared = await fetcher(
          `/card-game/credits/pool?world=${encodeURIComponent(world)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (shared.ok) pool = await shared.json();
      }
    } catch {
      /* A static table has no credits service. */
    }
    publish();
    return state;
  }
  const price = (kind) => state.prices?.[kind] ?? Infinity;
  const affords = (kind) =>
    state.signed_in &&
    (world ? (pool?.pool ?? 0) : state.balance) >= price(kind);
  return {
    refresh,
    affords,
    world,
    get state() {
      return { ...state, pool };
    },
    // Move credits from this passkey into the world's pool; never undone.
    async commit(credits) {
      const response = await fetcher("/card-game/credits/commit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          world,
          credits,
          request_id: `commit-${globalThis.crypto.randomUUID()}`,
        }),
      });
      const body = await response.json().catch(() => ({}));
      await refresh();
      if (!response.ok)
        throw new Error(body.error || "The commit needs another try.");
      return body;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state, pool });
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
          body: JSON.stringify(
            world ? { speaker, text, world } : { speaker, text },
          ),
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

// The world's pool and who filled it, most first.
export function poolText(pool) {
  if (!pool) return "";
  const names = pool.contributors
    .map(({ name, credits }) => `${name || "A traveler"} ${credits}`)
    .join(", ");
  return `This world's pool: ${pool.pool} credits.${names ? ` From ${names}.` : " Nobody has committed credits yet."}`;
}

let shared;
export function playerCredits() {
  return (shared ||= createCredits({
    world: new URLSearchParams(globalThis.location?.search).get("world") || "",
  }));
}

// A shared world's pool in Settings: its credits, who filled it, and a
// commit the action beat confirms, since a commit is never taken back.
export function installCreditPool({ actionBeat, closeSettings }) {
  const credits = playerCredits();
  const section = document.getElementById("credit-pool");
  const status = document.getElementById("credit-pool-status");
  section.hidden = !credits.world;
  if (!credits.world) return;
  credits.subscribe((state) => {
    status.textContent = state.signed_in
      ? poolText(state.pool)
      : `${poolText(state.pool)} Sign in with your passkey to commit credits.`;
    for (const button of section.querySelectorAll("[data-commit]"))
      button.disabled =
        !state.signed_in || state.balance < Number(button.dataset.commit);
  });
  const notice = (text) => {
    const beat = {
      images: [],
      text,
      buttons: [
        {
          label: "OK",
          id: "credit-commit-done",
          run: () => actionBeat.clear(beat),
        },
      ],
    };
    actionBeat.show(beat);
  };
  section.addEventListener("click", (event) => {
    const amount = Number(
      event.target.closest("[data-commit]")?.dataset.commit,
    );
    if (!amount) return;
    closeSettings();
    const beat = {
      images: [],
      text: `Commit ${amount} credits to this world?`,
      note: "Everyone here hears its voices from the pool. A commit can't be taken back.",
      buttons: [
        {
          label: `Commit ${amount}`,
          id: "credit-commit-confirm",
          run: async () => {
            actionBeat.clear(beat);
            try {
              const { pool } = await credits.commit(amount);
              notice(
                `Committed ${amount}. This world's pool holds ${pool} credits.`,
              );
            } catch (error) {
              notice(error.message);
            }
          },
        },
        {
          label: "Not now",
          id: "credit-commit-cancel",
          run: () => actionBeat.clear(beat),
        },
      ],
    };
    actionBeat.show(beat);
  });
}
