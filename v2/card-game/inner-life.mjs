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

export function innerLifeChain(world, actor = currentActor(world), read = (text) => text) {
  const name = nameOf(actor);
  const avatar = humanAvatar(actor);
  const memory = world.memories[actor] || {};
  const inner = memory.innerLife || {};
  const { blur } = unfoundBlur(world, actor);
  const shown = (lines) =>
    lines
      .filter((t) => inCharacter(t) && groundedInner(world, actor, t))
      .map(blur)
      .map(read);
  const logged = new Set(world.log.map((entry) => entry.seq));
  const retained = new Map([...memory.events || [], ...memory.landmarks || []]
    .filter((event) => event.kind === "event" && !logged.has(event.seq))
    .map((event) => [event.seq, event]));
  return {
    name,
    im: read(avatar?.title ? `I'm ${name}. ${avatar.title}.` : `I'm ${name}.`),
    becoming: shown([...newestFirst(inner.thoughts), inner.persona]).slice(
      0,
      1,
    ),
    dreams: shown(newestFirst(inner.dreams)).slice(0, 4),
    description: read(avatar?.text || ""),
    persona: shown([inner.persona])[0] || "",
    memories: [...retained.values()].sort((a, b) => b.seq - a.seq)
      .map((event) => read(blur(event.text))),
  };
}

function lifeSection(chain, label) {
  const section = document.createElement("section");
  section.className = "inner-life";
  section.setAttribute("aria-label", `${chain.name}'s ${label}`);
  const add = (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    section.append(node);
  };
  return { section, add };
}

export function personaSection(chain) {
  if (!chain.description && !chain.persona) return null;
  const { section, add } = lifeSection(chain, "persona");
  add("h3", "Persona");
  if (chain.description) add("p", chain.description);
  if (chain.persona && chain.persona !== chain.description)
    add("p", chain.persona, "inner-life-persona");
  return section;
}

export function innerLifeSection(chain) {
  const { section, add } = lifeSection(chain, "dreams");
  add("h3", "Dreams");
  for (const line of chain.dreams) add("p", line);
  if (!chain.dreams.length) add("p", "None yet.", "sheet-note");
  return section;
}

export function earlierMemoriesSection(memories) {
  const section = document.createElement("section");
  section.className = "sheet-earlier-memories";
  section.setAttribute("aria-label", "Earlier memories");
  const heading = document.createElement("h4");
  heading.className = "memory-place";
  heading.textContent = "Earlier memories";
  section.append(heading);
  for (const text of memories) {
    const p = document.createElement("p");
    p.textContent = text;
    section.append(p);
  }
  return section;
}
