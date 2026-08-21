import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const POSTCARD_PROOF_SCHEMA_VERSION = 1;
export const MAX_EVIDENCE_EVENTS = 200;
export const MAX_EVIDENCE_BYTES = 64 * 1024;

const sectionKinds = ["changed", "who", "next", "blockage"];
const sensitiveKey =
  /(?:^|_)(?:actor_session|wallet_session|authorization|cookie|secret|token|prompt|moderation)(?:$|_)/i;
const sensitiveText =
  /(?:\bBearer\s+[A-Za-z0-9._~-]{12,}|\b\d{6,}:[A-Za-z0-9_-]{20,}|(?:actor|wallet)_session\s*[=:]\s*\S+)/i;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmptyString(value, label, maximum = 1_000) {
  invariant(
    typeof value === "string" && value.trim(),
    `${label} must be a non-empty string`,
  );
  invariant(
    value.length <= maximum,
    `${label} must be at most ${maximum} characters`,
  );
  invariant(
    !sensitiveText.test(value),
    `${label} appears to contain a credential`,
  );
  return value.trim();
}

function positiveInteger(value, label) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    `${label} must be a positive integer`,
  );
  return value;
}

function nonNegativeInteger(value, label) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a non-negative integer`,
  );
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function copy(value) {
  return structuredClone(value);
}

function assertNoSensitiveFields(value, label = "value", seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSensitiveFields(entry, `${label}[${index}]`, seen),
    );
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    invariant(
      !sensitiveKey.test(key),
      `${label}.${key} is not allowed in a postcard proof record`,
    );
    assertNoSensitiveFields(entry, `${label}.${key}`, seen);
  }
}

function assertRunIdentity(run) {
  invariant(
    run?.schema_version === POSTCARD_PROOF_SCHEMA_VERSION,
    "unsupported postcard proof schema",
  );
  nonEmptyString(run.run_id, "run_id", 96);
  nonEmptyString(run.world?.world_id, "world.world_id", 256);
  positiveInteger(run.world?.world_epoch, "world.world_epoch");
  positiveInteger(run.actor?.actor_id, "actor.actor_id");
  nonEmptyString(run.actor?.actor_ref, "actor.actor_ref", 256);
  nonNegativeInteger(run.accepted_report_cursor, "accepted_report_cursor");
}

export function createPostcardProofRun({
  run_id,
  world_id,
  world_epoch,
  actor_id,
  actor_ref,
  initial_report_cursor = 0,
}) {
  const run = {
    schema_version: POSTCARD_PROOF_SCHEMA_VERSION,
    run_id: nonEmptyString(run_id, "run_id", 96),
    world: {
      world_id: nonEmptyString(world_id, "world_id", 256),
      world_epoch: positiveInteger(world_epoch, "world_epoch"),
    },
    actor: {
      actor_id: positiveInteger(actor_id, "actor_id"),
      actor_ref: nonEmptyString(actor_ref, "actor_ref", 256),
    },
    accepted_report_cursor: nonNegativeInteger(
      initial_report_cursor,
      "initial_report_cursor",
    ),
    expeditions: [],
    recall: null,
    decision: null,
  };
  assertNoSensitiveFields(run, "run");
  return run;
}

function findExpedition(run, expeditionId) {
  return run.expeditions.find((entry) => entry.expedition_id === expeditionId);
}

export function beginExpedition(run, { expedition_id }) {
  assertRunIdentity(run);
  const expeditionId = nonEmptyString(expedition_id, "expedition_id", 96);
  invariant(
    !findExpedition(run, expeditionId),
    `expedition ${expeditionId} already exists`,
  );
  invariant(
    !run.expeditions.some((entry) => entry.status !== "delivered"),
    "the previous expedition must have an accepted report before another begins",
  );
  const next = copy(run);
  next.expeditions.push({
    expedition_id: expeditionId,
    ordinal: next.expeditions.length + 1,
    status: "active",
    identity: copy(next.actor),
    start_cursor: next.accepted_report_cursor,
    actions: [],
    evidence: null,
    report: null,
    feedback: null,
  });
  return next;
}

function currentOffer(state, offerId) {
  const offers = Array.isArray(state?.action_offers) ? state.action_offers : [];
  const offer = offers.find((entry) => entry?.offer_id === offerId);
  invariant(
    offer,
    `offer ${offerId} is not in the current server-authored action hand`,
  );
  invariant(!offer.disabled, `offer ${offerId} is disabled`);
  return offer;
}

function canonicalActionIdentity(run, expedition, step, offer, state) {
  const material = {
    run_id: run.run_id,
    expedition_id: expedition.expedition_id,
    step,
    offer_id: offer.offer_id,
    world_seq: state.world_seq,
    state_revision: state.state_revision,
  };
  return `postcard:${digest(material).slice(0, 40)}`;
}

export function prepareExpeditionAction(
  run,
  { expedition_id, step, state, offer_id },
) {
  assertRunIdentity(run);
  const expeditionId = nonEmptyString(expedition_id, "expedition_id", 96);
  const stepNumber = positiveInteger(step, "step");
  const expedition = findExpedition(run, expeditionId);
  invariant(
    expedition?.status === "active",
    `expedition ${expeditionId} is not active`,
  );
  invariant(
    !expedition.evidence,
    "actions cannot be added after the evidence boundary is captured",
  );

  const existing = expedition.actions.find(
    (action) => action.step === stepNumber,
  );
  if (existing) {
    invariant(
      existing.offer_id === offer_id,
      `step ${stepNumber} is already bound to another offer`,
    );
    return { run: copy(run), action: copy(existing) };
  }
  invariant(
    stepNumber === expedition.actions.length + 1,
    `step ${stepNumber} must follow the existing action sequence`,
  );

  invariant(
    state?.world_id === run.world.world_id,
    "state belongs to another world",
  );
  invariant(
    state?.world_epoch === run.world.world_epoch,
    "state belongs to another world epoch",
  );
  nonNegativeInteger(state?.world_seq, "state.world_seq");
  nonNegativeInteger(state?.state_revision, "state.state_revision");
  invariant(
    state?.command_context?.actor_ref === run.actor.actor_ref,
    "state belongs to another actor",
  );
  const offer = currentOffer(state, offer_id);
  const intentId = canonicalActionIdentity(
    run,
    expedition,
    stepNumber,
    offer,
    state,
  );
  const action = {
    step: stepNumber,
    status: "pending",
    intent_id: intentId,
    offer_id: offer.offer_id,
    offer_source: "state.action_offers",
    offer_kind: offer.kind,
    offer_label: offer.label,
    command: offer.command,
    offered_at: {
      world_seq: state.world_seq,
      state_revision: state.state_revision,
    },
    request: {
      actor_id: run.actor.actor_id,
      command: offer.command,
      offer_id: offer.offer_id,
      envelope: {
        world_id: run.world.world_id,
        intent_id: intentId,
        actor_ref: run.actor.actor_ref,
        observed: {
          actor_version: nonNegativeInteger(
            state.command_context.actor_version,
            "state.command_context.actor_version",
          ),
          location_version: nonNegativeInteger(
            state.command_context.location_version,
            "state.command_context.location_version",
          ),
        },
        last_world_seq: state.world_seq,
      },
    },
    receipt: null,
  };
  const next = copy(run);
  findExpedition(next, expeditionId).actions.push(action);
  return { run: next, action: copy(action) };
}

export function commandRequestFor(action, actorSession) {
  invariant(
    action?.status === "pending",
    "only a pending action can be submitted or retried",
  );
  return {
    ...copy(action.request),
    actor_session: nonEmptyString(actorSession, "actor session", 2_048),
  };
}

export function acceptExpeditionAction(run, { expedition_id, step, response }) {
  assertRunIdentity(run);
  const next = copy(run);
  const expedition = findExpedition(next, expedition_id);
  const action = expedition?.actions.find((entry) => entry.step === step);
  invariant(
    action?.status === "pending",
    "action is not awaiting a canonical receipt",
  );
  invariant(
    response?.ok === true,
    "only a successful canonical command can be accepted",
  );
  invariant(
    response?.receipt?.world_id === next.world.world_id,
    "receipt belongs to another world",
  );
  invariant(
    response?.receipt?.world_epoch === next.world.world_epoch,
    "receipt belongs to another epoch",
  );
  invariant(
    response?.receipt?.intent_id === action.intent_id,
    "receipt belongs to another action intent",
  );
  invariant(
    response?.receipt?.actor_ref === next.actor.actor_ref,
    "receipt belongs to another actor",
  );
  action.status = "accepted";
  action.receipt = {
    world_id: response.receipt.world_id,
    world_epoch: response.receipt.world_epoch,
    world_seq: nonNegativeInteger(
      response.receipt.world_seq,
      "receipt.world_seq",
    ),
    intent_id: response.receipt.intent_id,
    actor_ref: response.receipt.actor_ref,
  };
  return next;
}

function sanitizeEvidenceEvent(event) {
  assertNoSensitiveFields(event, `event ${event?.seq ?? "unknown"}`);
  const sanitized = {};
  for (const [key, value] of Object.entries(event ?? {})) {
    if (
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    ) {
      sanitized[key] =
        typeof value === "string" ? value.slice(0, 2_000) : value;
    }
  }
  return sanitized;
}

export function captureEvidenceWindow(run, { expedition_id, pages }) {
  assertRunIdentity(run);
  const expedition = findExpedition(run, expedition_id);
  invariant(
    expedition?.status === "active",
    `expedition ${expedition_id} is not active`,
  );
  invariant(
    !expedition.evidence,
    "the expedition evidence boundary is already captured",
  );
  invariant(
    Array.isArray(pages) && pages.length > 0,
    "at least one /events page is required",
  );

  const boundary = nonNegativeInteger(
    pages[0]?.through_seq,
    "pages[0].through_seq",
  );
  invariant(
    boundary >= expedition.start_cursor,
    "evidence boundary precedes the accepted report cursor",
  );
  let scanCursor = expedition.start_cursor;
  const bySequence = new Map();
  for (const [index, page] of pages.entries()) {
    invariant(
      page?.world_id === run.world.world_id,
      `events page ${index} belongs to another world`,
    );
    invariant(
      page?.world_epoch === run.world.world_epoch,
      `events page ${index} belongs to another epoch`,
    );
    const nextAfter = nonNegativeInteger(
      page.next_after,
      `events page ${index}.next_after`,
    );
    invariant(
      nextAfter >= scanCursor,
      `events page ${index} moves the scan cursor backwards`,
    );
    for (const rawEvent of page.events ?? []) {
      const event = sanitizeEvidenceEvent(rawEvent);
      const sequence = positiveInteger(
        event.seq,
        `events page ${index} event.seq`,
      );
      if (sequence <= expedition.start_cursor || sequence > boundary) continue;
      invariant(
        event.world_id === run.world.world_id,
        `event ${sequence} belongs to another world`,
      );
      invariant(
        event.world_epoch === run.world.world_epoch,
        `event ${sequence} belongs to another epoch`,
      );
      bySequence.set(sequence, event);
    }
    scanCursor = nextAfter;
    if (scanCursor >= boundary) break;
  }
  invariant(
    scanCursor >= boundary,
    `event pages stop at ${scanCursor}, before boundary ${boundary}`,
  );
  const events = [...bySequence.values()].sort(
    (left, right) => left.seq - right.seq,
  );
  invariant(
    events.length <= MAX_EVIDENCE_EVENTS,
    `evidence packet exceeds ${MAX_EVIDENCE_EVENTS} events`,
  );
  const bytes = Buffer.byteLength(JSON.stringify(events));
  invariant(
    bytes <= MAX_EVIDENCE_BYTES,
    `evidence packet exceeds ${MAX_EVIDENCE_BYTES} bytes`,
  );

  const evidence = {
    actor_visible: true,
    untrusted_text: true,
    after_cursor: expedition.start_cursor,
    through_cursor: boundary,
    scanned_through_cursor: scanCursor,
    event_count: events.length,
    sha256: digest(events),
    events,
  };
  const next = copy(run);
  findExpedition(next, expedition_id).evidence = evidence;
  return { run: next, evidence: copy(evidence) };
}

function validateSection(section, evidenceSequences, actionIntents) {
  invariant(
    section && typeof section === "object",
    "each postcard section must be an object",
  );
  invariant(
    sectionKinds.includes(section.kind),
    `unknown postcard section ${section.kind}`,
  );
  const text = nonEmptyString(section.text, `${section.kind}.text`, 700);
  const source = nonEmptyString(section.source, `${section.kind}.source`, 40);
  const eventSequences = [...new Set(section.event_seqs ?? [])];
  const intentIds = [...new Set(section.action_intent_ids ?? [])];

  if (source === "canonical_events") {
    invariant(
      eventSequences.length > 0,
      `${section.kind} must cite at least one canonical event`,
    );
    invariant(
      intentIds.length === 0,
      `${section.kind} canonical event evidence cannot cite action receipts`,
    );
  } else if (source === "action_receipts") {
    invariant(
      intentIds.length > 0,
      `${section.kind} must cite at least one accepted action receipt`,
    );
    invariant(
      eventSequences.length === 0,
      `${section.kind} action receipt evidence cannot cite canonical events`,
    );
  } else if (source === "traveler_intention") {
    invariant(
      section.kind === "next",
      "traveler_intention is only valid for the next section",
    );
    invariant(
      eventSequences.length === 0 && intentIds.length === 0,
      "traveler_intention cannot claim canonical evidence",
    );
  } else if (source === "truthful_quiet") {
    invariant(
      section.kind !== "next",
      "the next section must state a traveler intention",
    );
    invariant(
      eventSequences.length === 0 && intentIds.length === 0,
      "truthful_quiet must describe the bounded evidence window as a whole",
    );
  } else {
    throw new Error(`${section.kind}.source is not supported`);
  }
  if (section.kind === "next") {
    invariant(
      source === "traveler_intention",
      "the next section must be a traveler intention rather than a world fact",
    );
  }
  for (const sequence of eventSequences) {
    invariant(
      evidenceSequences.has(sequence),
      `${section.kind} cites event ${sequence} outside its evidence packet`,
    );
  }
  for (const intentId of intentIds) {
    invariant(
      actionIntents.has(intentId),
      `${section.kind} cites unknown action intent ${intentId}`,
    );
  }
  return {
    kind: section.kind,
    text,
    source,
    event_seqs: eventSequences,
    action_intent_ids: intentIds,
  };
}

function renderPostcard(travelerName, sections) {
  const byKind = Object.fromEntries(
    sections.map((section) => [section.kind, section.text]),
  );
  return [
    `Postcard from ${travelerName}`,
    "",
    byKind.changed,
    byKind.who,
    `Next, ${byKind.next.replace(/^next,?\s*/i, "")}`,
    byKind.blockage,
  ].join("\n");
}

export function preparePostcardReport(
  run,
  { expedition_id, traveler_name, sections },
) {
  assertRunIdentity(run);
  const expedition = findExpedition(run, expedition_id);
  invariant(
    expedition?.status === "active",
    `expedition ${expedition_id} is not active`,
  );
  invariant(
    expedition.evidence,
    "capture the canonical evidence boundary before preparing a report",
  );
  invariant(!expedition.report, "this expedition already has a report");
  invariant(
    Array.isArray(sections) && sections.length === sectionKinds.length,
    "a report needs four sections",
  );
  invariant(
    sectionKinds.every(
      (kind) =>
        sections.filter((section) => section?.kind === kind).length === 1,
    ),
    "a report needs exactly one changed, who, next, and blockage section",
  );
  const evidenceSequences = new Set(
    expedition.evidence.events.map((event) => event.seq),
  );
  const actionIntents = new Set(
    expedition.actions
      .filter((action) => action.status === "accepted")
      .map((action) => action.intent_id),
  );
  const validatedSections = sectionKinds.map((kind) =>
    validateSection(
      sections.find((section) => section.kind === kind),
      evidenceSequences,
      actionIntents,
    ),
  );
  const travelerName = nonEmptyString(traveler_name, "traveler_name", 120);
  const body = renderPostcard(travelerName, validatedSections);
  invariant(
    !sensitiveText.test(body),
    "postcard body appears to contain a credential",
  );
  const reportId = `postcard:${digest({
    run_id: run.run_id,
    expedition_id,
    after: expedition.evidence.after_cursor,
    through: expedition.evidence.through_cursor,
    sections: validatedSections,
  }).slice(0, 40)}`;
  const report = {
    report_id: reportId,
    traveler_name: travelerName,
    evidence_sha256: expedition.evidence.sha256,
    sections: validatedSections,
    body,
    delivery: null,
  };
  const next = copy(run);
  findExpedition(next, expedition_id).report = report;
  return { run: next, report: copy(report) };
}

export function reserveTelegramDelivery(
  run,
  { expedition_id, target_alias, reserved_at },
) {
  assertRunIdentity(run);
  const next = copy(run);
  const expedition = findExpedition(next, expedition_id);
  invariant(
    expedition?.status === "active" && expedition.report,
    "report is not ready for delivery",
  );
  invariant(
    !expedition.report.delivery,
    "report delivery is already reserved or complete",
  );
  expedition.report.delivery = {
    status: "reserved",
    target_alias: nonEmptyString(target_alias, "target_alias", 96),
    reserved_at: nonEmptyString(reserved_at, "reserved_at", 64),
    telegram_message_id: null,
  };
  return next;
}

export function claimTelegramDelivery(
  run,
  { expedition_id, chat_id, claimed_at },
) {
  const next = copy(run);
  const expedition = findExpedition(next, expedition_id);
  invariant(
    expedition?.report?.delivery?.status === "reserved",
    "delivery is not reserved",
  );
  expedition.report.delivery.status = "sending";
  expedition.report.delivery.claimed_at = nonEmptyString(
    claimed_at,
    "claimed_at",
    64,
  );
  return {
    run: next,
    request: {
      chat_id: nonEmptyString(String(chat_id), "chat_id", 128),
      text: expedition.report.body,
      disable_web_page_preview: true,
    },
  };
}

export function recordTelegramDeliveryUnknown(run, { expedition_id, detail }) {
  const next = copy(run);
  const expedition = findExpedition(next, expedition_id);
  invariant(
    expedition?.report?.delivery?.status === "sending",
    "delivery has not been claimed for its one permitted send",
  );
  expedition.report.delivery.status = "uncertain";
  expedition.report.delivery.detail = nonEmptyString(
    detail,
    "delivery uncertainty",
    500,
  );
  return next;
}

export function acceptTelegramDelivery(
  run,
  { expedition_id, telegram_message_id, accepted_at, reconciled = false },
) {
  assertRunIdentity(run);
  const next = copy(run);
  const expedition = findExpedition(next, expedition_id);
  invariant(
    ["sending", "uncertain"].includes(expedition?.report?.delivery?.status),
    "delivery is neither sending nor awaiting reconciliation",
  );
  const messageId = positiveInteger(telegram_message_id, "telegram_message_id");
  invariant(
    !next.expeditions.some(
      (entry) => entry.report?.delivery?.telegram_message_id === messageId,
    ),
    `Telegram message ${messageId} is already bound to another report`,
  );
  expedition.report.delivery = {
    ...expedition.report.delivery,
    status: "delivered",
    telegram_message_id: messageId,
    accepted_at: nonEmptyString(accepted_at, "accepted_at", 64),
    reconciled: Boolean(reconciled),
  };
  expedition.status = "delivered";
  expedition.end_cursor = expedition.evidence.through_cursor;
  next.accepted_report_cursor = expedition.end_cursor;
  return next;
}

export function recordExpeditionFeedback(
  run,
  {
    expedition_id,
    reaction,
    reply,
    follow_up_question,
    requested_another,
    notes = "",
  },
) {
  const next = copy(run);
  const expedition = findExpedition(next, expedition_id);
  invariant(
    expedition?.status === "delivered",
    "feedback follows an accepted delivery",
  );
  invariant(
    !expedition.feedback,
    "feedback is already recorded for this expedition",
  );
  expedition.feedback = {
    reaction: Boolean(reaction),
    reply: Boolean(reply),
    follow_up_question: Boolean(follow_up_question),
    requested_another: Boolean(requested_another),
    notes: typeof notes === "string" ? notes.trim().slice(0, 1_000) : "",
  };
  return next;
}

export function recordPostcardRecall(run, recall) {
  const next = copy(run);
  invariant(!next.recall, "recall is already recorded");
  next.recall = {
    location: nonEmptyString(recall?.location, "recall.location", 500),
    relationship: nonEmptyString(
      recall?.relationship,
      "recall.relationship",
      500,
    ),
    durable_change: nonEmptyString(
      recall?.durable_change,
      "recall.durable_change",
      500,
    ),
    expected_next: nonEmptyString(
      recall?.expected_next,
      "recall.expected_next",
      500,
    ),
  };
  return next;
}

export function recordPostcardDecision(
  run,
  { verdict, rationale, supported_issue_moves = [] },
) {
  const next = copy(run);
  invariant(
    ["continue", "iterate", "stop"].includes(verdict),
    "decision verdict must be continue, iterate, or stop",
  );
  const expeditionIds = new Set(
    next.expeditions.map((entry) => entry.expedition_id),
  );
  next.decision = {
    verdict,
    rationale: nonEmptyString(rationale, "decision.rationale", 2_000),
    supported_issue_moves: supported_issue_moves.map((move, index) => {
      const evidenceExpeditions = [
        ...new Set(move?.evidence_expedition_ids ?? []),
      ];
      invariant(
        evidenceExpeditions.length > 0,
        `issue move ${index} needs expedition evidence`,
      );
      invariant(
        evidenceExpeditions.every((id) => expeditionIds.has(id)),
        `issue move ${index} cites an unknown expedition`,
      );
      return {
        issue: positiveInteger(move.issue, `issue move ${index}.issue`),
        evidence_expedition_ids: evidenceExpeditions,
        reason: nonEmptyString(
          move.reason,
          `issue move ${index}.reason`,
          1_000,
        ),
      };
    }),
  };
  return next;
}

function sensitivePaths(value, prefix = "run", found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      sensitivePaths(entry, `${prefix}[${index}]`, found),
    );
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (sensitiveKey.test(key)) found.push(`${prefix}.${key}`);
    sensitivePaths(entry, `${prefix}.${key}`, found);
  }
  return found;
}

function sensitiveValuePaths(value, prefix = "run", found = []) {
  if (typeof value === "string") {
    if (sensitiveText.test(value)) found.push(prefix);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      sensitiveValuePaths(entry, `${prefix}[${index}]`, found),
    );
    return found;
  }
  for (const [key, entry] of Object.entries(value)) {
    sensitiveValuePaths(entry, `${prefix}.${key}`, found);
  }
  return found;
}

export function analyzePostcardProof(run) {
  const gaps = [];
  try {
    assertRunIdentity(run);
  } catch (error) {
    gaps.push(error.message);
  }
  const secretPaths = sensitivePaths(run);
  if (secretPaths.length > 0)
    gaps.push(`sensitive fields present: ${secretPaths.join(", ")}`);
  const credentialValues = sensitiveValuePaths(run);
  if (credentialValues.length > 0)
    gaps.push(`credential-like values present: ${credentialValues.join(", ")}`);
  const expeditions = Array.isArray(run?.expeditions) ? run.expeditions : [];
  if (expeditions.length !== 7)
    gaps.push(`expected 7 expeditions, found ${expeditions.length}`);
  let cursor = Number.isSafeInteger(expeditions[0]?.start_cursor)
    ? expeditions[0].start_cursor
    : (run?.accepted_report_cursor ?? 0);
  const actorKey = `${run?.actor?.actor_id ?? "?"}:${run?.actor?.actor_ref ?? "?"}`;
  const intentIds = new Set();
  const reportIds = new Set();
  const messageIds = new Set();
  const feedback = [];

  for (const expedition of expeditions) {
    const label = `expedition ${expedition?.expedition_id ?? "?"}`;
    if (
      `${expedition?.identity?.actor_id ?? "?"}:${expedition?.identity?.actor_ref ?? "?"}` !==
      actorKey
    ) {
      gaps.push(`${label} used a different actor identity`);
    }
    if (expedition?.start_cursor !== cursor)
      gaps.push(`${label} does not start at the previous accepted cursor`);
    if (expedition?.status !== "delivered")
      gaps.push(`${label} has no accepted Telegram delivery`);
    const evidence = expedition?.evidence;
    if (!evidence?.actor_visible)
      gaps.push(`${label} evidence is not marked actor-visible`);
    if (evidence?.after_cursor !== expedition?.start_cursor)
      gaps.push(`${label} evidence starts at the wrong cursor`);
    if (evidence?.through_cursor !== expedition?.end_cursor)
      gaps.push(`${label} evidence boundary was not accepted`);
    if (evidence?.untrusted_text !== true)
      gaps.push(`${label} evidence text is not marked untrusted`);
    if (evidence?.event_count !== (evidence?.events ?? []).length)
      gaps.push(`${label} evidence event count is inconsistent`);
    if (evidence?.sha256 !== digest(evidence?.events ?? []))
      gaps.push(`${label} evidence hash is inconsistent`);
    if ((evidence?.events ?? []).length > MAX_EVIDENCE_EVENTS)
      gaps.push(`${label} evidence exceeds the event bound`);
    if (
      Buffer.byteLength(JSON.stringify(evidence?.events ?? [])) >
      MAX_EVIDENCE_BYTES
    )
      gaps.push(`${label} evidence exceeds the byte bound`);
    const evidenceSequences = new Set(
      (evidence?.events ?? []).map((event) => event.seq),
    );
    for (const event of evidence?.events ?? []) {
      const sequence = event.seq;
      if (
        !(
          sequence > expedition.start_cursor &&
          sequence <= expedition.end_cursor
        )
      ) {
        gaps.push(
          `${label} includes event ${sequence} outside its report window`,
        );
      }
      if (
        event.world_id !== run?.world?.world_id ||
        event.world_epoch !== run?.world?.world_epoch
      ) {
        gaps.push(`${label} includes event ${sequence} from another world`);
      }
    }
    const actions = expedition?.actions ?? [];
    if (actions.length === 0) gaps.push(`${label} records no world action`);
    const acceptedActionIntents = new Set(
      actions
        .filter((action) => action.status === "accepted")
        .map((action) => action.intent_id),
    );
    for (const action of actions) {
      if (
        action.status !== "accepted" ||
        action.receipt?.intent_id !== action.intent_id
      ) {
        gaps.push(
          `${label} action ${action.step ?? "?"} lacks its canonical receipt`,
        );
      }
      if (action.offer_source !== "state.action_offers")
        gaps.push(
          `${label} action ${action.step ?? "?"} lacks current-offer provenance`,
        );
      if (action.request?.offer_id !== action.offer_id)
        gaps.push(
          `${label} action ${action.step ?? "?"} was not bound to its offered id`,
        );
      if (action.request?.envelope?.actor_ref !== run?.actor?.actor_ref)
        gaps.push(`${label} action ${action.step ?? "?"} used another actor`);
      if (action.request?.actor_id !== run?.actor?.actor_id)
        gaps.push(
          `${label} action ${action.step ?? "?"} used another actor id`,
        );
      if (action.request?.envelope?.world_id !== run?.world?.world_id)
        gaps.push(`${label} action ${action.step ?? "?"} used another world`);
      if (action.request?.envelope?.intent_id !== action.intent_id)
        gaps.push(
          `${label} action ${action.step ?? "?"} changed its request intent`,
        );
      if (
        action.request?.envelope?.last_world_seq !==
        action.offered_at?.world_seq
      )
        gaps.push(
          `${label} action ${action.step ?? "?"} changed its offered world boundary`,
        );
      if (
        action.receipt?.world_id !== run?.world?.world_id ||
        action.receipt?.world_epoch !== run?.world?.world_epoch ||
        action.receipt?.actor_ref !== run?.actor?.actor_ref
      ) {
        gaps.push(
          `${label} action ${action.step ?? "?"} receipt has another identity`,
        );
      }
      if (
        !Number.isSafeInteger(action.receipt?.world_seq) ||
        action.receipt.world_seq > expedition.end_cursor
      ) {
        gaps.push(
          `${label} action ${action.step ?? "?"} receipt is outside the evidence boundary`,
        );
      }
      if (intentIds.has(action.intent_id))
        gaps.push(`${label} repeats action intent ${action.intent_id}`);
      intentIds.add(action.intent_id);
    }
    const report = expedition?.report;
    if (!report || report.evidence_sha256 !== evidence?.sha256)
      gaps.push(`${label} report is not bound to its evidence packet`);
    const kinds = (report?.sections ?? []).map((section) => section.kind);
    if (
      !sectionKinds.every(
        (kind) => kinds.filter((entry) => entry === kind).length === 1,
      )
    ) {
      gaps.push(`${label} report does not answer all four postcard questions`);
    }
    for (const section of report?.sections ?? []) {
      try {
        validateSection(section, evidenceSequences, acceptedActionIntents);
      } catch (error) {
        gaps.push(`${label} report section is invalid: ${error.message}`);
      }
    }
    try {
      if (
        report?.body !==
        renderPostcard(report?.traveler_name, report?.sections ?? [])
      ) {
        gaps.push(
          `${label} delivered body contains prose outside the four traced sections`,
        );
      }
    } catch {
      gaps.push(
        `${label} delivered body cannot be reconstructed from its sections`,
      );
    }
    const expectedReportId = `postcard:${digest({
      run_id: run?.run_id,
      expedition_id: expedition?.expedition_id,
      after: evidence?.after_cursor,
      through: evidence?.through_cursor,
      sections: report?.sections ?? [],
    }).slice(0, 40)}`;
    if (report?.report_id !== expectedReportId)
      gaps.push(`${label} report id does not match its evidence and sections`);
    if (report?.delivery?.status !== "delivered")
      gaps.push(`${label} report delivery is not accepted`);
    if (reportIds.has(report?.report_id))
      gaps.push(`${label} repeats report id ${report?.report_id}`);
    reportIds.add(report?.report_id);
    const messageId = report?.delivery?.telegram_message_id;
    if (!Number.isSafeInteger(messageId))
      gaps.push(`${label} lacks a Telegram message receipt`);
    if (messageIds.has(messageId))
      gaps.push(`${label} repeats Telegram message ${messageId}`);
    messageIds.add(messageId);
    if (!expedition?.feedback)
      gaps.push(`${label} has no human feedback record`);
    else {
      for (const field of [
        "reaction",
        "reply",
        "follow_up_question",
        "requested_another",
      ]) {
        if (typeof expedition.feedback[field] !== "boolean")
          gaps.push(`${label} feedback.${field} is not recorded`);
      }
      feedback.push(expedition.feedback);
    }
    if (Number.isSafeInteger(expedition?.end_cursor))
      cursor = expedition.end_cursor;
  }
  if (expeditions.length > 0 && run?.accepted_report_cursor !== cursor) {
    gaps.push("run cursor does not equal the final accepted report cursor");
  }
  for (const field of [
    "location",
    "relationship",
    "durable_change",
    "expected_next",
  ]) {
    if (typeof run?.recall?.[field] !== "string" || !run.recall[field].trim())
      gaps.push(`recall.${field} is missing`);
  }
  if (
    !run?.decision ||
    !["continue", "iterate", "stop"].includes(run.decision.verdict)
  ) {
    gaps.push("continue / iterate / stop decision is missing");
  }
  const knownExpeditions = new Set(
    expeditions.map((entry) => entry.expedition_id),
  );
  for (const move of run?.decision?.supported_issue_moves ?? []) {
    if (!(move.evidence_expedition_ids ?? []).length)
      gaps.push(`issue #${move.issue ?? "?"} has no supporting expedition`);
    if (
      !(move.evidence_expedition_ids ?? []).every((id) =>
        knownExpeditions.has(id),
      )
    ) {
      gaps.push(
        `issue #${move.issue ?? "?"} cites unknown expedition evidence`,
      );
    }
  }
  return {
    ready: gaps.length === 0,
    expedition_count: expeditions.length,
    delivered_count: expeditions.filter((entry) => entry.status === "delivered")
      .length,
    reactions: feedback.filter((entry) => entry.reaction).length,
    replies: feedback.filter((entry) => entry.reply).length,
    follow_up_questions: feedback.filter((entry) => entry.follow_up_question)
      .length,
    requests_for_another: feedback.filter((entry) => entry.requested_another)
      .length,
    gaps,
  };
}

