import { authoringCardId, buildAuthoringTree } from "./authoring-tree.mjs";
import {
  applySourceEdit,
  linkPlaces,
  moveCard,
  setStarterQuest,
  setStartingPlace,
} from "./authoring-edits.mjs";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const index = (state) =>
  new Map(
    buildAuthoringTree(state.source).cards.map((card) => [card.id, card]),
  );
const target = (cards, card) =>
  card?.role === "entity" ? card : cards.get(card?.ref);
const owner = (cards, box) =>
  ["contents", "quests"].includes(box?.role) && box.source.length === 3
    ? cards.get(authoringCardId(box.source, "entity"))
    : null;
const key = (state) => JSON.stringify([state.armed, state.selected]);

// Local sequence and Undo belong to the editor. Branch expansion belongs to
// the workspace; the saved source owns pack, bridge and its launch sidecar.
export function createAuthoringState(source) {
  return {
    source: structuredClone(source),
    selected: [],
    armed: null,
    undo: [],
    sequence: 0,
  };
}

function commit(state, edit, selection = {}) {
  if (!edit.changes.length) return { ...state, ...selection };
  const result = applySourceEdit(state.source, edit);
  return {
    ...state,
    source: result.source,
    selected: [],
    armed: null,
    undo: [...state.undo.slice(-49), result.undo],
    sequence: state.sequence + 1,
    ...selection,
  };
}

export function authoringAction(state) {
  if (!state.armed) return null;
  const cards = index(state),
    box = cards.get(state.armed);
  const host = owner(cards, box),
    card = target(cards, cards.get(state.selected[1]));
  const action = {
    sequence: state.sequence,
    key: key(state),
    label: "Choose a target",
  };
  try {
    need(host && card, "Choose a location, avatar or item for this box.");
    const from = host.canonicalId,
      to = card.canonicalId;
    let edit, label;
    if (
      box.role === "contents" &&
      host.kind === "place" &&
      card.kind === "place"
    ) {
      edit = linkPlaces(state.source, from, to);
      label = `Link ${host.name} to ${card.name} and back`;
    } else if (box.role === "contents") {
      const collection = card.source[1];
      const record = state.source.pack[collection][to];
      const previous = card.kind === "avatar" ? record.place : record.holder;
      const name = [...cards.values()].find(
        (c) => c.role === "entity" && c.canonicalId === previous,
      )?.name;
      edit = moveCard(state.source, collection, to, from);
      label = `Move ${card.name} from ${name || previous || "Elsewhere"} to ${host.name}`;
    } else {
      need(
        host.kind === "avatar",
        "Open this location's quest cards to edit its conditions and rewards.",
      );
      const kind = card.kind === "avatar" ? "person" : card.kind;
      edit = setStarterQuest(state.source, from, kind, to);
      const verb = { item: "bring", place: "reach", person: "meet" }[kind];
      label = `Set ${host.name}'s starting quest: ${verb} ${card.name}`;
    }
    need(edit.changes.length, "These starting conditions are already set.");
    return { ...action, label, edit: { ...edit, label }, disabled: false };
  } catch (error) {
    return { ...action, disabled: true, reason: error.message };
  }
}

export function reduceAuthoring(state, event) {
  if (event.sequence !== undefined)
    need(
      event.sequence === state.sequence,
      "This draft changed. Review the current action.",
    );
  if (event.type === "cancel") return { ...state, selected: [], armed: null };
  if (event.type === "undo") {
    if (!state.undo.length) return state;
    const result = applySourceEdit(state.source, state.undo.at(-1));
    return {
      ...state,
      source: result.source,
      selected: [],
      armed: null,
      undo: state.undo.slice(0, -1),
      sequence: state.sequence + 1,
    };
  }
  if (event.type === "edit") return commit(state, event.edit);
  if (event.type === "setLaunch")
    return commit(state, setStartingPlace(state.source, event.place));
  if (event.type === "apply") {
    need(
      event.sequence === state.sequence && event.key === key(state),
      "The selection changed. Review the current action.",
    );
    const action = authoringAction(state);
    need(
      action && !action.disabled,
      action?.reason || "Choose a box and a target.",
    );
    return commit(state, action.edit);
  }
  need(["select", "arm"].includes(event.type), "Choose an authoring action.");
  const cards = index(state),
    card = cards.get(event.id);
  need(card, "Choose a card in the current draft.");
  if (event.type === "arm" || (!state.armed && owner(cards, card))) {
    need(owner(cards, card), "Choose a location or avatar box.");
    return { ...state, armed: card.id, selected: [card.id] };
  }
  const entity = target(cards, card);
  if (state.armed)
    return entity ? { ...state, selected: [state.armed, card.id] } : state;
  const selection = { selected: [card.id] };
  return entity?.kind === "place"
    ? commit(
        state,
        setStartingPlace(state.source, entity.canonicalId),
        selection,
      )
    : { ...state, ...selection };
}
