const LODGING_FEATURE_KEY = "lodging";
const LODGING_GATE_KINDS = new Set(["open"]);

export function roomFeatureSchemaValidationErrors(feature, label = "room feature") {
  const errors = [];
  const lodging = feature?.lodging;
  const featureKey = String(feature?.key ?? "").trim().toLowerCase();
  if (featureKey !== LODGING_FEATURE_KEY) {
    if (lodging !== undefined) {
      errors.push(`${label} may declare lodging only when key is lodging`);
    }
    return errors;
  }
  if (!lodging || typeof lodging !== "object" || Array.isArray(lodging)) {
    return [`${label} lodging must be an object`];
  }
  const lodgingFields = new Set(["gate"]);
  for (const field of Object.keys(lodging)) {
    if (!lodgingFields.has(field)) {
      errors.push(`${label} lodging has unknown field ${field}`);
    }
  }
  const gate = lodging.gate;
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    errors.push(`${label} lodging gate must be an object`);
    return errors;
  }
  const gateFields = new Set(["kind"]);
  for (const field of Object.keys(gate)) {
    if (!gateFields.has(field)) {
      errors.push(`${label} lodging gate has unknown field ${field}`);
    }
  }
  if (!LODGING_GATE_KINDS.has(gate.kind)) {
    errors.push(`${label} lodging gate kind must be open`);
  }
  return errors;
}
