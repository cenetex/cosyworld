const original = location.href;
const url = new URL(original);
const state = url.searchParams.get("state");
const callback = url.searchParams.get("openrouter") === "callback";
for (const key of ["code", "state", "error", "error_description", "openrouter"])
  url.searchParams.delete(key);
history.replaceState(null, "", url.href);
if (callback && state) {
  const status = document.getElementById("connection-status");
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
      if (event.data?.type === "error") status.textContent = event.data.message;
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
