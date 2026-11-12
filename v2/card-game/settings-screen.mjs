// The settings screen (settings-cards.mjs): its hand stands in for the play
// hand while open, drawn as the play hand draws a place and its things: a
// group's first setting peeks out behind it, a tap fans the group open and
// another folds it, and the chosen card's beat borrows the context button.
// The controls behind the cards are the buttons in #menu-dialog, which no
// longer opens.
import { transparentLogo } from "./title-logo.mjs";
import { imageUrl } from "./images.mjs";
import { hostedVoices } from "./hosted-voices.mjs";
import { localRuntime } from "./local-service.mjs";
import { levelTier } from "./level-tiers.mjs";
import { questScreen } from "./quest-screen.mjs";
import { setCardLabel } from "./card-label.mjs";
import { createCardEntries } from "./card-entry.mjs";
import { passkey, request } from "./shared-auth.mjs";
import {
  PACKS,
  SCENE,
  TOGGLES,
  settingsBeat,
  settingsCards,
} from "./settings-cards.mjs";

const $ = (id) => document.getElementById(id);
const words = (id) =>
  ($(id) && !$(id).hidden && $(id).textContent.trim()) || "";
const open = (href) => window.open(href, "_blank", "noopener");
// While Settings is open the scene fades to black under the world's logo,
// set where the title sets it over its card (style.css; app.mjs fades the
// music). The logo is the one the toolbar shows (title-logo.mjs). Then the
// owner's workbench comes up as Settings' own scene.
function showVeil() {
  const stage = $("stage"),
    logo = document.querySelector(".brand strong")?.dataset.logo;
  let veil = stage.querySelector(".settings-veil");
  if (!veil) {
    veil = Object.assign(document.createElement("div"), {
      className: "settings-veil",
    });
    veil.setAttribute("aria-hidden", "true");
    stage.append(veil);
  }
  const scene = veil.querySelector(".settings-scene") || new Image();
  Object.assign(scene, { alt: "", className: "settings-scene" });
  scene.src = imageUrl(`assets/${SCENE}`);
  if (!logo) return veil.replaceChildren(scene);
  const image = veil.querySelector(".settings-logo") || new Image();
  Object.assign(image, { alt: "", className: "settings-logo" });
  image.src = imageUrl(transparentLogo(logo));
  veil.replaceChildren(image, scene);
}
// Shared play's passkey buttons sit in #menu-dialog by their names.
const named = (text) =>
  [...$("menu-dialog").querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );

function readSettings(tip, packs) {
  const toggles = Object.fromEntries(
    TOGGLES.map(([id, control, , , status]) => {
      const button = $(control);
      const state = button.textContent.split(": ").pop();
      const on = button.getAttribute("aria-pressed") === "true";
      return [
        id,
        { on, state, disabled: button.disabled, info: words(status) },
      ];
    }),
  );
  return {
    toggles,
    tip,
    volume: Number($("music-volume").value),
    hosted: !localRuntime(),
    signedIn: Boolean(hostedVoices().state.signed_in),
    shared: Boolean(named("Sign out")),
    backup: $("local-settings").hidden ? null : words("local-save-status"),
    newGame: !$("new-game").hidden,
    table: words("table-slot"),
    build: words("build-info"),
    packs: Object.fromEntries(
      PACKS.map(([id]) => [id, { on: packs.on(id), block: packs.block(id) }]),
    ),
  };
}

const runs = {
  privacy: () => open("/privacy"),
  download: () => open("/download"),
  volume: ({ value }) => {
    $("music-volume").value = String(value);
    $("music-volume").dispatchEvent(new Event("input"));
  },
  addPasskey: () => named("Add a passkey").click(),
  signIn: async () => {
    await passkey(false);
    location.reload();
  },
  signOut: async () => {
    if (named("Sign out")) return named("Sign out").click();
    await request("/auth/logout", {});
    location.reload();
  },
};
// The context button is #setting-<card>, then #setting-<card>-1.
const buttonId = (card, i) => `setting-${card || "close"}${i ? `-${i}` : ""}`;
let activeWorkspace = null;

