import { currentActor, nameOf } from "./world.mjs";
import { learningFacts } from "./learning.mjs";

// This panel reads only the current player's private projection.
export function installInnerLife(menu, getWorld) {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "inner-life-button";
  button.textContent = "Inner life";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-controls", "inner-life-dialog");
  const dialog = document.createElement("dialog");
  dialog.id = "inner-life-dialog";
  dialog.className = "players-dialog inner-life-dialog";
  dialog.setAttribute("aria-labelledby", "inner-life-title");
  const content = document.createElement("div");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "players-close";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  dialog.append(content, close);
  menu.append(button);
  document.body.append(dialog);
  const changed = () =>
    document.dispatchEvent(new Event("shared-dialog-change"));
  dialog.addEventListener("close", () => {
    changed();
    button.focus();
  });
  button.onclick = () => {
    const world = getWorld();
    const actor = currentActor(world);
    const memory = world.memories[actor];
    content.replaceChildren();
    const title = document.createElement("h2");
    title.id = "inner-life-title";
    title.textContent = `${nameOf(actor)}'s inner life`;
    content.append(title);
    const section = (heading, lines) => {
      if (!lines.length) return;
      const h = document.createElement("h3");
      h.textContent = heading;
      content.append(h);
      for (const line of lines) {
        const p = document.createElement("p");
        p.textContent = line;
        content.append(p);
      }
    };
    section("Who I am becoming", [
      memory.innerLife?.persona ||
        "Each encounter gives me something to think about.",
    ]);
    section(
      "On my mind",
      (memory.innerLife?.thoughts || [])
        .slice()
        .reverse()
        .map((m) => m.text),
    );
    section("What I learned", learningFacts(world, actor, nameOf));
    section(
      "Dreams",
      (memory.innerLife?.dreams || [])
        .slice()
        .reverse()
        .map((m) => m.text),
    );
    dialog.showModal();
    changed();
  };
}
