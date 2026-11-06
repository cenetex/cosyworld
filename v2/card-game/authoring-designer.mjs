import { installCardWorkspace } from "./settings-screen.mjs";
import { cardTreeLayout, placeCardTree } from "./card-tree-layout.mjs";
import { createAuthoringSession } from "./authoring-session.mjs";
import { authoringAction } from "./authoring-controller.mjs";
import { buildAuthoringTree } from "./authoring-tree.mjs";
import { authoringFieldHidden } from "./authoring-fields.mjs";
import { authoringTools } from "./authoring-tools.mjs";
import {
  authoringCollections,
  WORLD,
  TOOLS,
} from "./authoring-collections.mjs";
const BOX = "assets/card-back.webp";
const actions = ["Save", "Undo", "Reload", "Cancel"];
export function installWorldDesigner({
  store,
  actionBeat,
  resolveArt = () => null,
  onScene = () => {},
  tools = [],
  onOpen = () => {},
  onClose = () => {},
  transientState = () => null,
}) {
  let workspace,
    previous,
    opening = false,
    mode = "world",
    base = { world: [], tools: [] },
    byId = new Map(),
    toolMap = new Map(),
    projected,
    confirmation;
  const session = createAuthoringSession({
    store,
    onChange() {
      const source = session.state.source;
      const { key, generation, title } = session.status;
      const stamp = JSON.stringify([key, generation, title]);
      if (source !== previous?.source || stamp !== previous?.stamp) {
        previous = { source, stamp };
        base = authoringCollections(
          buildAuthoringTree(source).cards.filter(
            (card) => !authoringFieldHidden(card),
          ),
          source,
        );
        for (const group of Object.keys(base))
          base[group] = base[group].map((card) => ({
            ...card,
            art:
              resolveArt(card.art, session.status) ||
              (card.role === "quests" ? "assets/card-back-locked.webp" : BOX),
          }));
        showScene();
      }
      if (!opening) workspace?.refresh();
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
    holder: TOOLS,
    kind: "box",
    role: "utility",
    art: BOX,
    lit: true,
  });
  function readCards() {
    projected = authoringTools(
      base,
      typeof tools === "function" ? tools() : tools,
    );
    toolMap = projected.byId;
    const cards = [
      ...projected.cards[mode],
      ...(mode === "tools"
        ? [
            ...actions.map((name) =>
              utility(`designer-${name.toLowerCase()}`, name),
            ),
          ]
        : []),
    ];
    byId = new Map(cards.map((card) => [card.id, card]));
    return cards;
  }
  const readContext = {
    get status() {
      return session.status;
    },
    snapshot: () => session.snapshot({ pending: false }),
    stage: session.stage,
  };
  const pendingDesign = () => session.status.dirty || transientState() !== null;
  const discardToken = () =>
    JSON.stringify([
      session.status.key,
      session.status.editEpoch,
      transientState(),
    ]);
  function openDraft(value, open = session.open, approved = false) {
    if (!approved && session.state && pendingDesign())
      throw new Error("Review this design before opening another draft.");
    opening = true;
    try {
      open(value);
      onOpen(session.status);
    } finally {
      opening = false;
    }
  }
  function describe(_cards, chosen, armed) {
    if (!armed) confirmation = null;
    const card = byId.get(chosen),
      toolId = toolMap.has(chosen) ? chosen : projected.anchors.get(chosen),
      tool = toolMap.get(toolId),
      status = session.status;
    let view = {
      name: card?.name || status.title,
      info: status.writing ? "Saving" : status.dirty ? "Unsaved" : "Saved",
      note: card?.state || "Open a box or choose a field.",
      actions: [],
    };
    if (tool && !(tool.anchor && authoringAction(session.state))) {
      view = {
        ...view,
        ...tool.describe({
          ...readContext,
          confirming: armed === `${chosen}:0`,
        }),
      };
      view.actions = (view.actions || []).map((a) => ({ ...a, tool: toolId }));
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
          opensDraft: run === "reload",
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
    view.actions = view.actions.map((action, index) => {
      const needsConsent = action.opensDraft && pendingDesign();
      if (
        action.opensDraft &&
        armed === `${chosen}:${index}` &&
        confirmation?.id !== armed
      )
        confirmation = { id: armed, token: discardToken() };
      return {
        ...action,
        ...(needsConsent
          ? {
              label:
                action.run === "reload"
                  ? armed
                    ? "Confirm reload and discard"
                    : "Reload and discard this design"
                  : armed
                    ? "Confirm import and discard"
                    : "Import and discard this design",
              confirm: true,
            }
          : {}),
        discardToken: action.opensDraft
          ? (confirmation?.token ?? discardToken())
          : null,
        stays: true,
        disabled: action.disabled || status.busy || status.writing,
      };
    });
    return view;
  }
  workspace = installCardWorkspace({
    label: "World editor",
    cards: readCards,
    actionBeat,
    describe,
    selected: () => [...session.state.selected, ...(projected?.selected || [])],
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
      const tool = toolMap.get(id);
      if (tool) {
        session.dispatch({ type: "cancel" });
        tool.select?.(readContext);
        workspace.refresh();
        return;
      }
      if (card.role === "navigation") return session.touch();
      if (card.ref) return chooseView("world", card.ref);
      if (card.role === "field" && !card.group && session.state.armed)
        session.dispatch({ type: "cancel" });
      if (card.role === "utility" || session.state.armed === id)
        return session.dispatch({ type: "cancel" });
      let parent = card.sourceHolder;
      while (parent && parent !== session.state.armed)
        parent = byId.get(parent)?.sourceHolder;
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
      if (action.opensDraft && action.discardToken !== discardToken())
        throw new Error(
          "This design changed. Review it before opening another draft.",
        );
      const tool = toolMap.get(action.tool);
      if (action.tool && !tool) throw new Error("Choose an available tool.");
      if (tool && session.state.armed) session.dispatch({ type: "cancel" });
      const consent = discardToken();
      return session.run(async (ctx) => {
        const open = (value) => {
          if (
            discardToken() !== consent ||
            (!action.opensDraft && pendingDesign())
          )
            throw new Error(
              "This design changed. Review it before opening another draft.",
            );
          document.activeElement?.blur();
          mode = "world";
          openDraft(value, ctx.open, true);
          workspace.refresh();
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
  function chooseView(view, id) {
    mode = view;
    workspace.refresh();
    workspace.choose(id, { expand: true });
  }
  return {
    open(value) {
      document.activeElement?.blur();
      if (value) {
        mode = "world";
        openDraft(value);
      }
      workspace.open();
      showScene();
    },
    close() {
      document.activeElement?.blur();
      workspace.close();
    },
    refresh() {
      if (!opening) workspace.refresh();
    },
    chooseWorld: () => chooseView("world", WORLD),
    chooseTools: () => chooseView("tools", TOOLS),
    chooseTool(id) {
      readCards();
      const target = projected.locations.get(`designer-tool-${id}`);
      if (!target) throw new Error("Choose an available tool.");
      chooseView(target.mode, target.cardId);
    },
  };
}
