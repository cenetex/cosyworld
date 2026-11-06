import { installCardWorkspace } from "./settings-screen.mjs";
import { cardTreeLayout, placeCardTree } from "./card-tree-layout.mjs";
import { createAuthoringSession } from "./authoring-session.mjs";
import { authoringAction } from "./authoring-controller.mjs";
import { authoringCardId, buildAuthoringTree } from "./authoring-tree.mjs";
import { authoringFieldHidden } from "./authoring-fields.mjs";
const BOX = "assets/card-back.webp",
  ROOT = authoringCardId(["pack"], "root");
const actions = ["Save", "Undo", "Reload", "Cancel"];
export function installWorldDesigner({
  store,
  actionBeat,
  resolveArt = () => null,
  onScene = () => {},
  tools = [],
  onClose = () => {},
}) {
  let workspace,
    previous,
    base = [],
    byId = new Map(),
    toolMap = new Map();
  const session = createAuthoringSession({
    store,
    onChange() {
      const source = session.state.source;
      const { key, generation, title } = session.status;
      const stamp = JSON.stringify([key, generation, title]);
      if (source !== previous?.source || stamp !== previous?.stamp) {
        previous = { source, stamp };
        base = buildAuthoringTree(source)
          .cards.filter((card) => !authoringFieldHidden(card))
          .map((card) => ({
            ...card,
            art:
              resolveArt(card.art, session.status) ||
              (card.role === "quests" ? "assets/card-back-locked.webp" : BOX),
          }));
        showScene();
      }
      workspace?.refresh();
    },
  });
  function showScene() {
    const source = session.state.source,
      place = source.launch?.place ?? null;
    onScene(place, structuredClone(source), session.status);
  }
  const utility = (id, name) => ({
    id,
    name,
    holder: ROOT,
    kind: "box",
    role: "utility",
    art: BOX,
    lit: true,
  });
  function readCards() {
    toolMap = new Map();
    for (const tool of typeof tools === "function" ? tools() : tools) {
      const id = `designer-tool-${tool.id}`;
      if (!/^[A-Za-z0-9_-]+$/u.test(tool.id) || toolMap.has(id))
        throw new Error("Use unique tool names.");
      toolMap.set(id, tool);
    }
    const cards = [
      ...base,
      ...actions.map((name) => utility(`designer-${name.toLowerCase()}`, name)),
      ...[...toolMap].map(([id, tool]) => utility(id, tool.name)),
    ];
    byId = new Map(cards.map((card) => [card.id, card]));
    return cards;
  }
  const readContext = {
    snapshot: () => session.snapshot({ pending: false }),
    stage: session.stage,
  };
  function describe(_cards, chosen, armed) {
    const card = byId.get(chosen),
      tool = toolMap.get(chosen),
      status = session.status;
    let view = {
      name: card?.name || status.title,
      info: status.writing ? "Saving" : status.dirty ? "Unsaved" : "Saved",
      note: "Open a box or choose a field.",
      actions: [],
    };
    if (tool) {
      view = { ...view, ...tool.describe(readContext) };
      view.actions = (view.actions || []).map((a) => ({ ...a, tool: chosen }));
    } else if (card?.role === "utility") {
      const run = chosen.replace("designer-", "");
      const label =
        run === "reload" && armed === `${chosen}:0`
          ? "Discard edits and reload"
          : run === "undo"
            ? session.state.undo.at(-1)?.label || "Undo"
            : card.name;
      view.actions = [
        {
          label,
          run,
          confirm: run === "reload" && status.dirty,
          disabled: run === "undo" && !session.state.undo.length,
        },
      ];
    } else {
      const action = authoringAction(session.state);
      if (action) {
        view.note = action.reason || "Review this change, then apply it.";
        view.actions = [{ ...action, run: "apply" }];
      } else {
        const entry = session.field(card);
        if (entry) {
          const { field, text } = entry;
          view.note = field.reason || "Edit this source field.";
          if (field.editable) {
            if (field.type !== "boolean")
              view.edit = {
                key: `${status.key}:${field.key}`,
                label: field.label,
                value: text,
                onInput: (value) => session.input(field, value),
              };
            view.actions = [{ label: field.action, run: "field", field }];
          }
        } else view.note = card?.state || view.note;
      }
    }
    if (status.accepting) view.edit = null;
    view.actions = view.actions.map((action) => ({
      ...action,
      stays: true,
      disabled: action.disabled || status.busy || status.writing,
    }));
    return view;
  }
  workspace = installCardWorkspace({
    label: "World editor",
    initialGroup: ROOT,
    cards: readCards,
    actionBeat,
    describe,
    selected: () => session.state.selected,
    onClose() {
      session.touch();
      onClose();
    },
    layout(cards, state) {
      return {
        nodes: cardTreeLayout(cards, state).nodes.filter(
          (node) => innerWidth > 700 || node.phone,
        ),
        place: (screen) => placeCardTree(screen, cards, state),
      };
    },
    onSelect(id) {
      if (session.status.accepting) return;
      const card = byId.get(id);
      if (card.role === "field" && !card.group && session.state.armed)
        session.dispatch({ type: "cancel" });
      if (card.role === "utility" || session.state.armed === id)
        return session.dispatch({ type: "cancel" });
      let parent = card.holder;
      while (parent && parent !== session.state.armed)
        parent = byId.get(parent)?.holder;
      const nested =
        parent &&
        ["contents", "quests"].includes(card.role) &&
        card.source.length === 3;
      session.dispatch({ type: nested ? "arm" : "select", id });
    },
    onCancel() {
      if (!session.state.armed) return false;
      session.dispatch({ type: "cancel" });
      return true;
    },
    run(action) {
      document.activeElement?.blur();
      const tool = toolMap.get(action.tool);
      return session.run(async (ctx) => {
        const open = (value) => {
          document.activeElement?.blur();
          ctx.open(value);
        };
        if (action.tool) await tool.run(action, { ...ctx, open });
        else if (action.run === "save") await ctx.save();
        else if (action.run === "reload")
          open({
            key: session.status.key,
            record: await store.read(session.status.key),
          });
        else if (action.run === "field") session.saveField(action.field);
        else session.dispatch({ ...action, type: action.run });
      });
    },
  });
  document
    .querySelector(".action-beat-note")
    .addEventListener("input", session.touch);
  addEventListener("resize", workspace.refresh);
  return {
    open(value) {
      document.activeElement?.blur();
      if (value) session.open(value);
      workspace.open();
      showScene();
    },
    close() {
      document.activeElement?.blur();
      workspace.close();
    },
    refresh: workspace.refresh,
    chooseTool(id) {
      workspace.refresh();
      workspace.choose(`designer-tool-${id}`);
    },
  };
}
