import { buildAuthoringTree } from "./authoring-tree.mjs";
import { sourceEdit } from "./authoring-edits.mjs";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const identity = new Set([
  "id",
  "namespace",
  "packId",
  "schemaVersion",
  "kind",
  "type",
]);
const collections = new Set(["places", "avatars", "items", "transports"]);
const labels = {
  live: "live conditions",
  oneWay: "one-way travel",
  waitAtHome: "return to authored home",
};
const numberText = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

// A field snapshot captures the value shown to the writer. Later saves check
// this value again and patch only its exact source path.
export function authoringField(source, card) {
  if (card?.role !== "field" || card.group || !Object.hasOwn(card, "value"))
    return null;
  const current = buildAuthoringTree(source).cards.find(
    (entry) => entry.id === card.id,
  );
  need(
    current?.role === "field" &&
      Object.hasOwn(current, "value") &&
      JSON.stringify(current.source) === JSON.stringify(card.source) &&
      Object.is(current.value, card.value),
    "This field changed. Open its current card.",
  );
  const path = [...current.source],
    value = current.value;
  const type = value === null ? "null" : typeof value;
  if (!["string", "number", "boolean", "null"].includes(type)) return null;
  const name = path.findLast((part) => typeof part === "string");
  const hidden = path.some(
    (part, i) =>
      typeof part === "string" &&
      !collections.has(path[i - 1]) &&
      /prompt|model|provider|generation/iu.test(part),
  );
  const referenceList =
    typeof path.at(-1) === "number" && ["path", "topics"].includes(name);
  const editable =
    !hidden &&
    !identity.has(name) &&
    !referenceList &&
    type !== "null" &&
    (type !== "number" || Number.isFinite(value));
  const label = labels[name] || current.name;
  return {
    key: current.id,
    path,
    label,
    type,
    editable,
    hidden,
    ...(hidden ? {} : { value }),
    text: hidden ? "" : String(value),
    action:
      type === "boolean"
        ? `${value ? "Disable" : "Enable"} ${label}`
        : `Save ${label}`,
    ...(!editable
      ? {
          reason: hidden
            ? "Generated internally."
            : "This field keeps its authored identity, type or reference.",
        }
      : {}),
  };
}

export function authoringFieldEdit(source, field, input) {
  need(field?.editable, field?.reason || "Choose an editable field.");
  const current = authoringField(source, {
    id: field.key,
    source: field.path,
    role: "field",
    value: field.value,
  });
  need(current?.editable, current?.reason || "Choose an editable field.");
  let value;
  if (current.type === "boolean") {
    need(input === undefined, "Use this field's Enable or Disable action.");
    value = !current.value;
  } else {
    need(typeof input === "string", "Enter this field as text.");
    value = input;
    if (current.type === "number") {
      const text = input.trim();
      need(
        numberText.test(text),
        "Enter a decimal number, such as -2, 0.5 or 1e3.",
      );
      value = Number(text);
      need(
        Number.isFinite(value) &&
          !Object.is(value, -0) &&
          (value !== 0 || !/[1-9]/u.test(text.split(/[eE]/u)[0])),
        "Enter a finite number within the supported range.",
      );
      need(
        !Number.isInteger(current.value) || Number.isSafeInteger(value),
        "Enter a safe whole number for this field.",
      );
    }
  }
  return sourceEdit(source, current.action, [{ path: current.path, value }]);
}
