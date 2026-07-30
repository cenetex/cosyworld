const EXTENSION = "x-cosyworld-threshold-descriptors";
const DISCOVERY_EXTENSION = "x-cosyworld-discovery-slots";
const SCHEMA_VERSION = 1;
const DESCRIPTOR_VERSION = "threshold-descriptor-v1";
const INTENT_VERSION = "threshold-intent-v1";
const RECEIPT_VERSION = "discovery-receipt-v1";

const canonicalIdPattern = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9-]*\/[a-z][a-z0-9._/-]*$/;
const localIdPattern = /^[a-z][a-z0-9_]{1,63}$/;
const scopes = new Set(["actor", "expedition", "world", "holder"]);
const leadStates = new Set([
  "latent",
  "signed",
  "followable",
  "lost",
  "marked",
  "mapped",
  "resolved",
]);
const legacyLeadStates = new Set(["latent", "sign", "followable", "lost", "marked", "mapped"]);
const targetKinds = new Set([
  "actor",
  "item",
  "feature",
  "route",
  "location",
  "resource",
  "lore",
  "gate",
  "hazard",
  "pressure",
  "lead",
  "anchor",
]);
const transitions = new Set(["open", "unlock", "cross", "unseal", "install", "consume"]);
const resetPolicies = new Set(["never", "manual", "scene_end", "world_tick"]);
const severities = new Set(["minor", "major", "severe"]);
const triggers = new Set([
  "interact",
  "open",
  "cross",
  "search",
  "failed_method",
  "turn",
  "force",
  "remove",
  "make_noise",
  "cast",
]);
const hazardStates = new Set(["armed", "disarmed", "triggered", "spent", "bypassed"]);
const hazardTargetPolicies = new Set([
  "acting_actor",
  "holder",
  "expedition_order",
  "location_occupants",
]);
const hazardConsequencePolicies = new Set(["never", "success", "failure", "always"]);
const predicateKinds = new Set([
  "exact_item",
  "item_capability",
  "installed_item",
  "minimum_charges",
  "actor_tag",
  "clock_status",
  "job_status",
  "minimum_standing",
  "bond_state",
  "access_grant",
  "per_actor_claim",
]);
const effectKinds = new Set([
  "set_gate_state",
  "consume_item_charge",
  "consume_item",
  "set_hazard_state",
  "advance_clock",
  "set_lead_state",
  "set_anchor_state",
  "advance_pressure",
]);
const abilities = new Set([
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function rejectUnknown(errors, value, allowed, label) {
  if (!isObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${label} has unknown field ${field}`);
  }
}

function validCanonicalId(value, packId, kind) {
  if (!canonicalIdPattern.test(value ?? "") || !value.startsWith(`${packId}:`)) return false;
  return kind === undefined || value.startsWith(`${packId}:${kind}/`);
}

function boundedUniqueStrings(value, minimum = 0, maximum = 32, allowed) {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && value.every((entry) => nonEmpty(entry) && (!allowed || allowed.has(entry)))
    && new Set(value).size === value.length;
}

function validateVersionedTarget(errors, target, packId, label, allowedKinds = targetKinds) {
  rejectUnknown(errors, target, new Set(["kind", "id", "version"]), label);
  if (
    !isObject(target)
    || !allowedKinds.has(target.kind)
    || !validCanonicalId(target.id, packId)
    || !Number.isInteger(target.version)
    || target.version < 1
    || target.version > 255
  ) {
    errors.push(`${label} must be a pack-owned, typed, versioned target`);
  }
}

function validatePredicates(errors, requirements, packId, label) {
  rejectUnknown(errors, requirements, new Set(["mode", "clauses"]), label);
  if (!isObject(requirements) || requirements.mode !== "all") {
    errors.push(`${label} must use the non-recursive all mode`);
    return;
  }
  if (
    !Array.isArray(requirements.clauses)
    || requirements.clauses.length > 8
  ) {
    errors.push(`${label} clauses must be a bounded flat array of 0-8 predicates`);
    return;
  }
  for (const [index, clause] of requirements.clauses.entries()) {
    const clauseLabel = `${label} clause ${index}`;
    if (!isObject(clause) || !predicateKinds.has(clause.kind)) {
      errors.push(`${clauseLabel} has an unknown predicate kind`);
      continue;
    }
    const fields = {
      exact_item: ["kind", "item_id"],
      item_capability: ["kind", "capability"],
      installed_item: ["kind", "item_id", "target_id"],
      minimum_charges: ["kind", "item_id", "amount"],
      actor_tag: ["kind", "tag_id"],
      clock_status: ["kind", "clock_id", "status"],
      job_status: ["kind", "job_id", "status"],
      minimum_standing: ["kind", "faction_id", "level"],
      bond_state: ["kind", "actor_id", "state"],
      access_grant: ["kind", "grant_id"],
      per_actor_claim: ["kind", "claim_id"],
    }[clause.kind];
    rejectUnknown(errors, clause, new Set(fields), clauseLabel);
    const idFields = fields.filter((field) => field.endsWith("_id"));
    if (idFields.some((field) => !validCanonicalId(clause[field], packId))) {
      errors.push(`${clauseLabel} ids must be pack-owned canonical ids`);
    }
    if (
      clause.kind === "item_capability"
      && (!nonEmpty(clause.capability) || clause.capability.length > 64)
    ) {
      errors.push(`${clauseLabel} capability must be a bounded authored token`);
    }
    if (
      ["minimum_charges", "minimum_standing"].includes(clause.kind)
      && (!Number.isInteger(clause.amount ?? clause.level)
        || (clause.amount ?? clause.level) < 1
        || (clause.amount ?? clause.level) > 255)
    ) {
      errors.push(`${clauseLabel} threshold must be an integer from 1-255`);
    }
    for (const field of ["status", "state"]) {
      if (fields.includes(field) && (!nonEmpty(clause[field]) || clause[field].length > 32)) {
        errors.push(`${clauseLabel} ${field} must be a bounded authored token`);
      }
    }
  }
}

function validateEffects(errors, effects, packId, knownIds, label) {
  if (!Array.isArray(effects) || effects.length < 1 || effects.length > 8) {
    errors.push(`${label} must contain 1-8 typed effects`);
    return;
  }
  for (const [index, effect] of effects.entries()) {
    const effectLabel = `${label} effect ${index}`;
    if (!isObject(effect) || !effectKinds.has(effect.kind)) {
      errors.push(`${effectLabel} has an unknown effect kind`);
      continue;
    }
    const fields = {
      set_gate_state: ["kind", "target_id", "state"],
      consume_item_charge: ["kind", "target_id", "amount"],
      consume_item: ["kind", "target_id"],
      set_hazard_state: ["kind", "target_id", "state"],
      advance_clock: ["kind", "target_id", "amount"],
      set_lead_state: ["kind", "target_id", "state"],
      set_anchor_state: ["kind", "target_id", "state"],
      advance_pressure: ["kind", "target_id", "track", "amount"],
    }[effect.kind];
    rejectUnknown(errors, effect, new Set(fields), effectLabel);
    if (!validCanonicalId(effect.target_id, packId)) {
      errors.push(`${effectLabel} target_id must be a pack-owned canonical id`);
    } else if (!knownIds.has(effect.target_id)) {
      errors.push(`${effectLabel} references an unknown target`);
    }
    if (
      fields.includes("amount")
      && (!Number.isInteger(effect.amount) || effect.amount < 1 || effect.amount > 255)
    ) {
      errors.push(`${effectLabel} amount must be an integer from 1-255`);
    }
    if (fields.includes("state") && (!nonEmpty(effect.state) || effect.state.length > 32)) {
      errors.push(`${effectLabel} state must be a bounded authored token`);
    }
    if (fields.includes("track") && !["progress", "danger"].includes(effect.track)) {
      errors.push(`${effectLabel} track must be progress or danger`);
    }
  }
}

function discoverySlots(manifest) {
  const slots = manifest?.extensions?.[DISCOVERY_EXTENSION]?.slots ?? [];
  return new Map(slots.map((slot) => [slot.id, slot]));
}

function validateSlotRef(errors, slot, packId, ownerKind, slots, label) {
  rejectUnknown(
    errors,
    slot,
    new Set([
      "source_type",
      "allowed_result_type",
      "slot_id",
      "slot_version",
      "table_id",
      "table_version",
      "claim_policy",
      "receipt_version",
      "receipt_ref",
      "finite_budget",
      "fallback",
      "materialized_ids",
    ]),
    label,
  );
  if (!isObject(slot) || slot.source_type !== ownerKind) {
    errors.push(`${label} source_type must match its ${ownerKind} owner`);
    return;
  }
  const referenced = slots.get(slot.slot_id);
  if (
    !referenced
    || referenced.version !== slot.slot_version
    || referenced.target_kind !== slot.allowed_result_type
  ) {
    errors.push(`${label} must reference a known compatible Discovery Slot and exact version`);
  }
  const stocking = referenced?.stocking;
  if (stocking?.kind === "table") {
    if (
      slot.table_id !== stocking.table_id
      || slot.table_version !== stocking.table_version
    ) {
      errors.push(`${label} must freeze the exact Discovery stocking table version`);
    }
  } else if (slot.table_id !== undefined || slot.table_version !== undefined) {
    errors.push(`${label} fixed Discovery Slot cannot claim a stocking table`);
  }
  if (
    slot.claim_policy !== "once_per_scope"
    || referenced?.claim_policy !== slot.claim_policy
    || slot.receipt_version !== RECEIPT_VERSION
  ) {
    errors.push(`${label} claim and receipt contract is incompatible`);
  }
  if (!validCanonicalId(slot.receipt_ref, packId, "receipt")) {
    errors.push(`${label} receipt_ref must be a pack-owned receipt id`);
  }
  if (
    !Number.isInteger(slot.finite_budget)
    || slot.finite_budget < 1
    || slot.finite_budget > 255
  ) {
    errors.push(`${label} finite_budget must be an integer from 1-255`);
  }
  if (!["deny", "retain_state", "required_result"].includes(slot.fallback)) {
    errors.push(`${label} fallback must be closed and deterministic`);
  }
  if (
    !boundedUniqueStrings(slot.materialized_ids, 0, 8)
    || !slot.materialized_ids.every((id) => validCanonicalId(id, packId))
  ) {
    errors.push(`${label} materialized_ids must be a bounded canonical-id list`);
  }
}

function validateMethod(errors, method, packId, knownIds, recoveries, label) {
  rejectUnknown(
    errors,
    method,
    new Set([
      "id",
      "action",
      "requirements",
      "success_effects",
      "failure_effects",
      "recovery_ref",
      "recovery_version",
      "offer",
    ]),
    label,
  );
  if (!isObject(method) || !localIdPattern.test(method.id ?? "") || !nonEmpty(method.action)) {
    errors.push(`${label} must have a stable id and authored action`);
    return;
  }
  validatePredicates(errors, method.requirements, packId, `${label} requirements`);
  validateEffects(errors, method.success_effects, packId, knownIds, `${label} success_effects`);
  if (method.failure_effects !== undefined) {
    validateEffects(errors, method.failure_effects, packId, knownIds, `${label} failure_effects`);
  }
  if (method.offer !== undefined) {
    const offer = method.offer;
    rejectUnknown(
      errors,
      offer,
      new Set([
        "schema_version",
        "procedure",
        "label",
        "requirement",
        "economy",
        "resolution",
        "effect",
        "consequence",
      ]),
      `${label} offer`,
    );
    rejectUnknown(
      errors,
      offer?.economy,
      new Set(["played_time_turns"]),
      `${label} offer economy`,
    );
    const turns = offer?.economy?.played_time_turns;
    if (
      !isObject(offer)
      || offer.schema_version !== 1
      || offer.procedure !== "open_v1"
      || !nonEmpty(offer.label)
      || offer.label.length > 96
      || !nonEmpty(offer.requirement)
      || offer.requirement.length > 256
      || !nonEmpty(offer.effect)
      || offer.effect.length > 256
      || !nonEmpty(offer.consequence)
      || offer.consequence.length > 256
      || turns !== 1
    ) {
      errors.push(`${label} offer must be a bounded open_v1 method contract`);
    }
    const resolution = offer?.resolution;
    const resolutionKind = resolution?.kind;
    const resolutionFields = {
      certain: ["kind"],
      srd_check: ["kind", "rules_action", "ability", "dc"],
      existing_kernel_outcome: ["kind", "event_type"],
      consequence_avoidance_check: ["kind", "rules_action", "ability", "dc"],
    }[resolutionKind];
    if (!resolutionFields) {
      errors.push(`${label} offer resolution kind is invalid`);
    } else {
      rejectUnknown(
        errors,
        resolution,
        new Set(resolutionFields),
        `${label} offer resolution`,
      );
      if (resolutionKind === "certain") {
        if (method.failure_effects !== undefined) {
          errors.push(`${label} certain resolution cannot author failure effects`);
        }
      } else if (resolutionKind === "existing_kernel_outcome") {
        if (
          resolution.event_type !== "gate.transition.applied"
          || method.failure_effects !== undefined
        ) {
          errors.push(`${label} existing kernel outcome must bind gate.transition.applied`);
        }
      } else if (
        !nonEmpty(resolution.rules_action)
        || resolution.rules_action.length > 96
        || !abilities.has(resolution.ability)
        || !Number.isInteger(resolution.dc)
        || resolution.dc < 1
        || resolution.dc > 32_767
        || method.failure_effects === undefined
      ) {
        errors.push(
          `${label} checked resolution must name an SRD check and a state-changing failure`,
        );
      }
    }
    const exactItem = method.requirements?.clauses?.some(
      (clause) => clause?.kind === "exact_item",
    );
    if (
      exactItem
      && !["certain", "existing_kernel_outcome"].includes(resolutionKind)
    ) {
      errors.push(`${label} exact-item method must be certain`);
    }
    if (exactItem && !String(offer?.consequence || "").toLowerCase().includes("quiet")) {
      errors.push(`${label} exact-item method must explicitly be quiet`);
    }
  }
  if ((method.recovery_ref === undefined) !== (method.recovery_version === undefined)) {
    errors.push(`${label} recovery reference must include an exact version`);
  } else if (method.recovery_ref !== undefined) {
    const recovery = recoveries.get(method.recovery_ref);
    if (!recovery || recovery.version !== method.recovery_version) {
      errors.push(`${label} recovery_ref must resolve at the exact authored version`);
    }
  }
}

function collectKnownIds(config) {
  const ids = new Set();
  const add = (value) => {
    if (nonEmpty(value)) ids.add(value);
  };
  const addTarget = (target) => add(target?.id);
  const addPredicates = (requirements) => {
    for (const clause of requirements?.clauses ?? []) {
      for (const [field, value] of Object.entries(clause)) {
        if (field.endsWith("_id")) add(value);
      }
    }
  };
  const addMethod = (method) => addPredicates(method?.requirements);
  for (const recovery of config.recoveries ?? []) add(recovery?.id);
  for (const anchor of config.anchors ?? []) {
    add(anchor?.id);
    addTarget(anchor?.location_ref);
    for (const target of anchor?.return_chain ?? []) addTarget(target);
    for (const target of anchor?.branch_authorization ?? []) addTarget(target);
  }
  for (const lead of config.leads ?? []) {
    add(lead?.id);
    addTarget(lead?.source_ref);
    addTarget(lead?.target_ref);
    for (const id of lead?.slot?.materialized_ids ?? []) add(id);
  }
  for (const gate of config.gates ?? []) {
    add(gate?.id);
    addTarget(gate?.target_ref);
    addPredicates(gate?.closed_requirements);
    for (const method of gate?.methods ?? []) addMethod(method);
    for (const id of gate?.slot?.materialized_ids ?? []) add(id);
  }
  for (const hazard of config.hazards ?? []) {
    add(hazard?.id);
    addTarget(hazard?.target_ref);
    for (const method of [...(hazard?.methods ?? []), ...(hazard?.bypasses ?? [])]) {
      addMethod(method);
    }
    for (const id of hazard?.slot?.materialized_ids ?? []) add(id);
  }
  for (const pressure of config.pressures ?? []) {
    add(pressure?.id);
    add(pressure?.progress?.clock_id);
    add(pressure?.danger?.clock_id);
    for (const target of pressure?.participant_refs ?? []) addTarget(target);
    for (const strategy of pressure?.strategies ?? []) addPredicates(strategy?.requirements);
    for (const id of pressure?.slot?.materialized_ids ?? []) add(id);
  }
  return ids;
}

function validateDescriptors(config, packId, slots, errors) {
  const knownIds = collectKnownIds(config);
  const recoveries = new Map();
  if (!Array.isArray(config.recoveries) || config.recoveries.length > 32) {
    errors.push("threshold recoveries must be a bounded array");
  } else {
    for (const recovery of config.recoveries) {
      const label = `threshold recovery ${String(recovery?.id ?? "unknown")}`;
      rejectUnknown(errors, recovery, new Set(["id", "version", "effects"]), label);
      if (
        !isObject(recovery)
        || !validCanonicalId(recovery.id, packId, "recovery")
        || recoveries.has(recovery.id)
        || !Number.isInteger(recovery.version)
        || recovery.version < 1
        || recovery.version > 255
      ) {
        errors.push(`${label} must be unique, pack-owned, and versioned`);
      } else {
        recoveries.set(recovery.id, recovery);
      }
      validateEffects(errors, recovery?.effects, packId, knownIds, `${label} effects`);
    }
  }

  const anchors = new Map();
  if (!Array.isArray(config.anchors) || config.anchors.length > 128) {
    errors.push("threshold anchors must be a bounded array");
  } else {
    for (const anchor of config.anchors) {
      const label = `threshold anchor ${String(anchor?.id ?? "unknown")}`;
      rejectUnknown(
        errors,
        anchor,
        new Set([
          "id",
          "version",
          "location_ref",
          "state",
          "return_chain",
          "branch_authorization",
          "durable_mark_state",
        ]),
        label,
      );
      if (
        !isObject(anchor)
        || !validCanonicalId(anchor.id, packId, "anchor")
        || anchors.has(anchor.id)
        || !Number.isInteger(anchor.version)
        || anchor.version < 1
        || anchor.version > 255
      ) {
        errors.push(`${label} must be unique, pack-owned, and versioned`);
      } else {
        anchors.set(anchor.id, anchor);
      }
      validateVersionedTarget(
        errors,
        anchor?.location_ref,
        packId,
        `${label} location_ref`,
        new Set(["location"]),
      );
      if (!["provisional", "marked", "mapped"].includes(anchor?.state)) {
        errors.push(`${label} state is invalid`);
      }
      for (const field of ["return_chain", "branch_authorization"]) {
        if (!Array.isArray(anchor?.[field]) || anchor[field].length > 16) {
          errors.push(`${label} ${field} must be a bounded route list`);
        } else {
          for (const [index, target] of anchor[field].entries()) {
            validateVersionedTarget(
              errors,
              target,
              packId,
              `${label} ${field} ${index}`,
              new Set(["route"]),
            );
          }
        }
      }
      if (!["marked", "mapped"].includes(anchor?.durable_mark_state)) {
        errors.push(`${label} durable_mark_state must be marked or mapped`);
      }
    }
  }

  if (!Array.isArray(config.leads) || config.leads.length > 128) {
    errors.push("threshold leads must be a bounded array");
  } else {
    const ids = new Set();
    for (const lead of config.leads) {
      const label = `threshold lead ${String(lead?.id ?? "unknown")}`;
      rejectUnknown(
        errors,
        lead,
        new Set([
          "id",
          "version",
          "source_ref",
          "target_ref",
          "scope",
          "initial_state",
          "state_path",
          "anchor_id",
          "anchor_version",
          "slot",
          "transitions",
        ]),
        label,
      );
      if (
        !isObject(lead)
        || !validCanonicalId(lead.id, packId, "lead")
        || ids.has(lead.id)
        || !Number.isInteger(lead.version)
        || lead.version < 1
        || lead.version > 255
      ) {
        errors.push(`${label} must be unique, pack-owned, and versioned`);
      }
      ids.add(lead?.id);
      validateVersionedTarget(errors, lead?.source_ref, packId, `${label} source_ref`);
      validateVersionedTarget(errors, lead?.target_ref, packId, `${label} target_ref`);
      if (!["actor", "expedition", "world"].includes(lead?.scope)) {
        errors.push(`${label} scope is invalid`);
      }
      if (
        !leadStates.has(lead?.initial_state)
        || !boundedUniqueStrings(lead?.state_path, 2, 7, leadStates)
        || lead.state_path[0] !== lead.initial_state
      ) {
        errors.push(`${label} state_path must be bounded, valid, and start at initial_state`);
      }
      const anchor = anchors.get(lead?.anchor_id);
      if (!anchor || anchor.version !== lead?.anchor_version) {
        errors.push(`${label} anchor reference must resolve at the exact version`);
      }
      validateSlotRef(errors, lead?.slot, packId, "lead", slots, `${label} slot`);
      if (!Array.isArray(lead?.transitions) || lead.transitions.length < 1 || lead.transitions.length > 8) {
        errors.push(`${label} transitions must contain 1-8 bounded transitions`);
      } else {
        for (const [index, transition] of lead.transitions.entries()) {
          const transitionLabel = `${label} transition ${index}`;
          rejectUnknown(
            errors,
            transition,
            new Set(["from", "to", "method", "effects"]),
            transitionLabel,
          );
          if (
            !leadStates.has(transition?.from)
            || !leadStates.has(transition?.to)
            || !nonEmpty(transition?.method)
          ) {
            errors.push(`${transitionLabel} states or method are invalid`);
          }
          validateEffects(
            errors,
            transition?.effects,
            packId,
            knownIds,
            `${transitionLabel} effects`,
          );
        }
      }
    }
  }

  const gatesById = new Map((config.gates ?? []).map((gate) => [gate?.id, gate]));
  const validateHazardMechanics = (hazard, label) => {
    const mechanics = hazard?.mechanics;
    if (mechanics === undefined) return;
    rejectUnknown(
      errors,
      mechanics,
      new Set([
        "schema_version",
        "resolution_version",
        "gate_id",
        "initial_state",
        "states",
        "mechanism",
        "trigger_bindings",
      ]),
      `${label} mechanics`,
    );
    const gate = gatesById.get(mechanics?.gate_id);
    const sameTarget = gate
      && gate.target_ref?.kind === hazard.target_ref?.kind
      && gate.target_ref?.id === hazard.target_ref?.id
      && gate.target_ref?.version === hazard.target_ref?.version;
    if (!gate || !sameTarget) {
      errors.push(`${label} mechanics must bind a Gate on the exact same target`);
    }
    if (
      !isObject(mechanics)
      || mechanics.schema_version !== 1
      || mechanics.resolution_version !== "hazard-resolution-v1"
      || mechanics.initial_state !== "armed"
      || !boundedUniqueStrings(mechanics.states, 2, 5, hazardStates)
      || !mechanics.states.includes("armed")
    ) {
      errors.push(`${label} mechanics use an unsupported closed state contract`);
    }
    rejectUnknown(
      errors,
      mechanics?.mechanism,
      new Set(["text", "reveal_methods"]),
      `${label} mechanism`,
    );
    if (
      !isObject(mechanics?.mechanism)
      || !nonEmpty(mechanics.mechanism.text)
      || mechanics.mechanism.text.length > 512
      || !boundedUniqueStrings(
        mechanics.mechanism.reveal_methods,
        1,
        2,
        new Set(["search", "study"]),
      )
    ) {
      errors.push(`${label} mechanism requires explicit search/study evidence`);
    }
    if (
      !Array.isArray(mechanics?.trigger_bindings)
      || mechanics.trigger_bindings.length < 1
      || mechanics.trigger_bindings.length > 16
    ) {
      errors.push(`${label} mechanics require 1-16 trigger bindings`);
      return;
    }
    const bindingIds = new Set();
    const boundMethods = new Set();
    const gateMethods = new Map((gate?.methods ?? []).map((method) => [method.id, method]));
    for (const [index, binding] of mechanics.trigger_bindings.entries()) {
      const bindingLabel = `${label} trigger binding ${index}`;
      rejectUnknown(
        errors,
        binding,
        new Set([
          "id",
          "act",
          "gate_method",
          "from_states",
          "target_policy",
          "maximum_targets",
          "on_success_state",
          "on_failure_state",
          "consequence_on",
        ]),
        bindingLabel,
      );
      const method = gateMethods.get(binding?.gate_method);
      const checked = ["srd_check", "consequence_avoidance_check"].includes(
        method?.offer?.resolution?.kind,
      );
      if (
        !isObject(binding)
        || !localIdPattern.test(binding.id ?? "")
        || bindingIds.has(binding.id)
        || boundMethods.has(binding.gate_method)
        || !method
        || !triggers.has(binding.act)
        || !(hazard.triggers ?? []).includes(binding.act)
        || !boundedUniqueStrings(
          binding.from_states,
          1,
          mechanics.states?.length ?? 0,
          new Set(mechanics.states ?? []),
        )
        || !hazardTargetPolicies.has(binding.target_policy)
        || !Number.isInteger(binding.maximum_targets)
        || binding.maximum_targets < 1
        || binding.maximum_targets > 16
        || !hazardStates.has(binding.on_success_state)
        || (binding.on_failure_state !== undefined
          && !hazardStates.has(binding.on_failure_state))
        || checked !== (binding.on_failure_state !== undefined)
        || !hazardConsequencePolicies.has(binding.consequence_on)
      ) {
        errors.push(`${bindingLabel} is invalid or references an unknown Gate method`);
      }
      bindingIds.add(binding?.id);
      boundMethods.add(binding?.gate_method);
    }
    if (
      (hazard.consequences ?? []).some((effect) => effect?.kind !== "advance_clock")
    ) {
      errors.push(`${label} mechanics only supports deterministic advance_clock consequences`);
    }
  };

  const validateGateOrHazard = (entries, kind) => {
    if (!Array.isArray(entries) || entries.length > 128) {
      errors.push(`threshold ${kind}s must be a bounded array`);
      return;
    }
    const ids = new Set();
    for (const entry of entries) {
      const label = `threshold ${kind} ${String(entry?.id ?? "unknown")}`;
      const common = [
        "id",
        "version",
        "target_ref",
        "scope",
        "methods",
        "reset",
        "slot",
      ];
      const specific = kind === "gate"
        ? ["transition", "persistence", "closed_requirements"]
        : ["tells", "triggers", "bypasses", "consequences", "severity", "mechanics"];
      rejectUnknown(errors, entry, new Set([...common, ...specific]), label);
      if (
        !isObject(entry)
        || !validCanonicalId(entry.id, packId, kind)
        || ids.has(entry.id)
        || !Number.isInteger(entry.version)
        || entry.version < 1
        || entry.version > 255
      ) {
        errors.push(`${label} must be unique, pack-owned, and versioned`);
      }
      ids.add(entry?.id);
      validateVersionedTarget(errors, entry?.target_ref, packId, `${label} target_ref`);
      if (!scopes.has(entry?.scope)) errors.push(`${label} scope is invalid`);
      if (entry?.slot !== undefined) {
        validateSlotRef(errors, entry.slot, packId, kind, slots, `${label} slot`);
      }
      if (!isObject(entry?.reset)) {
        errors.push(`${label} reset must be an object`);
      } else {
        rejectUnknown(errors, entry.reset, new Set(["policy", "after_turns"]), `${label} reset`);
        if (!resetPolicies.has(entry.reset.policy)) errors.push(`${label} reset policy is invalid`);
        if (
          entry.reset.policy === "world_tick"
          && (!Number.isInteger(entry.reset.after_turns)
            || entry.reset.after_turns < 1
            || entry.reset.after_turns > 255)
        ) {
          errors.push(`${label} world_tick reset needs bounded after_turns`);
        }
        if (entry.reset.policy !== "world_tick" && entry.reset.after_turns !== undefined) {
          errors.push(`${label} only world_tick reset accepts after_turns`);
        }
      }
      if (kind === "gate") {
        if (!transitions.has(entry?.transition)) errors.push(`${label} transition is invalid`);
        if (!["persistent", "resettable"].includes(entry?.persistence)) {
          errors.push(`${label} persistence is invalid`);
        }
        validatePredicates(
          errors,
          entry?.closed_requirements,
          packId,
          `${label} closed_requirements`,
        );
      } else {
        if (
          !Array.isArray(entry?.tells)
          || entry.tells.length < 1
          || entry.tells.length > 8
          || entry.tells.some((tell) => !nonEmpty(tell))
        ) {
          errors.push(`${label} tells must contain 1-8 authored tells`);
        }
        if (!boundedUniqueStrings(entry?.triggers, 1, 8, triggers)) {
          errors.push(`${label} triggers must use the closed trigger vocabulary`);
        }
        if (!severities.has(entry?.severity)) errors.push(`${label} severity is invalid`);
        validateEffects(errors, entry?.consequences, packId, knownIds, `${label} consequences`);
        if (!Array.isArray(entry?.bypasses) || entry.bypasses.length > 8) {
          errors.push(`${label} bypasses must be a bounded array`);
        } else {
          for (const [index, bypass] of entry.bypasses.entries()) {
            validateMethod(
              errors,
              bypass,
              packId,
              knownIds,
              recoveries,
              `${label} bypass ${index}`,
            );
          }
        }
        validateHazardMechanics(entry, label);
      }
      if (!Array.isArray(entry?.methods) || entry.methods.length < 1 || entry.methods.length > 8) {
        errors.push(`${label} methods must contain 1-8 bounded methods`);
      } else {
        for (const [index, method] of entry.methods.entries()) {
          validateMethod(
            errors,
            method,
            packId,
            knownIds,
            recoveries,
            `${label} method ${index}`,
          );
        }
      }
    }
  };
  validateGateOrHazard(config.gates, "gate");
  validateGateOrHazard(config.hazards, "hazard");

  if (!Array.isArray(config.pressures) || config.pressures.length > 64) {
    errors.push("threshold pressures must be a bounded array");
  } else {
    const ids = new Set();
    for (const pressure of config.pressures) {
      const label = `threshold pressure ${String(pressure?.id ?? "unknown")}`;
      rejectUnknown(
        errors,
        pressure,
        new Set([
          "id",
          "version",
          "participant_refs",
          "progress",
          "danger",
          "terminal_states",
          "strategies",
          "slot",
        ]),
        label,
      );
      if (
        !isObject(pressure)
        || !validCanonicalId(pressure.id, packId, "pressure")
        || ids.has(pressure.id)
        || !Number.isInteger(pressure.version)
        || pressure.version < 1
        || pressure.version > 255
      ) {
        errors.push(`${label} must be unique, pack-owned, and versioned`);
      }
      ids.add(pressure?.id);
      if (
        !Array.isArray(pressure?.participant_refs)
        || pressure.participant_refs.length < 1
        || pressure.participant_refs.length > 16
      ) {
        errors.push(`${label} participant_refs must contain 1-16 participants`);
      } else {
        for (const [index, target] of pressure.participant_refs.entries()) {
          validateVersionedTarget(errors, target, packId, `${label} participant ${index}`);
        }
      }
      for (const track of ["progress", "danger"]) {
        const value = pressure?.[track];
        rejectUnknown(
          errors,
          value,
          new Set(["clock_id", "question", "maximum"]),
          `${label} ${track}`,
        );
        if (
          !isObject(value)
          || !validCanonicalId(value.clock_id, packId, "clock")
          || !nonEmpty(value.question)
          || value.question.length > 256
          || !Number.isInteger(value.maximum)
          || value.maximum < 1
          || value.maximum > 32
        ) {
          errors.push(`${label} ${track} must reference a bounded clock`);
        }
      }
      if (!boundedUniqueStrings(pressure?.terminal_states, 2, 8)) {
        errors.push(`${label} terminal_states must be a bounded unique list`);
      }
      validateSlotRef(errors, pressure?.slot, packId, "pressure", slots, `${label} slot`);
      if (
        !Array.isArray(pressure?.strategies)
        || pressure.strategies.length < 1
        || pressure.strategies.length > 8
      ) {
        errors.push(`${label} strategies must contain 1-8 bounded strategies`);
      } else {
        for (const [index, strategy] of pressure.strategies.entries()) {
          const strategyLabel = `${label} strategy ${index}`;
          rejectUnknown(
            errors,
            strategy,
            new Set([
              "id",
              "turn_cost",
              "requirements",
              "success_effects",
              "soft_consequences",
              "hard_consequences",
            ]),
            strategyLabel,
          );
          if (
            !isObject(strategy)
            || !localIdPattern.test(strategy.id ?? "")
            || !Number.isInteger(strategy.turn_cost)
            || strategy.turn_cost < 1
            || strategy.turn_cost > 16
          ) {
            errors.push(`${strategyLabel} needs a stable id and bounded turn_cost`);
          }
          validatePredicates(errors, strategy?.requirements, packId, `${strategyLabel} requirements`);
          validateEffects(
            errors,
            strategy?.success_effects,
            packId,
            knownIds,
            `${strategyLabel} success`,
          );
          validateEffects(
            errors,
            strategy?.soft_consequences,
            packId,
            knownIds,
            `${strategyLabel} soft`,
          );
          validateEffects(
            errors,
            strategy?.hard_consequences,
            packId,
            knownIds,
            `${strategyLabel} hard`,
          );
        }
      }
    }
  }
}

export function thresholdDescriptorValidationErrors(config, packId, slots = new Map()) {
  const errors = [];
  if (!isObject(config)) return ["threshold descriptors must be an object"];
  rejectUnknown(
    errors,
    config,
    new Set([
      "schema_version",
      "descriptor_version",
      "accepted_intent_version",
      "authoring_authority",
      "lead_state_migrations",
      "recoveries",
      "anchors",
      "leads",
      "gates",
      "hazards",
      "pressures",
    ]),
    "threshold descriptors",
  );
  if (config.schema_version !== SCHEMA_VERSION) {
    errors.push(`threshold descriptors schema_version must be ${SCHEMA_VERSION}`);
  }
  if (config.descriptor_version !== DESCRIPTOR_VERSION) {
    errors.push(`threshold descriptors descriptor_version must be ${DESCRIPTOR_VERSION}`);
  }
  if (config.accepted_intent_version !== INTENT_VERSION) {
    errors.push(`threshold descriptors accepted_intent_version must be ${INTENT_VERSION}`);
  }
  if (config.authoring_authority !== "authored_pack") {
    errors.push("threshold descriptors authoring_authority must be authored_pack");
  }
  if (!nonEmpty(packId)) errors.push("threshold descriptors require a pack id");
  const migrations = config.lead_state_migrations;
  if (
    !isObject(migrations)
    || Object.keys(migrations).length !== legacyLeadStates.size
    || [...legacyLeadStates].some((state) => !leadStates.has(migrations[state]))
    || Object.keys(migrations).some((state) => !legacyLeadStates.has(state))
  ) {
    errors.push("threshold descriptors require the complete closed legacy lead-state migration");
  }
  validateDescriptors(config, packId, slots, errors);
  return errors;
}

export function assertThresholdDescriptors(config, packId, slots = new Map()) {
  const errors = thresholdDescriptorValidationErrors(config, packId, slots);
  if (errors.length) throw new Error(errors.join("; "));
  return config;
}

export function thresholdDescriptorExtensionValidationErrors(manifest, label = "pack.json") {
  const config = manifest?.extensions?.[EXTENSION];
  if (config === undefined) return [];
  return thresholdDescriptorValidationErrors(
    config,
    manifest.id,
    discoverySlots(manifest),
  ).map((error) => `${label}: ${EXTENSION}: ${error}`);
}