export function installSettingsCards({ actionBeat, packs, playHand }) {
  let tip = 0;
  const workspace = installCardWorkspace({
    actionBeat,
    playHand,
    label: "Settings",
    initialGroup: "you",
    cards: () => settingsCards(readSettings(tip, packs)),
    describe: settingsBeat,
    async run(action) {
      if (action.run === "tip") tip += 1;
      if (action.run === "pack") packs.play(action.pack, action.enable);
      if (/^[#[]/.test(action.run)) document.querySelector(action.run).click();
      else await runs[action.run]?.(action);
    },
    onClose: () => $("toolbar-menu-button")?.focus(),
  });
  hostedVoices().subscribe(workspace.refresh);
  return workspace;
}

// Opening, the play hand's cards fall away and the settings are dealt after
// a beat (`playHand.leave()` gives when); closing deals the play hand back
// (`playHand.back()`). Redraws deal only a setting new to the hand.
// cards() supplies {id, name, art, lit, state, group?, holder?} records.
// describe(cards, chosen, armed) supplies {name, info, note?, actions}; run
// receives the action and {cardId}. Actions may stay selected or ask for a
// second press through their existing stays and confirm fields.
// Optional layout(cards,{expanded,active}) returns {nodes:[{id}],place(screen)}.
// Nodes name viewport-visible cards; the callback filters phone branches.
// Only those nodes get frames. onSelect/selected/onCancel connect a controller;
// public choose(id) selects a card, while focus(id) only moves keyboard focus.
export function installCardWorkspace({
  actionBeat,
  playHand,
  cards: readCards,
  describe,
  run,
  onClose = () => {},
  label = "Settings",
  initialGroup = null,
  layout = null,
  onSelect = () => {},
  selected = null,
  onCancel = () => false,
}) {
  const screen = $("settings-screen"),
    hand = $("settings-hand"),
    entries = createCardEntries(),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const expanded = new Set(),
    frames = new Map();
  let lead = 0,
    generation = 0;
  let chosen = null,
    fanned = null,
    cards = [],
    armed = null,
    armedAt = 0,
    dealt = "",
    problem = "",
    beat = null;
  const changed = () =>
    document.dispatchEvent(new Event("shared-dialog-change"));
  function close() {
    if (activeWorkspace !== workspace) return;
    generation++;
    problem = "";
    activeWorkspace = null;
    screen.close();
    entries.draw([]);
    playHand?.back();
    chosen = fanned = armed = null;
    dealt = "";
    expanded.clear();
    frames.clear();
    if (layout) hand.replaceChildren();
    delete screen.dataset.layout;
    delete screen.dataset.held;
    actionBeat.clear(beat);
    changed();
    onClose();
  }
  async function press(action, index) {
    const mine = generation;
    if (action.confirm && armed !== `${chosen}:${index}`) {
      armed = `${chosen}:${index}`;
      armedAt = performance.now();
      return render();
    }
    // A second tap in the same gesture has not seen the "Tap again" label.
    if (action.confirm && layout && performance.now() - armedAt < 400) return;
    armed = null;
    problem = "";
    const cardId = chosen;
    // Playing a setting folds its group back, as a play folds a place;
    // Next tip stays on Controls to show the next tip in place.
    if (!action.stays && !layout) chosen = fanned = null;
    if (action.run === "close" || action.closes) close();
    try {
      await run(action, { cardId });
    } catch (error) {
      if (mine === generation) problem = error.message;
    }
    // Closing ends this opening's presentation ownership, not its operation.
    // A late result must not redraw or report an error in a reopened view.
    if (mine === generation) workspace.refresh();
  }
  // A group opens as a place does, and folds on a second tap; opening
  // another folds the first. A setting is chosen, and unchosen on a second.
  function choose(id, { expand = false } = {}) {
    armed = null;
    if (layout) {
      const card = cards.find((c) => c.id === id);
      if (!card) return;
      const parents = new Set();
      let parent = card.holder;
      while (parent && !parents.has(parent)) {
        parents.add(parent);
        expanded.add(parent);
        parent = cards.find((c) => c.id === parent)?.holder;
      }
      if (card.group) {
        if (!expand && expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
      }
      chosen = id;
      onSelect(id);
      problem = "";
      render();
      return workspace.focus(id);
    }
    const group = cards.find((c) => c.id === id)?.group;
    if (group) fanned = fanned === id ? null : id;
    else {
      chosen = chosen === id ? null : id;
      if (chosen) fanned = cards.find((c) => c.id === chosen)?.holder ?? null;
    }
    if ((cards.find((c) => c.id === chosen)?.holder ?? null) !== fanned)
      chosen = null;
    problem = "";
    render();
    // An opened group starts the row, so its settings fan into view.
    if (group && fanned)
      hand
        .querySelector(`[data-setting="${id}"]`)
        .parentElement.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
          block: "nearest",
          inline: "start",
        });
  }
  const make = (tag, className, props) =>
    Object.assign(document.createElement(tag), { className, ...props });
  // Each card (a group, a world pack or a workbench painting) is the quest
  // card's place: its painting feathered into the card, with its name where
  // the quest names its verb.
  function placeFace(el, c) {
    el.style.setProperty("--tier-color", levelTier(0).color);
    const head = make("span", "quest-head");
    head.append(setCardLabel(make("span", "quest-verb"), c.name));
    const face = questScreen(
      c.kind === "avatar"
        ? { kind: "place", actor: c.art }
        : { kind: c.kind === "item" ? "item" : "place", target: c.art },
      {
        url: (src) => imageUrl(src, "card"),
        place: (src) => src,
        portrait: (src) => src,
        thing: (src) => src,
      },
    );
    if (c.kind) {
      face.className = "art";
      face.dataset.kind = c.kind;
      for (const image of face.children) image.className = "";
    }
    el.append(face, head);
  }
  // The play hand's card frame: a setting lies hidden in its group until the
  // group fans, and the group's first setting peeks out behind it.
  function frame(c) {
    const el = make("button", "card want-card", {
      type: "button",
      onclick: () => choose(c.id),
    });
    el.dataset.setting = c.id;
    const holder = make("div", "card-frame");
    holder.append(el);
    updateFrame(holder, c);
    return holder;
  }
  function updateFrame(holder, c) {
    const el = holder.querySelector(".card");
    const picked = selected ? selected().includes(c.id) : chosen === c.id;
    const open = layout ? expanded.has(c.id) : fanned === c.id;
    const face = JSON.stringify([c.kind, c.art]);
    if (holder.dataset.face !== face) {
      el.replaceChildren();
      placeFace(el, c);
      holder.dataset.face = face;
    }
    const label = el.querySelector(".quest-verb");
    if (label.textContent !== c.name) setCardLabel(label, c.name);
    Object.assign(el.dataset, { lit: c.lit, selected: picked });
    holder.dataset.raised = String(picked || open);
    el.setAttribute("aria-pressed", String(picked || open));
    el.setAttribute("aria-label", [c.name, c.state].filter(Boolean).join(", "));
    el.classList.toggle("item", c.kind === "item");
    holder.hidden = !layout && Boolean(c.holder && fanned !== c.holder);
    if (c.holder) {
      holder.dataset.holder = c.holder;
    } else delete holder.dataset.holder;
    const held = cards.filter((item) => item.holder === c.id);
    let preview = holder.querySelector(".held-preview");
    if (held.length) {
      holder.dataset.inventory = String(held.length);
      holder.dataset.expanded = String(open);
      el.setAttribute("aria-expanded", String(open));
      if (!preview && !layout) {
        preview = make("img", "held-preview", {
          alt: "",
          decoding: "async",
          draggable: false,
        });
        holder.prepend(preview);
      }
      if (preview) {
        const src = imageUrl(held[0].art, "card");
        if (preview.getAttribute("src") !== src) preview.src = src;
      }
    } else {
      preview?.remove();
      delete holder.dataset.inventory;
      delete holder.dataset.expanded;
      el.removeAttribute("aria-expanded");
    }
  }
  // A new deal starts from the table's left edge with the top stack in view,
  // then lowers the hand clear of the bar only as far as the top stack allows;
  // the chosen card stays in view sideways. A plain refresh leaves scroll alone.
  function settle(nodes) {
    const key = nodes.map((node) => `${node.id}:${node.zone}`).join();
    if (key === dealt) return;
    dealt = key;
    hand.scrollTo(0, 0);
    const shown = [...hand.children].filter((f) => !f.hidden);
    const area = hand.getBoundingClientRect();
    const room = area.bottom - 12;
    const lowest = Math.max(
      ...shown
        .filter((f) => f.dataset.zone === "hand")
        .map((f) => f.getBoundingClientRect().bottom),
    );
    const top = Math.min(...shown.map((f) => f.getBoundingClientRect().top));
    if (lowest > room)
      hand.scrollTop = Math.max(0, Math.min(lowest - room, top));
    const mine = hand
      .querySelector(`[data-setting="${chosen}"]`)
      ?.closest(".card-frame")
      ?.getBoundingClientRect();
    if (mine && mine.right > area.right)
      hand.scrollLeft = mine.right - area.right + 12;
    else if (mine && mine.left < area.left)
      hand.scrollLeft = mine.left - area.left - 12;
  }
  function render() {
    cards = readCards();
    if (!cards.some((c) => c.id === chosen)) chosen = null;
    const focused = document.activeElement?.dataset?.setting;
    const tree = layout?.(cards, {
      expanded: [...expanded],
      active: chosen ?? fanned,
    });
    if (tree) {
      if (!frames.size) hand.replaceChildren();
      const ids = new Set(tree.nodes.map((node) => node.id));
      for (const [id, holder] of frames)
        if (!ids.has(id)) {
          holder.remove();
          frames.delete(id);
        }
      let at = 0;
      for (const c of cards.filter((c) => ids.has(c.id))) {
        let holder = frames.get(c.id);
        if (!holder) frames.set(c.id, (holder = frame(c)));
        else updateFrame(holder, c);
        if (hand.children[at] !== holder)
          hand.insertBefore(holder, hand.children[at] || null);
        at++;
      }
      tree.place?.(screen);
    } else hand.replaceChildren(...cards.map(frame));
    // The fan leans each shown card by its place in the row (fanHand).
    const shown = [...hand.children].filter((f) => !f.hidden);
    shown.forEach((f, i) =>
      f.style.setProperty("--fan-at", String(i - (shown.length - 1) / 2)),
    );
    entries.draw(
      [...hand.children].map((f) => ({
        key: `${f.querySelector(".card").dataset.setting}@${f.dataset.holder}`,
        element: f,
        still: f.hidden,
      })),
      { reduced: reduced.matches, after: lead },
    );
    lead = 0;
    if (tree && screen.dataset.makerHand) settle(tree.nodes);
    if (focused)
      hand
        .querySelector(`[data-setting="${focused}"]`)
        ?.focus({ preventScroll: Boolean(screen.dataset.makerHand) });
    const view = describe(cards, chosen, armed),
      face = cards.find((c) => c.id === chosen);
    beat = {
      cards:
        view.cards ??
        (face ? [{ src: imageUrl(face.art, "card"), lit: face.lit }] : []),
      name: view.name,
      info: problem || view.info,
      note: view.note,
      edit: view.edit,
      buttons: view.actions.map((a, i) => ({
        ...{ label: a.label, id: buttonId(chosen, i), disabled: a.disabled },
        destructive: Boolean(a.destructive && a.armed),
        run: () => press(a, i),
      })),
    };
    actionBeat.show(beat);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || activeWorkspace !== workspace) return;
    event.preventDefault();
    armed = null;
    if (layout && onCancel()) return render();
    if (layout && chosen) {
      expanded.delete(chosen);
      chosen = cards.find((c) => c.id === chosen)?.holder ?? null;
      render();
      return workspace.focus(chosen);
    }
    if (chosen) choose(chosen);
    else close();
  });
  hand.addEventListener("keydown", (event) => {
    if (activeWorkspace !== workspace || !layout) return;
    const id = event.target.closest("[data-setting]")?.dataset.setting;
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const siblings = cards.filter(
      (c) => c.holder === card.holder && frames.has(c.id),
    );
    const index = siblings.indexOf(card);
    const next =
      event.key === "ArrowLeft"
        ? siblings[index - 1]?.id
        : event.key === "ArrowRight"
          ? siblings[index + 1]?.id
          : event.key === "ArrowUp"
            ? card.holder
            : event.key === "ArrowDown"
              ? cards.find((c) => c.holder === id && frames.has(c.id))?.id
              : null;
    if (next) {
      event.preventDefault();
      workspace.focus(next);
    }
  });
  const workspace = {
    open() {
      if (activeWorkspace !== workspace) activeWorkspace?.close();
      activeWorkspace = workspace;
      if (!screen.open) {
        lead = playHand?.leave() ?? 0;
        screen.show();
      }
      screen.setAttribute("aria-label", label);
      fanned = initialGroup;
      if (initialGroup) expanded.add(initialGroup);
      showVeil();
      changed();
      render();
      hand.querySelector(".card")?.focus();
    },
    close,
    choose,
    get chosen() {
      return chosen;
    },
    focus(id = chosen) {
      const card = hand.querySelector(id ? `[data-setting="${id}"]` : ".card");
      if (!screen.dataset.makerHand) return card?.focus();
      // The deal already placed the view; only a card out of sight scrolls.
      card?.focus({ preventScroll: true });
      const at = card?.getBoundingClientRect();
      const area = hand.getBoundingClientRect();
      if (
        at &&
        (at.bottom < area.top ||
          at.top > area.bottom ||
          at.right < area.left ||
          at.left > area.right)
      )
        card.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    refresh() {
      if (activeWorkspace === workspace) render();
    },
  };
  return workspace;
}
