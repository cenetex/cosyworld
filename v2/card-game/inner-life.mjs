import { carried, currentActor, nameOf } from "./world.mjs";
import { profiles } from "./memory.mjs";
import { humanAvatar } from "./human-cast.mjs";
import { groundedInner, unfoundBlur } from "./speech-knowledge.mjs";

// Screen older saved thoughts as well as new summaries.
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

const summaryFits = (text) =>
  typeof text === "string" && text.length <= 280 && inCharacter(text) &&
  /\b(i|me|my|mine|myself)\b/iu.test(text) && !/[\u0000-\u001f\u007f]/u.test(text);
const summaryEvidence = (memory) => memory.evidence ?? memory.summary;

async function fetchMemorySummaries(actor, subjects, signal) {
  const response = await fetch("/card-game/memory-summaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor, subjects }),
    signal,
  });
  if (!response.ok) throw new Error("Memory summaries unavailable");
  const { summaries } = await response.json();
  return summaries;
}

export function createMemorySummaries({ storage, key, update, request = fetchMemorySummaries }) {
  let scope, cache = new Map(), controller = null, requested = false;
  function close() {
    controller?.abort();
    controller = null;
    requested = false;
  }
  return {
    close,
    show(seed, actor, memories, read = (text) => text) {
      const nextScope = JSON.stringify([2, seed, actor]);
      if (scope !== nextScope) {
        close();
        scope = nextScope;
        cache = new Map();
        try {
          const saved = JSON.parse(storage.getItem(key));
          if (saved?.scope === scope) cache = new Map(saved.entries);
        } catch { /* Factual memories remain available without storage. */ }
      }
      const pending = memories
        .filter((memory) => {
          const evidence = summaryEvidence(memory);
          return evidence.length > 0 && evidence.length <= 600 &&
            cache.get(memory.id)?.evidence !== evidence;
        })
        .sort((a, b) => Number(Boolean(b.significant)) - Number(Boolean(a.significant)))
        .slice(0, 12)
        .map((memory) => ({ id: memory.id, evidence: summaryEvidence(memory) }));
      if (!requested && pending.length) {
        requested = true;
        controller = new AbortController();
        const { signal } = controller;
        void request(actor, pending, signal).then((summaries) => {
          if (signal.aborted || !summaries || Array.isArray(summaries) || typeof summaries !== "object") return;
          for (const { id, evidence } of pending) {
            const text = Object.hasOwn(summaries, id) && summaries[id];
            cache.set(id, { evidence, text: summaryFits(text) ? text : null });
          }
          try {
            const entries = [...cache]
              .filter(([, memory]) => summaryFits(memory?.text))
              .slice(-160);
            storage.setItem(key, JSON.stringify({ scope, entries }));
          } catch { /* This tab keeps its summaries. */ }
          update();
        }).catch(() => {});
      }
      return memories.map((memory) => {
        const saved = cache.get(memory.id);
        return saved?.evidence === summaryEvidence(memory) && summaryFits(saved.text)
          ? { ...memory, summary: read(saved.text) }
          : memory;
      });
    },
  };
}

const newestFirst = (moments) =>
  (moments || [])
    .slice()
    .reverse()
    .map((m) => m.text);


