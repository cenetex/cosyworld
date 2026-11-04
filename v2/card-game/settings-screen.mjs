// The settings screen (settings-cards.mjs): its hand stands in for the play
// hand while open, and the chosen card's beat borrows the context button.
// The controls behind the cards are the buttons in #menu-dialog, which no
// longer opens.
import { imageUrl } from "./images.mjs";
import { playerCredits } from "./credits.mjs";
import { localRuntime } from "./local-service.mjs";
import { levelTier } from "./level-tiers.mjs";
import { questScreen } from "./quest-screen.mjs";
import { setCardLabel } from "./card-label.mjs";
import { passkey, request } from "./shared-auth.mjs";
import { TOGGLES, settingsBeat, settingsCards } from "./settings-cards.mjs";

const $ = (id) => document.getElementById(id);
const words = (id) =>
  ($(id) && !$(id).hidden && $(id).textContent.trim()) || "";
const open = (href) => window.open(href, "_blank", "noopener");
// While Settings is open the scene fades to black under the world's logo,
// set where the title sets it over its card (style.css; app.mjs fades the
// music). The logo is the one the toolbar shows (title-logo.mjs).
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
  if (!logo) return veil.replaceChildren();
  const image = veil.querySelector("img") || document.createElement("img");
  Object.assign(image, { alt: "", decoding: "async", src: imageUrl(logo) });
  veil.replaceChildren(image);
}
// Shared play's passkey buttons sit in #menu-dialog by their names.
const named = (text) =>
  [...$("menu-dialog").querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );

function readSettings(tip) {
  const credits = playerCredits().state;
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
    signedIn: Boolean(credits.signed_in),
    shared: Boolean(named("Sign out")),
    credits: words("credits-status"),
    checkout: !$("buy-speech-pack").hidden,
    pool: $("credit-pool").hidden ? null : words("credit-pool-status"),
    balance: credits.balance ?? 0,
    backup: $("local-settings").hidden ? null : words("local-save-status"),
    newGame: !$("new-game").hidden,
    table: words("table-slot"),
    build: words("build-info"),
  };
}

const runs = {
  privacy: () => open("/privacy"),
  download: () => open("/download"),
  speechPack: () => open($("speech-pack").href),
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

export function installSettingsCards({ actionBeat }) {
  const screen = $("settings-screen"),
    hand = $("settings-hand");
  let chosen = null,
    armed = null,
    problem = "",
    tip = 0,
    beat = null;
  const changed = () =>
    document.dispatchEvent(new Event("shared-dialog-change"));
  function close() {
    if (!screen.open) return;
    screen.close();
    chosen = armed = null;
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
    if (action.run === "close" || action.closes) close();
    if (action.run === "tip") tip += 1;
    try {
      if (/^[#[]/.test(action.run)) document.querySelector(action.run).click();
      else await runs[action.run]?.(action);
    } catch (error) {
      problem = error.message;
    }
    if (screen.open) render();
  }
  function choose(id) {
    chosen = chosen === id ? null : id;
    armed = null;
    problem = "";
    render();
  }
  const make = (tag, className, props) =>
    Object.assign(document.createElement(tag), { className, ...props });
  // A place card (a world pack or a workbench painting) is the quest card's
  // place: its painting feathered into the card, with its name where the
  // quest names its verb.
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
  function frame(c, index, count) {
    const el = make("button", c.place ? "card want-card" : "card item", {
      type: "button",
      onclick: () => choose(c.id),
    });
    Object.assign(el.dataset, {
      setting: c.id,
      lit: c.lit,
      selected: chosen === c.id,
    });
    el.setAttribute("aria-pressed", String(chosen === c.id));
    el.setAttribute("aria-label", [c.name, c.state].filter(Boolean).join(", "));
    if (c.place) placeFace(el, c);
    else {
      const art = make("span", "art");
      art.append(
        make("img", "", {
          src: imageUrl(c.art, "card"),
          alt: "",
          draggable: false,
        }),
      );
      el.append(art, setCardLabel(make("span", "name"), c.name));
    }
    const holder = make("div", "card-frame");
    holder.style.setProperty("--fan-at", String(index - (count - 1) / 2));
    holder.append(el);
    return holder;
  }
  function render() {
    const cards = settingsCards(readSettings(tip));
    if (!cards.some((c) => c.id === chosen)) chosen = null;
    const focused = document.activeElement?.dataset?.setting;
    hand.replaceChildren(...cards.map((c, i) => frame(c, i, cards.length)));
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
  playerCredits().subscribe(() => screen.open && render());
  return {
    open() {
      if (!screen.open) screen.show();
      showVeil();
      changed();
      render();
      hand.querySelector(".card")?.focus();
    },
    close,
  };
}
