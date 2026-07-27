export const LANTERN_KEEPER_PACK_ID = "cosyworld.campaign.the-lantern-keeper";
export const LANTERN_KEEPER_JOB_ID = "lantern-keeper:rekindle-the-beacon";

export const LANTERN_CLOCK_OUTCOMES = new Map([
  ["lantern-keeper.light", "completed"],
  ["lantern-keeper.darkness", "failed"],
]);

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function lanternClockEffectValidationErrors({
  clocks = [],
  lifecycleHooks = [],
  packs = [],
} = {}) {
  if (!packs.some((pack) => pack?.id === LANTERN_KEEPER_PACK_ID)) {
    return [];
  }

  const errors = [];
  for (const [clockId, expectedStatus] of LANTERN_CLOCK_OUTCOMES) {
    const clock = clocks.find((candidate) => candidate?.id === clockId);
    if (!clock) {
      errors.push(`Lantern Keeper pack is missing clock ${clockId}`);
      continue;
    }
    if (!Array.isArray(clock.on_fill) || clock.on_fill.length === 0) {
      errors.push(`clock ${clockId} must directly declare a justified on_fill consequence`);
      continue;
    }
    for (const effect of clock.on_fill) {
      if (!nonEmpty(effect?.reason)) {
        errors.push(`clock ${clockId} on_fill effect ${effect?.op ?? "unknown"} must declare reason`);
      }
    }
    const authoritative = clock.on_fill.filter((effect) => effect?.op !== "set_tag");
    if (authoritative.length === 0) {
      errors.push(`clock ${clockId} on_fill cannot be tag-only`);
      continue;
    }
    if (
      authoritative.length !== 1
      || authoritative[0]?.op !== "set_job_status"
      || authoritative[0]?.job_id !== LANTERN_KEEPER_JOB_ID
      || authoritative[0]?.status !== expectedStatus
    ) {
      errors.push(
        `clock ${clockId} must declare exactly one authoritative set_job_status consequence for ${LANTERN_KEEPER_JOB_ID}:${expectedStatus}`,
      );
    }
  }

  for (const hook of lifecycleHooks) {
    if (
      hook?.hook === "on_clock_fill"
      && hook?.target_kind === "clock"
      && LANTERN_CLOCK_OUTCOMES.has(hook?.target_id)
    ) {
      errors.push(
        `clock ${hook.target_id} must use direct on_fill as its sole authoritative consequence source`,
      );
    }
  }
  return errors;
}
