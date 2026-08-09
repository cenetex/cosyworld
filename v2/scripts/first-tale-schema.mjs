const firstTaleFields = [
  "schema_version",
  "lead_location_id",
  "destination_location_id",
  "job_id",
  "progress_clock_id",
  "copy",
  "continuation",
];

const firstTaleContinuationFields = [
  "destination_location_id",
  "target_actor_id",
  "job_id",
  "travel_instruction",
  "arrival_instruction",
  "accepted_instruction",
];

const firstTaleCopyFields = [
  "question",
  "notice_instruction",
  "follow_lead_instruction",
  "contribute_instruction",
  "complete_instruction",
  "target_label",
  "consequence",
  "completion_memory",
  "next_invitation",
  "public_trace",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownFields(value, allowed) {
  if (!isObject(value)) return [];
  const allowedFields = new Set(allowed);
  return Object.keys(value).filter((field) => !allowedFields.has(field));
}

export function firstTaleValidationErrors(value, label = "first tale") {
  const errors = [];
  if (!isObject(value)) {
    return [`${label} must contain an object`];
  }

  const extraFields = unknownFields(value, firstTaleFields);
  if (extraFields.length > 0) {
    errors.push(`${label} has unknown fields: ${extraFields.join(", ")}`);
  }
  if (value.schema_version !== 1) {
    errors.push(`${label} schema_version must be 1`);
  }
  for (const field of ["lead_location_id", "destination_location_id"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) {
      errors.push(`${label} ${field} must be a positive safe integer`);
    }
  }
  for (const field of ["job_id", "progress_clock_id"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      errors.push(`${label} ${field} must be a non-empty string`);
    }
  }

  if (!isObject(value.copy)) {
    errors.push(`${label} copy must contain an object`);
    return errors;
  }
  const extraCopyFields = unknownFields(value.copy, firstTaleCopyFields);
  if (extraCopyFields.length > 0) {
    errors.push(
      `${label} copy has unknown fields: ${extraCopyFields.join(", ")}`,
    );
  }
  for (const field of firstTaleCopyFields) {
    if (typeof value.copy[field] !== "string" || !value.copy[field].trim()) {
      errors.push(`${label} copy.${field} must be a non-empty string`);
    }
  }
  if (value.continuation !== undefined) {
    if (!isObject(value.continuation)) {
      errors.push(`${label} continuation must contain an object`);
    } else {
      const extraContinuationFields = unknownFields(
        value.continuation,
        firstTaleContinuationFields,
      );
      if (extraContinuationFields.length > 0) {
        errors.push(
          `${label} continuation has unknown fields: ${extraContinuationFields.join(", ")}`,
        );
      }
      for (const field of ["destination_location_id", "target_actor_id"]) {
        if (
          !Number.isSafeInteger(value.continuation[field]) ||
          value.continuation[field] <= 0
        ) {
          errors.push(
            `${label} continuation.${field} must be a positive safe integer`,
          );
        }
      }
      for (const field of [
        "job_id",
        "travel_instruction",
        "arrival_instruction",
        "accepted_instruction",
      ]) {
        if (
          typeof value.continuation[field] !== "string" ||
          !value.continuation[field].trim()
        ) {
          errors.push(
            `${label} continuation.${field} must be a non-empty string`,
          );
        }
      }
    }
  }
  return errors;
}

export function normalizeFirstTaleConfig(value) {
  const normalized = {
    schema_version: value.schema_version,
    lead_location_id: value.lead_location_id,
    destination_location_id: value.destination_location_id,
    job_id: value.job_id.trim(),
    progress_clock_id: value.progress_clock_id.trim(),
    copy: Object.fromEntries(
      firstTaleCopyFields.map((field) => [field, value.copy[field].trim()]),
    ),
  };
  if (value.continuation !== undefined) {
    normalized.continuation = {
      destination_location_id: value.continuation.destination_location_id,
      target_actor_id: value.continuation.target_actor_id,
      job_id: value.continuation.job_id.trim(),
      travel_instruction: value.continuation.travel_instruction.trim(),
      arrival_instruction: value.continuation.arrival_instruction.trim(),
      accepted_instruction: value.continuation.accepted_instruction.trim(),
    };
  }
  return normalized;
}
