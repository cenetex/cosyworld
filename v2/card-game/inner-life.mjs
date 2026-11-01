import { currentActor, nameOf } from "./world.mjs";
import { humanAvatar } from "./human-cast.mjs";
import { groundedInner, unfoundBlur } from "./speech-knowledge.mjs";

// Phrases an assistant uses about a scene rather than a character inside it.
// The server's speech check (`ASSISTANT_SPEAK` in card_narrative.rs) rejects
// most of these before commit, but older saves and the dream prompt still let
// a few through, so the panel hides them too (#1467).
const ASSISTANT_TALK = [
  "as an ai",
  "language model",
  "here to help",
  "how can i assist",
  "prompt",
  "the user",
  "roleplay",
  "role-play",
  "in character",
  "it seems",
  "it appears",
  "it looks like you",
  "sounds like you",
  "you're outlining",
  "you're describing",
  "you've described",
  "let's break",
  "let's dive",
  "let's continue",
  "scenario",
  "narrative",
  "the scene",
  "this scene",
  "your character",
  "what do you do?",
];

export const inCharacter = (text) => {
  const lower = String(text || "").toLowerCase();
  return lower.trim() !== "" && !ASSISTANT_TALK.some((p) => lower.includes(p));
};

const newestFirst = (moments) =>
  (moments || [])
    .slice()
    .reverse()
    .map((m) => m.text);

// The three-part chain from #1467: "I'm" is authored, "I'm becoming" is the
// avatar's one current intention, its newest grounded thought, and "I dream"
// is its dreams. A line that narrates, breaks its quotes, or names a thing
// the avatar was never near is not shown; a quest target it has not found
// stays unnamed (#1850). Measured attempts stay in the save.
export function innerLifeChain(world, actor = currentActor(world)) {
  const name = nameOf(actor);
  const title = humanAvatar(actor)?.title;
  const inner = world.memories[actor]?.innerLife || {};
  const { blur } = unfoundBlur(world, actor);
  const shown = (lines) =>
    lines
      .filter((t) => inCharacter(t) && groundedInner(world, actor, t))
      .map(blur);
  return {
    name,
    im: title ? `I'm ${name}. ${title}.` : `I'm ${name}.`,
    becoming: shown([...newestFirst(inner.thoughts), inner.persona]).slice(
      0,
      1,
    ),
    dreams: shown(newestFirst(inner.dreams)).slice(0, 4),
  };
}

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
    const chain = innerLifeChain(getWorld());
    content.replaceChildren();
    const title = document.createElement("h2");
    title.id = "inner-life-title";
    title.textContent = `${chain.name}'s inner life`;
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
    // The authored sentence opens the chain; it already says "I'm".
    const im = document.createElement("p");
    im.className = "inner-life-im";
    im.textContent = chain.im;
    content.append(im);
    section("I'm becoming", chain.becoming);
    section("I dream", chain.dreams);
    const signature = document.createElement("p");
    signature.className = "inner-life-name";
    signature.textContent = `— ${chain.name}`;
    content.append(signature);
    dialog.showModal();
    changed();
  };
}
