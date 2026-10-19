import { chooseOpening } from "./awakening-world.mjs";

let storage;
try {
  storage = window.localStorage;
} catch {}
const opening = chooseOpening(window.location.search, storage);
await import(opening === "shore" ? "./app.mjs" : "./awakening.mjs");
