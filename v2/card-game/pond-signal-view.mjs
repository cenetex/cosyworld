import { currentActor } from "./human-cast.mjs";
import { owedPondLamp } from "./pond-lamp-loan.mjs";

const POND = "pond";
const PIP = "moth";
const LAMP = "lamp";
const waiting = "Pip is waiting for the Lamp.";

function pondSignalWords(world, known) {
  const actor = currentActor(world);
  const method = world.crossings?.["pond-greek-harbor"]?.method;
  if (world.actors[actor]?.place !== POND || !known(POND)) return "";
  if (method !== "pond-lamp" || world.pondLampLoan?.borrower !== actor ||
    world.actors[PIP]?.place !== POND || !known(PIP) || !known(LAMP)) return "";
  const holder = world.items[LAMP]?.holder;
  if (owedPondLamp(world)) return holder === actor || holder === POND ? waiting : "";
  return holder === PIP ? "Pip has the Lamp back." : "";
}

export function pondSignalNote(world, known, chosen) {
  if (!chosen.some((id) => id === PIP || id === LAMP || id === POND)) return "";
  const words = pondSignalWords(world, known);
  return words === waiting ? words : "";
}

export function pondSignalBeat(world, beat, known) {
  if (!beat || beat.pending || beat.dream || world.arrival?.locationId !== POND) return beat;
  const arrival = world.log.find((entry) => entry.seq === world.arrival.seq);
  if (!arrival || arrival.turn !== beat.turn || arrival.actorId !== currentActor(world)) return beat;
  const text = pondSignalWords(world, known);
  if (!text) return beat;
  return { ...beat, actions: [...beat.actions, { kind: "want_met", icon: "✦", text }] };
}
