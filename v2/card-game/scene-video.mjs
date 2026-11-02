import {
  sceneVideoContext,
  sceneVideoOptions,
  sceneVideoPrompt,
} from "./scene-video-context.mjs";
import { playerCredits } from "./credits.mjs";

// The stage as a reference frame for a video model.
function stageFrame() {
  const stage = document.getElementById("stage"),
    rect = stage.getBoundingClientRect();
  const canvas = document.createElement("canvas"),
    scale = Math.min(1280 / rect.width, 720 / rect.height);
  canvas.width = 1280;
  canvas.height = 720;
  const offsetX = (canvas.width - rect.width * scale) / 2;
  const offsetY = (canvas.height - rect.height * scale) / 2;
  const context = canvas.getContext("2d");
  context.fillStyle = "#14151d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const background = [...stage.querySelectorAll("img.backdrop")].find(
      (image) =>
        image.complete &&
        image.naturalWidth &&
        image.getBoundingClientRect().width,
    );
    if (background) {
      const fill = Math.max(
        canvas.width / background.naturalWidth,
        canvas.height / background.naturalHeight,
      );
      context.drawImage(
        background,
        (canvas.width - background.naturalWidth * fill) / 2,
        (canvas.height - background.naturalHeight * fill) / 2,
        background.naturalWidth * fill,
        background.naturalHeight * fill,
      );
    }
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
        offsetX + (box.left - rect.left) * scale,
        offsetY + (box.top - rect.top) * scale,
        box.width * scale,
        box.height * scale,
      );
      context.clip();
      context.drawImage(
        image,
        offsetX + (box.left - rect.left + (box.width - width) / 2) * scale,
        offsetY + (box.top - rect.top + (box.height - height) / 2) * scale,
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

async function call(path, init) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "The video needs another try.");
  }
  return response;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// A scene video spends the passkey's credits on the server (#1924).
export function installSceneVideo({ getWorld, getScene }) {
  const $ = (id) => document.getElementById(id);
  const credits = playerCredits();
  const dialog = $("scene-video-dialog");
  const report = (message) => ($("scene-video-status").textContent = message);
  const pause = () => document.dispatchEvent(new Event("shared-dialog-change"));
  const price = () => credits.state.prices?.video ?? 100;
  let snapshot, frame, controller, resultUrl;
  function ready() {
    const cost = `${price()} credits`;
    $("scene-video-button").title = `Make a 10 second scene video · ${cost}`;
    $("scene-video-button").dataset.affordable = credits.affords("video");
    $("scene-video-create").textContent = `Create scene video · ${cost}`;
    $("scene-video-create").disabled =
      !credits.affords("video") || !snapshot?.dialogue.length || !!controller;
    $("scene-video-stop").hidden = !controller;
  }
  credits.subscribe(ready);
  function clearResult() {
    $("scene-video-player").removeAttribute("src");
    $("scene-video-player").hidden = true;
    $("scene-video-download").hidden = true;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
  }
  async function generate() {
    if (controller || !snapshot?.dialogue.length) return;
    const active = new AbortController();
    const signal = active.signal;
    controller = active;
    ready();
    clearResult();
    try {
      report("Reading the video model’s clip options…");
      const model = await (
        await call("/card-game/video/model", { signal })
      ).json();
      const options = sceneVideoOptions(model, frame);
      const id = crypto.randomUUID();
      report(`Making a ${options.duration} second video from these lines…`);
      await call("/card-game/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: id,
          prompt: sceneVideoPrompt(snapshot, options.duration),
          options,
        }),
        signal,
      });
      void credits.refresh();
      for (const deadline = Date.now() + 15 * 60_000; ; ) {
        await wait(3000, signal);
        const job = await (
          await call(`/card-game/video/${id}`, { signal })
        ).json();
        if (job.status === "completed") break;
        if (job.status !== "processing") {
          void credits.refresh();
          throw new Error(
            `The video needs a fresh request (${job.status}). ${job.error || ""}${job.refunded ? " Your credits were returned." : ""}`,
          );
        }
        if (Date.now() > deadline)
          throw new Error("Your video is still processing. Try again later.");
        report("Your video is being made…");
      }
      const blob = await (
        await call(`/card-game/video/${id}/content`, { signal })
      ).blob();
      resultUrl = URL.createObjectURL(blob);
      $("scene-video-player").src = resultUrl;
      $("scene-video-player").hidden = false;
      $("scene-video-download").href = resultUrl;
      $("scene-video-download").download = "cosyworld-scene.mp4";
      $("scene-video-download").hidden = false;
      report("Your scene video is ready.");
    } catch (error) {
      if (!signal.aborted) report(error.message);
    } finally {
      controller = null;
      ready();
    }
  }
  $("scene-video-button").onclick = () => {
    if (!controller) {
      snapshot = sceneVideoContext(getWorld(), getScene());
      frame = stageFrame();
      clearResult();
      $("scene-video-lines").textContent = snapshot.dialogue
        .map((line) => `${line.speaker}: ${line.text}`)
        .join("\n\n");
      const { signed_in, balance } = credits.state;
      report(
        !snapshot.dialogue.length
          ? "Play a card to give this scene its first words."
          : !signed_in
            ? "Sign in with your passkey to make a scene video."
            : credits.affords("video")
              ? `Film these lines for ${price()} credits. You have ${balance}.`
              : `A scene video costs ${price()} credits; you have ${balance}. Get a speech pack in Settings.`,
      );
    }
    ready();
    dialog.showModal();
    pause();
  };
  $("scene-video-create").onclick = () => void generate();
  $("scene-video-stop").onclick = () => {
    controller?.abort();
    report("Waiting stopped. The film's credits stay spent unless it fails.");
  };
  $("scene-video-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    $("scene-video-player").pause();
    pause();
  });
}
