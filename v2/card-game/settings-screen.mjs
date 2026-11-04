// The settings screen (settings-cards.mjs): its hand stands in for the play
// hand while open, drawn as the play hand draws a place and its things: a
// group's first setting peeks out behind it, a tap fans the group open and
// another folds it, and the chosen card's beat borrows the context button.
// The controls behind the cards are the buttons in #menu-dialog, which no
// longer opens.
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
  image.src = imageUrl(logo);
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

// Opening, the play hand's cards fall away and the settings are dealt after
// a beat (`playHand.leave()` gives when); closing deals the play hand back
// (`playHand.back()`). Redraws deal only a setting new to the hand.
export function installSettingsCards({ actionBeat, packs, playHand }) {
  const screen = $("settings-screen"),
    hand = $("settings-hand"),
    entries = createCardEntries(),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let lead = 0;
  let chosen = null,
    fanned = null,
    cards = [],
    armed = null,
    problem = "",
    tip = 0,
    beat = null;
  const changed = () =>
    document.dispatchEvent(new Event("shared-dialog-change"));
  function close() {
    if (!screen.open) return;
    screen.close();
    entries.draw([]);
    playHand?.back();
    chosen = fanned = armed = null;
    actionBeat.clear(beat);
    changed();
    $("toolbar-menu-button")?.focus();
  }
  async function press(action, index) {
    if (action.confirm && armed !== `${chosen}:${index}`) {
      armed = `${chosen}:${index}`;
      return render();
    }
    armed = null;
    problem = "";
    // Playing a setting folds its group back, as a play folds a place;
    // Next tip stays on Controls to show the next tip in place.
    if (!action.stays) chosen = fanned = null;
    if (action.run === "close" || action.closes) close();
    if (action.run === "tip") tip += 1;
    if (action.run === "pack") packs.play(action.pack, action.enable);
    try {
      if (/^[#[]/.test(action.run)) document.querySelector(action.run).click();
      else await runs[action.run]?.(action);
    } catch (error) {
      problem = error.message;
    }
    if (screen.open) render();
  }
  // A group opens as a place does, and folds on a second tap; opening
  // another folds the first. A setting is chosen, and unchosen on a second.
  function choose(id) {
    const group = cards.find((c) => c.id === id)?.group;
    if (group) fanned = fanned === id ? null : id;
    else chosen = chosen === id ? null : id;
    if (cards.find((c) => c.id === chosen)?.holder !== fanned) chosen = null;
    armed = null;
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
    el.append(
      questScreen(
        { kind: "place", target: c.art },
        { url: (src) => imageUrl(src, "card"), place: (src) => src },
      ),
      head,
    );
  }
  // The play hand's card frame: a setting lies hidden in its group until the
  // group fans, and the group's first setting peeks out behind it.
  function frame(c) {
    const el = make("button", "card want-card", {
      type: "button",
      onclick: () => choose(c.id),
    });
    const raised = chosen === c.id || fanned === c.id;
    Object.assign(el.dataset, {
      setting: c.id,
      lit: c.lit,
      selected: chosen === c.id,
    });
    el.setAttribute("aria-pressed", String(raised));
    el.setAttribute("aria-label", [c.name, c.state].filter(Boolean).join(", "));
    placeFace(el, c);
    const holder = make("div", "card-frame");
    holder.dataset.raised = String(raised);
    holder.append(el);
    if (c.holder) {
      holder.dataset.holder = c.holder;
      holder.hidden = fanned !== c.holder;
    }
    const held = cards.filter((item) => item.holder === c.id);
    if (held.length) {
      holder.dataset.inventory = String(held.length);
      holder.dataset.expanded = String(fanned === c.id);
      el.setAttribute("aria-expanded", String(fanned === c.id));
      holder.prepend(
        make("img", "held-preview", {
          src: imageUrl(held[0].art, "card"),
          alt: "",
          decoding: "async",
          draggable: false,
        }),
      );
    }
    return holder;
  }
  function render() {
    cards = settingsCards(readSettings(tip, packs));
    if (!cards.some((c) => c.id === chosen)) chosen = null;
    const focused = document.activeElement?.dataset?.setting;
    hand.replaceChildren(...cards.map(frame));
    // The fan leans each shown card by its place in the row (fanHand).
    const shown = [...hand.children].filter((f) => !f.hidden);
    shown.forEach((f, i) =>
      f.style.setProperty("--fan-at", String(i - (shown.length - 1) / 2)),
    );
    entries.draw(
      [...hand.children].map((f) => ({
        key: `${f.firstElementChild.dataset.setting}@${f.dataset.holder}`,
        element: f,
        still: f.hidden,
      })),
      { reduced: reduced.matches, after: lead },
    );
    lead = 0;
    if (focused) hand.querySelector(`[data-setting="${focused}"]`)?.focus();
    const view = settingsBeat(cards, chosen, armed),
      face = cards.find((c) => c.id === chosen);
    beat = {
      cards: face ? [{ src: imageUrl(face.art, "card"), lit: face.lit }] : [],
      name: view.name,
      info: problem || view.info,
      buttons: view.actions.map((a, i) => ({
        ...{ label: a.label, id: buttonId(chosen, i), disabled: a.disabled },
        run: () => press(a, i),
      })),
    };
    actionBeat.show(beat);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !screen.open) return;
    event.preventDefault();
    if (chosen) choose(chosen);
    else close();
  });
  hostedVoices().subscribe(() => screen.open && render());
  return {
    open() {
      if (!screen.open) {
        lead = playHand?.leave() ?? 0;
        screen.show();
      }
      // You opens fanned, so Privacy is one tap away.
      fanned = "you";
      showVeil();
      changed();
      render();
      hand.querySelector(".card")?.focus();
    },
    close,
  };
}
