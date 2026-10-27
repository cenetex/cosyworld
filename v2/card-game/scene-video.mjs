import { playerOpenRouter } from "./openrouter.mjs";
import { connectOpenRouter } from "./openrouter-connect.mjs";
import {
  DEFAULT_VIDEO_MODEL,
  sceneVideoContext,
  sceneVideoOptions,
  sceneVideoPrompt,
} from "./scene-video-context.mjs";

function stageFrame() {
  const stage = document.getElementById("stage"),
    rect = stage.getBoundingClientRect();
  const canvas = document.createElement("canvas"),
    scale = Math.min(1, 1280 / rect.width, 720 / rect.height);
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#14151d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    for (const image of stage.querySelectorAll("img")) {
      const box = image.getBoundingClientRect();
      if (
        !image.complete ||
        !image.naturalWidth ||
        !box.width ||
        !box.height ||
        getComputedStyle(image).opacity === "0"
      )
        continue;
      const cover = image.classList.contains("backdrop");
      const factor = cover
        ? Math.max(
            box.width / image.naturalWidth,
            box.height / image.naturalHeight,
          )
        : Math.min(
            box.width / image.naturalWidth,
            box.height / image.naturalHeight,
          );
      const width = image.naturalWidth * factor,
        height = image.naturalHeight * factor;
      context.save();
      context.beginPath();
      context.rect(
        (box.left - rect.left) * scale,
        (box.top - rect.top) * scale,
        box.width * scale,
        box.height * scale,
      );
      context.clip();
      context.drawImage(
        image,
        (box.left - rect.left + (box.width - width) / 2) * scale,
        (box.top - rect.top + (box.height - height) / 2) * scale,
        width * scale,
        height * scale,
      );
      context.restore();
    }
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

export function installSceneVideo({ getWorld, getScene }) {
  const client = playerOpenRouter(),
    $ = (id) => document.getElementById(id);
  const dialog = $("scene-video-dialog"),
    status = $("scene-video-status");
  let snapshot,
    frame,
    controller,
    resultUrl,
    waitingConnection = false;
  const report = (message) => {
    status.textContent = message;
  };
  const pause = () => document.dispatchEvent(new Event("shared-dialog-change"));
  function ready() {
    const connected = Boolean(client.connection()?.key);
    $("scene-video-connect").hidden = connected;
    $("scene-video-create").disabled =
      !connected || !snapshot?.dialogue.length || Boolean(controller);
    $("scene-video-model").disabled = Boolean(controller);
  }
  function clearResult() {
    $("scene-video-player").pause();
    $("scene-video-player").removeAttribute("src");
    $("scene-video-player").load();
    $("scene-video-player").hidden = true;
    $("scene-video-download").hidden = true;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
  }
  async function generate() {
    if (controller || !snapshot?.dialogue.length) return;
    if (!client.connection()?.key) {
      waitingConnection = true;
      ready();
      return;
    }
    waitingConnection = false;
    const active = new AbortController();
    controller = active;
    ready();
    clearResult();
    $("scene-video-stop").hidden = false;
    report("Reading the video model’s clip options…");
    try {
      const modelId =
        $("scene-video-model").value.trim() || DEFAULT_VIDEO_MODEL;
      const catalog = await client.request("videos/models", {
        key: "",
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(30_000)]),
      });
      const options = sceneVideoOptions(
        catalog.data.find((model) => model.id === modelId),
        frame,
      );
      client.setVideoModel(modelId);
      report(`Making a ${options.duration} second video from these lines…`);
      const blob = await client.video(
        modelId,
        sceneVideoPrompt(snapshot, options.duration),
        AbortSignal.any([active.signal, AbortSignal.timeout(15 * 60_000)]),
        report,
        options,
      );
      active.signal.throwIfAborted();
      resultUrl = URL.createObjectURL(blob);
      $("scene-video-player").src = resultUrl;
      $("scene-video-player").hidden = false;
      $("scene-video-download").href = resultUrl;
      $("scene-video-download").download = "cosyworld-scene.mp4";
      $("scene-video-download").hidden = false;
      report("Your scene video is ready.");
    } catch (error) {
      if (!active.signal.aborted) report(error.message);
    } finally {
      controller = null;
      $("scene-video-stop").hidden = true;
      ready();
    }
  }
  $("scene-video-button").onclick = () => {
    if (controller) {
      if (!dialog.open) dialog.showModal();
      pause();
      return;
    }
    snapshot = sceneVideoContext(getWorld(), getScene());
    frame = stageFrame();
    clearResult();
    $("scene-video-lines").textContent = snapshot.dialogue
      .map((line) => `${line.speaker}: ${line.text}`)
      .join("\n\n");
    $("scene-video-model").value =
      client.connection()?.videoModel ||
      $("openrouter-video-model").value.trim() ||
      DEFAULT_VIDEO_MODEL;
    ready();
    dialog.showModal();
    pause();
    if (!snapshot.dialogue.length) {
      report("Play a card to give this scene its first words.");
      return;
    }
    if (!client.connection()?.key) {
      waitingConnection = true;
      report("Connect OpenRouter to make this scene video with your credits.");
    } else void generate();
  };
  $("scene-video-connect").onclick = () => connectOpenRouter(report);
  $("scene-video-create").onclick = () => void generate();
  $("scene-video-stop").onclick = () => {
    controller?.abort();
    report(
      "Waiting stopped. Check OpenRouter activity for your submitted video.",
    );
  };
  $("scene-video-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    waitingConnection = false;
    $("scene-video-player").pause();
    pause();
  });
  document.addEventListener("openrouter-change", () => {
    ready();
    if (waitingConnection && dialog.open && client.connection()?.key)
      void generate();
  });
}
