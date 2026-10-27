import { playerOpenRouter } from "./openrouter.mjs";

let stop = () => {};
export const cancelOpenRouterConnection = () => stop();
export function connectOpenRouter(report = () => {}) {
  stop();
  // Open during the click so browsers can keep this as a sign-in window.
  const popup = window.open(
    "/card-game/openrouter-callback.html",
    "_blank",
    "popup,width=560,height=720",
  );
  const client = playerOpenRouter();
  let channel,
    timeout,
    authUrl,
    ready = false,
    active = true,
    processing = false;
  const cleanup = () => {
    active = false;
    clearTimeout(timeout);
    channel?.close();
    window.removeEventListener("message", receiveWindow);
  };
  const closePopup = () => {
    try {
      popup?.close();
    } catch {
      /* The return window can close itself. */
    }
  };
  stop = () => {
    cleanup();
    closePopup();
  };
  async function receive(url) {
    if (!active || processing) return;
    processing = true;
    try {
      if (await client.finish(url, () => {}, { accept: () => active })) {
        channel?.postMessage({ type: "connected" });
        try {
          popup?.postMessage(
            { type: "cosy-openrouter-connected" },
            location.origin,
          );
        } catch {
          /* The channel carries the same acknowledgement. */
        }
        report("OpenRouter connected. Your game is ready.");
        document.dispatchEvent(new Event("openrouter-change"));
        cleanup();
        closePopup();
      }
      processing = false;
    } catch (error) {
      if (active) {
        channel?.postMessage({ type: "error", message: error.message });
        report(error.message);
      }
      cleanup();
    }
  }
  function receiveWindow(event) {
    if (event.origin !== location.origin || event.source !== popup) return;
    if (event.data?.type === "cosy-openrouter-ready") {
      ready = true;
      start();
    }
    if (event.data?.type === "cosy-openrouter-callback")
      void receive(event.data.url);
  }
  function start() {
    if (!active || !ready || !authUrl) return;
    // The loaded sign-in page owns its navigation, including Safari windows.
    popup.postMessage(
      { type: "cosy-openrouter-start", url: authUrl },
      location.origin,
    );
  }
  window.addEventListener("message", receiveWindow);
  report("Opening your OpenRouter sign-in window…");
  void client
    .begin(location.href, { popup: Boolean(popup), accept: () => active })
    .then((url) => {
      if (!active) return;
      if (!popup) {
        location.assign(url);
        return;
      }
      const state = new URL(url).searchParams.get("state");
      if (typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(`cosy-openrouter-${state}`);
        channel.onmessage = (event) => {
          if (event.data?.type === "callback") void receive(event.data.url);
        };
      }
      timeout = setTimeout(() => {
        cleanup();
        report("Start a fresh OpenRouter connection when you are ready.");
      }, 600_000);
      authUrl = url;
      start();
      report(
        "Approve the connection in OpenRouter. Your game stays open here.",
      );
    })
    .catch(() => {
      cleanup();
      closePopup();
      report("Allow session storage for this site, then connect again.");
    });
}
