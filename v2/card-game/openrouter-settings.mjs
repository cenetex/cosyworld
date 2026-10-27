import { playerOpenRouter } from "./openrouter.mjs";

export async function setupOpenRouter() {
  const client = playerOpenRouter();
  const $ = (id) => document.getElementById(id);
  const status = $("openrouter-status");
  let controller, mediaUrl;
  function refresh(message) {
    const connected = Boolean(client.connection()?.key);
    $("openrouter-connect").textContent = connected
      ? "Reconnect OpenRouter"
      : "Connect OpenRouter";
    $("openrouter-disconnect").hidden = !connected;
    $("openrouter-options").hidden = !connected;
    $("openrouter-chat").checked = Boolean(client.connection()?.chat);
    status.textContent =
      message ||
      (connected
        ? "Connected for this tab. Your OpenRouter credits pay for your requests."
        : "Connect your account for character chat, audio, and video.");
  }
  function clearMedia() {
    controller?.abort();
    for (const id of ["openrouter-audio", "openrouter-video"]) {
      $(id).pause();
      $(id).removeAttribute("src");
      $(id).load();
      $(id).hidden = true;
    }
    $("openrouter-download").hidden = true;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = null;
  }
  async function models() {
    const results = await Promise.allSettled([
      client.request("models?output_modalities=speech"),
      client.request("videos/models"),
    ]);
    for (const [i, result] of results.entries()) {
      if (result.status !== "fulfilled") continue;
      const list = $(
        i === 0 ? "openrouter-audio-models" : "openrouter-video-models",
      );
      list.replaceChildren();
      for (const model of result.value.data || []) {
        const option = document.createElement("option");
        option.value = model.id;
        option.label = model.name || model.id;
        list.append(option);
      }
    }
  }
  $("openrouter-connect").onclick = async () => {
    try {
      $("openrouter-connect").disabled = true;
      location.assign(await client.begin(location.href));
    } catch {
      refresh("Allow session storage in this browser, then connect again.");
      $("openrouter-connect").disabled = false;
    }
  };
  $("openrouter-disconnect").onclick = () => {
    clearMedia();
    client.disconnect();
    refresh("Disconnected from this tab. Manage the key in OpenRouter.");
  };
  $("openrouter-chat").onchange = (event) =>
    client.setChat(event.target.checked);
  $("openrouter-stop").onclick = () => {
    clearMedia();
    refresh("Media stopped. Check OpenRouter activity for submitted requests.");
  };
  for (const kind of ["audio", "video"]) {
    $("openrouter-make-" + kind).onclick = async () => {
      const prompt = $("openrouter-prompt").value.trim();
      const model = $("openrouter-" + kind + "-model").value.trim();
      if (!prompt || !model) {
        refresh("Enter a prompt and choose a model.");
        return;
      }
      clearMedia();
      const active = new AbortController();
      controller = active;
      for (const type of ["audio", "video"])
        $("openrouter-make-" + type).disabled = true;
      $("openrouter-stop").hidden = false;
      refresh(
        kind === "audio"
          ? "Your audio is being made…"
          : "Your video is being made…",
      );
      try {
        const blob =
          kind === "audio"
            ? await client.speech(
                model,
                $("openrouter-voice").value.trim(),
                prompt,
                AbortSignal.any([active.signal, AbortSignal.timeout(120_000)]),
              )
            : await client.video(model, prompt, active.signal, (message) =>
                refresh(message),
              );
        active.signal.throwIfAborted();
        mediaUrl = URL.createObjectURL(blob);
        $("openrouter-" + kind).src = mediaUrl;
        $("openrouter-" + kind).hidden = false;
        $("openrouter-download").href = mediaUrl;
        $("openrouter-download").download =
          `cosyworld.${kind === "audio" ? "mp3" : "mp4"}`;
        $("openrouter-download").hidden = false;
        refresh(`Your ${kind} is ready.`);
      } catch (error) {
        if (!active.signal.aborted) refresh(error.message);
      } finally {
        for (const type of ["audio", "video"])
          $("openrouter-make-" + type).disabled = false;
        $("openrouter-stop").hidden = true;
      }
    };
  }
  let message;
  const callback =
    new URL(location.href).searchParams.get("openrouter") === "callback";
  try {
    if (callback) status.textContent = "Connecting OpenRouter…";
    if (
      await client.finish(location.href, (url) =>
        history.replaceState(null, "", url),
      )
    )
      message =
        "OpenRouter connected. Your account is ready for chat, audio, and video.";
  } catch (error) {
    message = error.message;
  }
  refresh(message);
  if (callback) $("menu-dialog").showModal();
  if (client.connection()?.key) void models();
}
