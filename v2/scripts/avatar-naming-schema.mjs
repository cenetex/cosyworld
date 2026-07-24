export const AVATAR_NAMING_STRATEGY = "culture-grammar/1";

const namingIdPattern = /^[a-z][a-z0-9_]{0,31}$/;
const selectorIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const nameComponentPattern = /^[A-Za-z][A-Za-z'-]{0,15}$/;
const generatedNamePattern = /^[A-Za-z](?:[A-Za-z '-]*[A-Za-z])?$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unexpectedFields(value, allowedFields, label, errors) {
  if (!isObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field))
      errors.push(`${label} contains unknown field ${field}`);
  }
}

export function avatarNamingValidationErrors(config, label = "avatar_naming") {
  const errors = [];
  if (!isObject(config)) {
    return [`${label} must be an object`];
  }

  unexpectedFields(
    config,
    new Set(["strategy", "default_culture", "cultures"]),
    label,
    errors,
  );
  if (config.strategy !== AVATAR_NAMING_STRATEGY) {
    errors.push(`${label} strategy must be ${AVATAR_NAMING_STRATEGY}`);
  }
  if (
    typeof config.default_culture !== "string" ||
    !namingIdPattern.test(config.default_culture)
  ) {
    errors.push(`${label} default_culture must be a naming id`);
  }
  if (
    !Array.isArray(config.cultures) ||
    config.cultures.length < 1 ||
    config.cultures.length > 32
  ) {
    errors.push(`${label} must contain between 1 and 32 cultures`);
    return errors;
  }

  const cultureIds = new Set();
  for (const [cultureIndex, culture] of config.cultures.entries()) {
    const cultureLabel = `${label} culture ${
      isObject(culture) && typeof culture.id === "string"
        ? culture.id
        : cultureIndex
    }`;
    if (!isObject(culture)) {
      errors.push(`${label} culture must be an object`);
      continue;
    }
    unexpectedFields(
      culture,
      new Set(["id", "style_prompt", "selectors", "forms", "pools"]),
      cultureLabel,
      errors,
    );

    if (
      typeof culture.id !== "string" ||
      !namingIdPattern.test(culture.id) ||
      cultureIds.has(culture.id.toLowerCase())
    ) {
      errors.push(`${label} contains an invalid or duplicate culture id`);
    } else {
      cultureIds.add(culture.id.toLowerCase());
    }
    if (
      typeof culture.style_prompt !== "string" ||
      culture.style_prompt.trim().length < 12 ||
      culture.style_prompt.length > 240 ||
      /[\u0000-\u001f\u007f]/.test(culture.style_prompt)
    ) {
      errors.push(`${cultureLabel} has an invalid style_prompt`);
    }

    const selectors = culture.selectors ?? {};
    if (!isObject(selectors)) {
      errors.push(`${cultureLabel} selectors must be an object`);
    } else {
      const selectorFields = new Set([
        "profile_ids",
        "species_ids",
        "origin_ids",
      ]);
      unexpectedFields(
        selectors,
        selectorFields,
        `${cultureLabel} selectors`,
        errors,
      );
      for (const field of selectorFields) {
        const values = selectors[field] ?? [];
        if (
          !Array.isArray(values) ||
          values.length > 64 ||
          !values.every(
            (value) =>
              typeof value === "string" && selectorIdPattern.test(value),
          ) ||
          new Set(values.map((value) => value.toLowerCase())).size !==
            values.length
        ) {
          errors.push(`${cultureLabel} has invalid ${field}`);
        }
      }
    }

    let pools = {};
    if (!isObject(culture.pools)) {
      errors.push(`${cultureLabel} pools must be an object`);
    } else {
      pools = culture.pools;
      const poolEntries = Object.entries(pools);
      if (poolEntries.length < 1 || poolEntries.length > 32) {
        errors.push(`${cultureLabel} must contain between 1 and 32 pools`);
      }
      for (const [poolId, values] of poolEntries) {
        if (
          !namingIdPattern.test(poolId) ||
          !Array.isArray(values) ||
          values.length < 2 ||
          values.length > 256
        ) {
          errors.push(`${cultureLabel} has invalid pool ${poolId}`);
          continue;
        }
        if (
          !values.every(
            (value) =>
              typeof value === "string" && nameComponentPattern.test(value),
          )
        ) {
          errors.push(`${cultureLabel} pool ${poolId} has invalid entries`);
        } else if (
          new Set(values.map((value) => value.toLowerCase())).size !==
          values.length
        ) {
          errors.push(`${cultureLabel} pool ${poolId} contains duplicates`);
        }
      }
    }

    if (
      !Array.isArray(culture.forms) ||
      culture.forms.length < 1 ||
      culture.forms.length > 16
    ) {
      errors.push(`${cultureLabel} must contain between 1 and 16 forms`);
      continue;
    }
    for (const form of culture.forms) {
      if (!isObject(form)) {
        errors.push(`${cultureLabel} form must be an object`);
        continue;
      }
      unexpectedFields(
        form,
        new Set(["pattern", "weight"]),
        `${cultureLabel} form`,
        errors,
      );
      if (
        typeof form.pattern !== "string" ||
        form.pattern.length < 1 ||
        form.pattern.length > 80 ||
        !Number.isInteger(form.weight) ||
        form.weight < 1 ||
        form.weight > 16
      ) {
        errors.push(`${cultureLabel} has an invalid naming form`);
        continue;
      }

      const literal = form.pattern.replace(/\{[a-z][a-z0-9_]{0,31}\}/g, "");
      const placeholders = [
        ...form.pattern.matchAll(/\{([a-z][a-z0-9_]{0,31})\}/g),
      ].map((match) => match[1]);
      if (
        placeholders.length === 0 ||
        /[{}]/.test(literal) ||
        !/^[A-Za-z '-]*$/.test(literal) ||
        placeholders.some((poolId) => !Object.hasOwn(pools, poolId))
      ) {
        errors.push(
          `${cultureLabel} form has invalid text or references an unknown pool`,
        );
        continue;
      }

      let shortest = form.pattern;
      let longest = form.pattern;
      for (const poolId of new Set(placeholders)) {
        const values = pools[poolId];
        if (
          !Array.isArray(values) ||
          values.some((value) => typeof value !== "string") ||
          values.length === 0
        ) {
          continue;
        }
        const ordered = [...values].sort(
          (left, right) => left.length - right.length,
        );
        shortest = shortest.replaceAll(`{${poolId}}`, ordered[0]);
        longest = longest.replaceAll(`{${poolId}}`, ordered.at(-1));
      }
      if (
        shortest.length > 28 ||
        longest.length > 28 ||
        !generatedNamePattern.test(shortest) ||
        !generatedNamePattern.test(longest) ||
        shortest.includes("  ") ||
        longest.includes("  ")
      ) {
        errors.push(`${cultureLabel} form can exceed the avatar name contract`);
      }
    }
  }

  if (
    typeof config.default_culture === "string" &&
    !cultureIds.has(config.default_culture.toLowerCase())
  ) {
    errors.push(`${label} default_culture does not exist`);
  }
  return errors;
}

export function assertAvatarNamingConfig(config, label = "avatar_naming") {
  const errors = avatarNamingValidationErrors(config, label);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return config;
}
