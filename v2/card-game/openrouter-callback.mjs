const original = location.href;
const url = new URL(original);
const state = url.searchParams.get("state");
const callback =
  url.searchParams.get("openrouter") === "callback" ||
  url.searchParams.has("code") ||
  url.searchParams.has("error");
const status = document.getElementById("connection-status");
if (!callback) {
  const next = document.getElementById("connection-continue");
  window.addEventListener("message", (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== window.opener ||
      event.data?.type !== "cosy-openrouter-start"
    )
      return;
    try {
      const auth = new URL(event.data.url);
      const target = new URL(auth.searchParams.get("callback_url"));
      if (
        auth.origin !== "https://openrouter.ai" ||
        auth.pathname !== "/auth" ||
        target.origin !== location.origin ||
        target.pathname !== location.pathname
      )
        return;
      next.href = auth.href;
      next.hidden = false;
      status.textContent =
        "Opening OpenRouter. You can also use Continue to OpenRouter below.";
      location.assign(auth.href);
    } catch {
      status.textContent =
        "Return to your game tab and start a fresh OpenRouter connection.";
    }
  });
  window.opener?.postMessage(
    { type: "cosy-openrouter-ready" },
    location.origin,
  );
  setTimeout(() => {
    if (next.hidden)
      status.textContent =
        "Return to your game tab and choose Connect OpenRouter again.";
  }, 15_000);
} else {
  for (const key of [
    "code",
    "state",
    "error",
    "error_description",
    "openrouter",
  ])
    url.searchParams.delete(key);
  history.replaceState(null, "", url.href);
  if (!state) {
    status.textContent =
      "Return to your game tab and start a fresh OpenRouter connection.";
  } else {
    let done = false;
    status.textContent = "Connecting to the game tab…";
    const channel =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel(`cosy-openrouter-${state}`)
        : null;
    const connected = () => {
      done = true;
      status.textContent = "Connected. Return to your game tab.";
      channel?.close();
      window.close();
    };
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.type === "connected") connected();
        if (event.data?.type === "error")
          status.textContent = event.data.message;
      };
      channel.postMessage({ type: "callback", url: original });
    }
    window.addEventListener("message", (event) => {
      if (
        event.origin === location.origin &&
        event.source === window.opener &&
        event.data?.type === "cosy-openrouter-connected"
      )
        connected();
    });
    window.opener?.postMessage(
      { type: "cosy-openrouter-callback", url: original },
      location.origin,
    );
    setTimeout(() => {
      if (!done)
        status.textContent =
          "Return to your game tab to finish the connection. You can start a fresh connection there.";
    }, 30_000);
  }
}
