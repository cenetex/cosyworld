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

// Memory opens on the avatar's inner life, the present, before the past
// visits below it. It reads only the current player's private projection.
export function innerLifeSection(chain) {
  const section = document.createElement("section");
  section.className = "inner-life";
  section.setAttribute("aria-labelledby", "inner-life-title");
  const add = (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    section.append(node);
  };
  add("h3", `${chain.name}'s inner life`, "memory-place");
  section.firstChild.id = "inner-life-title";
  // The authored sentence opens the chain; it already says "I'm".
  add("p", chain.im, "inner-life-im");
  for (const [heading, lines] of [
    ["I'm becoming", chain.becoming],
    ["I dream", chain.dreams],
  ]) {
    if (!lines.length) continue;
    add("h4", heading);
    for (const line of lines) add("p", line);
  }
  add("p", `— ${chain.name}`, "inner-life-name");
  return section;
}
