// Fills the Privacy page's operator details from privacy.mjs.
import { OPERATOR } from "./privacy.mjs";

for (const field of document.querySelectorAll("[data-operator]")) {
  const value = OPERATOR[field.dataset.operator];
  if (value) field.textContent = value;
}