export function readPostcardProof(filePath) {
  const run = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assertNoSensitiveFields(run, "run");
  return run;
}

export function writePostcardProof(filePath, run) {
  assertRunIdentity(run);
  assertNoSensitiveFields(run, "run");
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, resolved);
  fs.chmodSync(resolved, 0o600);
}

export async function withPostcardProofLock(filePath, callback) {
  const resolved = path.resolve(filePath);
  const lockPath = `${resolved}.lock`;
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(lockPath, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `postcard proof is locked at ${lockPath}; fail closed and reconcile before removing it`,
      );
    }
    throw error;
  }
  try {
    const current = fs.existsSync(resolved)
      ? readPostcardProof(resolved)
      : null;
    const updated = await callback(current);
    if (updated) writePostcardProof(resolved, updated);
    return updated;
  } finally {
    fs.rmdirSync(lockPath);
  }
}

function printUsage() {
  console.error(
    "Usage: node v2/scripts/telegram-postcard-proof.mjs --check <run.json> [--json]",
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const checkIndex = process.argv.indexOf("--check");
  if (checkIndex < 0 || !process.argv[checkIndex + 1]) {
    printUsage();
    process.exitCode = 2;
  } else {
    try {
      const report = analyzePostcardProof(
        readPostcardProof(process.argv[checkIndex + 1]),
      );
      if (process.argv.includes("--json"))
        console.log(JSON.stringify(report, null, 2));
      else if (report.ready)
        console.log(
          `Postcard proof ready: ${report.delivered_count}/7 expeditions delivered.`,
        );
      else {
        console.error(
          `Postcard proof incomplete (${report.delivered_count}/7 delivered):`,
        );
        report.gaps.forEach((gap) => console.error(`- ${gap}`));
      }
      if (!report.ready) process.exitCode = 1;
    } catch (error) {
      console.error(`Postcard proof could not be checked: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
