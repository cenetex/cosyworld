import { sceneVideoContext } from "./scene-video-context.mjs";

// The stage as a reference frame for a video model.
export function stageFrame() {
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

// Players no longer bring an OpenRouter key; scene videos return as a
// credits purchase on the server (#1924). The camera still shows the lines.
export function installSceneVideo({ getWorld, getScene }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("scene-video-dialog");
  const pause = () => document.dispatchEvent(new Event("shared-dialog-change"));
  $("scene-video-button").onclick = () => {
    const snapshot = sceneVideoContext(getWorld(), getScene());
    $("scene-video-lines").textContent = snapshot.dialogue
      .map((line) => `${line.speaker}: ${line.text}`)
      .join("\n\n");
    $("scene-video-create").disabled = true;
    $("scene-video-status").textContent = snapshot.dialogue.length
      ? "Scene videos are coming back soon, paid with credits."
      : "Play a card to give this scene its first words.";
    dialog.showModal();
    pause();
  };
  $("scene-video-close").onclick = () => dialog.close();
  dialog.addEventListener("close", pause);
}
