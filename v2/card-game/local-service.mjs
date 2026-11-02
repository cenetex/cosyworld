let runtime = null;

export function localRuntime() {
  return runtime;
}

export async function setupLocalService({ fetcher = globalThis.fetch } = {}) {
  // A server marker keeps ordinary hosted pages on their existing path.
  if (!document.querySelector('meta[name="cosy-local-app"]')) return false;
  const response = await fetcher("/card-game/local");
  if (!response.ok) throw new Error("The local app needs a restart.");
  const value = await response.json();
  if (value.schema !== 1) throw new Error("The local app needs an update.");
  runtime = value;
  document.body.classList.add("local-app");
  const brand = document.getElementById("scene-video-button");
  if (brand) {
    brand.disabled = true;
    brand.title = "CosyWorld";
    brand.setAttribute("aria-label", "CosyWorld");
    brand.querySelector("svg")?.remove();
  }
  const status = document.getElementById("local-model-status");
  if (status)
    status.textContent = `Dialogue: ${value.dialogueModel}. Voices: Chatterbox ${value.voiceModel}.`;
  return true;
}

export function localVoiceClient() {
  if (!runtime) return null;
  return {
    available: () => true,
    timeoutMs: runtime.voiceTimeoutMs,
    voiceIdentity: [runtime.voiceModel, runtime.voiceRevision],
    async clip(speaker, text, signal) {
      const response = await fetch("/card-game/local/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker, text }),
        signal,
      });
      if (!response.ok) throw new Error("The local voice needs another try.");
      return response.blob();
    },
  };
}