export function subjectMemories(world, actor = currentActor(world), known = () => true) {
  const person = world.actors[actor], memory = world.memories[actor];
  if (!person || !memory) return [];
  const visited = "I have been here.";
  const subjects = new Map();
  const name = (id) => id && known(id) && profiles[id] ? nameOf(id) : null;
  const record = (id) => {
    const kind = profiles[id]?.kind;
    if (!kind || id === actor || !name(id)) return null;
    if (!subjects.has(id))
      subjects.set(id, { id, kind, name: name(id), seen: null, notes: new Map() });
    return subjects.get(id);
  };
  const observe = (id, turn, text) => {
    const subject = record(id);
    if (subject && (!subject.seen || subject.seen.turn <= turn))
      subject.seen = { turn, text };
  };
  const note = (ids, turn, text, { key = text, significant = true } = {}) => {
    for (const id of new Set(ids)) {
      const subject = record(id);
      if (subject && text && (subject.notes.get(key)?.turn ?? -1) <= turn)
        subject.notes.set(key, { turn, text, significant });
    }
  };
  for (const id of new Set([...(person.visited || []), person.place]))
    observe(id, 0, visited);
  for (const id of person.talked || [])
    note([id], 0, "We have spoken.", { significant: false });
  for (const [id, seen] of Object.entries(memory.seen || {}))
    observe(id, seen.turn, name(seen.place) ? `Last seen at ${name(seen.place)}.` : "Met before.");
  const life = world.life?.actors?.[actor];
  for (const [id, gift] of Object.entries(life?.attachments || {})) {
    const itemName = name(id), giver = name(gift.from);
    if (itemName && giver)
      note([id, gift.from], gift.turn, `Received ${itemName} from ${giver}.`, {
        key: `gift:${gift.from}:${id}`,
      });
  }
  for (const e of life?.experiences || []) {
    const other = name(e.other), item = name(e.item), here = name(e.place);
    const experiencePlace = here ? ` at ${here}` : "";
    const text = {
      help: other && `Helped ${other}${item ? ` with ${item}` : ""}${experiencePlace}.`,
      gift: other && item && `Received ${item} from ${other}${experiencePlace}.`,
      journey: other && (here
        ? `Travelled to ${here} with ${other}.`
        : `Travelled with ${other}.`),
      care: item && `Cared for ${item}${experiencePlace}.`,
      talk: other && `Spoke with ${other}${experiencePlace}.`,
      trade: other && `Traded with ${other}${item ? ` over ${item}` : ""}${experiencePlace}.`,
    }[e.kind];
    if (text) note([e.other, e.item, e.place], e.turn, text, {
      key: `${e.kind}:${e.other}:${e.item}`,
      significant: e.kind !== "talk",
    });
  }

  const rememberDeed = (e, ids = null) => {
    const mine = e.actorId === actor, theirs = e.targetId === actor;
    if (!mine && !theirs) return;
    const here = name(e.locationId);
    const deedPlace = here ? ` at ${here}` : "";
    const otherId = mine ? e.targetId : e.actorId;
    const other = world.actors[otherId] ? name(otherId) : null;
    const itemId = e.itemId || (world.items[e.targetId] ? e.targetId : null);
    const item = name(itemId), receive = name(e.receiveId);
    let text;
    if (e.verb === "talk" && other) text = `Spoke with ${other}${deedPlace}.`;
    if (e.verb === "give" && item && other && e.accepted !== false)
      text = mine ? `Gave ${item} to ${other}${deedPlace}.` : `Received ${item} from ${other}${deedPlace}.`;
    if (e.verb === "trade" && other && e.accepted !== false)
      text = item && receive
        ? `Traded ${mine ? item : receive} for ${mine ? receive : item} with ${other}${deedPlace}.`
        : `Traded with ${other}${deedPlace}.`;
    if (e.verb === "ask" && other && item && e.accepted === false)
      text = mine ? `${other} declined my request for ${item}${deedPlace}.` : `Declined ${other}'s request for ${item}${deedPlace}.`;
    if (e.verb === "accompany" && other && e.accepted === true)
      text = here ? `Travelled to ${here} with ${other}.` : `Travelled with ${other}.`;
    if (mine && item && e.accepted !== false && ["take", "drop", "read"].includes(e.verb))
      text = `${{ take: "Took", drop: "Left", read: "Read" }[e.verb]} ${item}${here ? ` at ${here}` : ""}.`;
    if (e.verb === "want_met" && mine && name(e.ownerId))
      text = `Helped ${name(e.ownerId)}${item ? ` with ${item}` : ""}${deedPlace}.`;
    if (text)
      note(ids || [otherId, itemId, e.receiveId, e.ownerId, e.locationId], e.turn, text, {
        key: e.verb === "give" && theirs ? `gift:${otherId}:${itemId}` : text,
        significant: e.verb !== "talk",
      });
  };
  for (const [id, retained] of Object.entries(memory.subjects || {})) {
    const sight = retained.sight;
    if (sight) {
      const here = name(sight.place), holder = name(sight.holder);
      if (profiles[id]?.kind === "location") {
        const company = sight.company.map(name).filter(Boolean).slice(0, 2);
        const things = sight.things.map(name).filter(Boolean).slice(0, 2);
        observe(id, sight.turn, [
          company.length ? `Met ${company.join(", ")} here.` : "",
          things.length ? `Saw ${things.join(", ")} here.` : "",
        ].filter(Boolean).join(" ") || visited);
      } else if (profiles[id]?.kind === "avatar") {
        observe(id, sight.turn, here ? `Last seen at ${here}.` : "Met before.");
      } else if (profiles[id]?.kind === "item") {
        const text = sight.holder === sight.place
          ? (here ? `Last seen on the ground at ${here}.` : "Last seen on the ground.")
          : sight.holder === actor ? "Held before."
            : holder ? `Last seen with ${holder}${here ? ` at ${here}` : ""}.`
              : here ? `Last seen at ${here}.` : "Seen before.";
        observe(id, sight.turn, text);
      }
    }
    for (const deed of retained.deeds || []) rememberDeed(deed, [id]);
  }

  const evidence = new Map([...(memory.events || []), ...(memory.landmarks || [])]
    .filter((e) => e.kind === "event").map((e) => [e.seq, e]));
  for (const e of world.log || []) {
    const cast = e.cast || [], present = cast.includes(actor);
    const saved = evidence.get(e.seq);
    if (e.generated || saved?.turn !== e.turn ||
      saved?.text !== `${e.speaker}: ${e.text}`.slice(0, 650) ||
      !(e.consequence ? e.witnesses?.includes(actor) : present || e.actorId === actor || e.witnesses?.includes(actor))) continue;
    const here = name(e.locationId);
    if (present || (!e.consequence && e.actorId === actor)) {
      const company = cast.filter((id) => id !== actor && world.actors[id]).map(name).filter(Boolean).slice(0, 2);
      const things = (e.items || []).filter((item) => item.holder === e.locationId).map((item) => name(item.id)).filter(Boolean).slice(0, 2);
      const glimpse = [
        company.length ? `Met ${company.join(", ")} here.` : "",
        things.length ? `Saw ${things.join(", ")} here.` : "",
      ].filter(Boolean).join(" ");
      observe(e.locationId, e.turn, glimpse || visited);
      for (const id of cast)
        if (world.actors[id]) observe(id, e.turn, here ? `Last seen at ${here}.` : "Met before.");
      for (const item of e.items || []) {
        if (!world.items[item.id] || !(item.holder === e.locationId || cast.includes(item.holder))) continue;
        const holder = name(item.holder);
        const text = item.holder === e.locationId
          ? (here ? `Last seen on the ground at ${here}.` : "Last seen on the ground.")
          : holder && item.holder !== actor ? `Last seen with ${holder}${here ? ` at ${here}` : ""}.`
            : item.holder === actor ? "Held before." : here ? `Last seen at ${here}.` : "Seen before.";
        observe(item.id, e.turn, text);
      }
    }
    rememberDeed(e);
  }
  for (const [id, learned] of Object.entries(world.knowledge?.known?.[actor] || {})) {
    const fact = world.knowledge.facts[id], source = fact?.source;
    if (source?.kind !== "quest") continue;
    const target = id.slice(`quest:${source.actorId}:`.length);
    const owner = name(source.actorId), subject = name(target), teller = name(learned.teller);
    if (!owner || !subject) continue;
    const text = `Learned of ${owner}'s request concerning ${subject}${teller && teller !== owner ? ` via ${teller}` : ""}.`;
    note([source.actorId, target, learned.teller], learned.learnedTurn, text, { key: id });
  }
  for (const id of carried(world, actor)) observe(id, world.turn, "Carrying now.");
  return [...subjects.values()].map(({ id, kind, name, seen, notes }) => {
    const recent = [...notes.values()].sort((a, b) =>
      Number(b.significant) - Number(a.significant) || b.turn - a.turn);
    const details = [...new Set(recent.map((n) => n.text))];
    const detail = details.filter((text) => text !== "We have spoken." ||
      !details.some((other) => other.startsWith("Spoke with "))).slice(0, 2);
    return {
      id, kind, name, turn: Math.max(seen?.turn ?? 0, ...recent.map((n) => n.turn)),
      significant: recent.some((n) => n.significant),
      summary: [seen?.text, ...detail].filter(Boolean).join(" "),
    };
  }).filter((subject) => subject.summary)
    .sort((a, b) => b.turn - a.turn || a.name.localeCompare(b.name));
}

export function innerLifeChain(world, actor = currentActor(world), read = (text) => text, known = () => true) {
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
    memories: subjectMemories(world, actor, known).map((subject) => {
      const evidence = blur(subject.summary);
      return { ...subject, evidence, name: read(subject.name), summary: read(evidence) };
    }),
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

export function memoriesSection(chain) {
  const { section, add } = lifeSection(chain, "memories");
  add("h3", "Memories");
  for (const [kind, title] of [["avatar", "People"], ["location", "Places"], ["item", "Items"]]) {
    const subjects = chain.memories.filter((subject) => subject.kind === kind);
    if (!subjects.length) continue;
    add("h4", title, "memory-place");
    const list = document.createElement("dl");
    list.className = "sheet-memories";
    for (const subject of subjects) {
      const name = document.createElement("dt");
      name.textContent = subject.name;
      const summary = document.createElement("dd");
      summary.textContent = subject.summary;
      list.append(name, summary);
    }
    section.append(list);
  }
  if (!chain.memories.length) add("p", "None yet.", "sheet-note");
  return section;
}
