import titleLogos from "./title-logos.json" with { type: "json" };
import landings from "./pack-landings.json" with { type: "json" };
import { imageUrl } from "./images.mjs";

// Each world shows one Lonely Forest logo from `title-logos.json`, in its
// title and in the toolbar. The first pick for a world comes from its id;
// a new world never repeats the logo shown last when another one exists.
// The browser remembers the pick, so a reload shows the same logo.
export const LOGOS = titleLogos.logos;
export const LOGO_KEY = "cosyworld.title-logo";
const REMEMBERED = 40;

// The world this address opens, as app.mjs resolves its save.
export function worldLogoKey(href) {
  const params = new URL(href).searchParams;
  const world = params.get("world");
  if (world) return `world:${world}`;
  const table = params.get("table");
  if (table && /^[a-z0-9-]{1,40}$/i.test(table)) return `table:${table}`;
  const pack = params.get("pack");
  if (pack) return `pack:${pack}`;
  return "local";
}

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const valid = (index, count) =>
  Number.isInteger(index) && index >= 0 && index < count;

// The logo index for a world, given what this browser showed before.
export function chooseLogo(key, memory = {}, count = LOGOS.length) {
  const known = memory.worlds?.[key];
  if (valid(known, count)) return known;
  const index = hash(key) % count;
  return count > 1 && index === memory.last ? (index + 1) % count : index;
}

export function rememberLogo(memory = {}, key, index) {
  const worlds = { ...memory.worlds };
  delete worlds[key];
  worlds[key] = index;
  const keys = Object.keys(worlds);
  for (const old of keys.slice(0, Math.max(0, keys.length - REMEMBERED)))
    delete worlds[old];
  return { last: index, worlds };
}

// Only Lonely Forest shows its logos: other sites' landings and the local
// CosyWorld app keep the COSYWORLD wordmark.
export const logoSite = ({ href, local }) =>
  !local && !landings[new URL(href).hostname];

// Reads and records the pick; `fresh` starts the address's world anew.
export function worldLogo({ href, storage, fresh = false }) {
  const key = worldLogoKey(href);
  let memory = {};
  try {
    memory = JSON.parse(storage?.getItem(LOGO_KEY) || "{}") || {};
  } catch {}
  if (fresh && memory.worlds) {
    memory = { ...memory, worlds: { ...memory.worlds } };
    delete memory.worlds[key];
  }
  const index = chooseLogo(key, memory);
  try {
    storage?.setItem(
      LOGO_KEY,
      JSON.stringify(rememberLogo(memory, key, index)),
    );
  } catch {}
  return LOGOS[index];
}

// The logo the toolbar shows for a world's logo. A wide artwork whose
// lettering is too small at toolbar height names a wordmark (`toolbar`, an
// index into LOGOS) to stand in for it there.
export function toolbarLogo(logo) {
  return (Number.isInteger(logo?.toolbar) && LOGOS[logo.toolbar]) || logo;
}

// The toolbar wordmark becomes the world's logo, a plain image named by its
// alt text.
export function showToolbarLogo(chosen, root = document) {
  const mark = root.querySelector(".brand strong");
  const logo = toolbarLogo(chosen);
  if (!mark || !logo) return;
  let image = mark.querySelector("img.brand-logo");
  if (!image) {
    image = root.createElement("img");
    image.className = "brand-logo";
    image.decoding = "async";
    mark.replaceChildren(image);
  }
  image.alt = logo.name;
  image.width = logo.width;
  image.height = logo.height;
  image.src = imageUrl(logo.src, "card");
  mark.dataset.logo = logo.src;
}
