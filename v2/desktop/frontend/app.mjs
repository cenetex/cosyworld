// This bundled window alone has permission to ask the desktop host to start services.
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const $ = (id) => document.getElementById(id);
function busy(value, message) {
  for (const control of $("setup").elements) control.disabled = value;
  $("status").textContent = message;
}
$("prepare").onclick = async () => {
  busy(
    true,
    "Preparing the dialogue model. First setup can take several minutes.",
  );
  try {
    await invoke("prepare_dialogue", { model: $("model").value.trim() });
    $("status").textContent =
      "Preparing the character voices. Keep this window open.";
    await invoke("prepare_voices", { voice: $("voice").value });
    busy(false, "Your models are ready. Choose Play to enter the world.");
  } catch (error) {
    busy(false, String(error));
  }
};
$("setup").onsubmit = async (event) => {
  event.preventDefault();
  busy(true, "Opening your world…");
  try {
    await invoke("start_game", {
      model: $("model").value.trim(),
      voice: $("voice").value,
    });
    busy(false, "Your world is open.");
  } catch (error) {
    busy(false, String(error));
  }
};
try {
  const value = await invoke("status");
  $("model").value = value.settings.model;
  $("voice").value = value.settings.voice;
  $("status").textContent =
    value.voices_ready && value.dialogue_ready
      ? "Choose Play to enter your world."
      : "Choose Prepare models for your first setup.";
} catch (error) {
  busy(false, String(error));
}

let handledPause = null;
setInterval(async () => {
  try {
    const { memory_pause: pause } = await invoke("status");
    if (!pause || pause.generation === handledPause) return;
    handledPause = pause.generation;
    if (pause.over_budget) $("model").value = "gemma3:1b";
    busy(
      false,
      pause.over_budget
        ? "Your world paused to free memory. Choose Light. Use Prepare models. Then choose Play."
        : "Your world paused while checking memory. Choose Play to try again.",
    );
  } catch {}
}, 2000);
