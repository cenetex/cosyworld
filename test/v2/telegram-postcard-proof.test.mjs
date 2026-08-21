import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  acceptExpeditionAction,
  acceptTelegramDelivery,
  analyzePostcardProof,
  beginExpedition,
  captureEvidenceWindow,
  claimTelegramDelivery,
  commandRequestFor,
  createPostcardProofRun,
  prepareExpeditionAction,
  preparePostcardReport,
  readPostcardProof,
  recordExpeditionFeedback,
  recordPostcardDecision,
  recordPostcardRecall,
  recordTelegramDeliveryUnknown,
  reserveTelegramDelivery,
  withPostcardProofLock,
  writePostcardProof,
} from "../../v2/scripts/telegram-postcard-proof.mjs";

function initialRun() {
  return createPostcardProofRun({
    run_id: "seven-postcards-1",
    world_id: "world://cosyworld/official",
    world_epoch: 1,
    actor_id: 5_000,
    actor_ref: "world://cosyworld/official/actor/traveler",
  });
}

function stateAt(worldSeq, offerId = `offer-${worldSeq}`) {
  return {
    world_id: "world://cosyworld/official",
    world_epoch: 1,
    world_seq: worldSeq,
    state_revision: worldSeq,
    command_context: {
      actor_ref: "world://cosyworld/official/actor/traveler",
      actor_version: worldSeq + 10,
      location_version: worldSeq + 20,
    },
    action_offers: [
      {
        offer_id: offerId,
        kind: "move",
        label: "Follow the lantern road",
        command: "travel",
        disabled: false,
      },
    ],
  };
}

function acceptAction(run, expeditionId, step, worldSeq) {
  const offerId = `offer-${worldSeq}`;
  const prepared = prepareExpeditionAction(run, {
    expedition_id: expeditionId,
    step,
    state: stateAt(worldSeq, offerId),
    offer_id: offerId,
  });
  return {
    action: prepared.action,
    run: acceptExpeditionAction(prepared.run, {
      expedition_id: expeditionId,
      step,
      response: {
        ok: true,
        receipt: {
          world_id: "world://cosyworld/official",
          world_epoch: 1,
          world_seq: worldSeq + 1,
          intent_id: prepared.action.intent_id,
          actor_ref: "world://cosyworld/official/actor/traveler",
        },
      },
    }),
  };
}

function finishExpedition(run, ordinal) {
  const expeditionId = `expedition-${ordinal}`;
  const start = run.accepted_report_cursor;
  run = beginExpedition(run, { expedition_id: expeditionId });
  const accepted = acceptAction(run, expeditionId, 1, start);
  run = accepted.run;
  const through = start + 2;
  run = captureEvidenceWindow(run, {
    expedition_id: expeditionId,
    pages: [
      {
        world_id: "world://cosyworld/official",
        world_epoch: 1,
        through_seq: through,
        next_after: through,
        caught_up: true,
        events: [
          {
            world_id: "world://cosyworld/official",
            world_epoch: 1,
            seq: start + 1,
            type: "actor.moved",
            success: true,
            reason: 0,
            actor_id: 5_000,
            actor_name: "Mara",
            location_name: `Waystation ${ordinal - 1}`,
            destination_location_name: `Waystation ${ordinal}`,
          },
          {
            world_id: "world://cosyworld/official",
            world_epoch: 1,
            seq: through,
            type: "message.created",
            success: true,
            reason: 0,
            actor_id: 1_001,
            actor_name: "Gust",
            location_name: `Waystation ${ordinal}`,
            content: "The road is quiet tonight.",
          },
        ],
      },
    ],
  }).run;
  run = preparePostcardReport(run, {
    expedition_id: expeditionId,
    traveler_name: "Mara",
    sections: [
      {
        kind: "changed",
        text: `I reached Waystation ${ordinal}.`,
        source: "canonical_events",
        event_seqs: [start + 1],
      },
      {
        kind: "who",
        text: "Gust mattered; they warned me that the road was quiet.",
        source: "canonical_events",
        event_seqs: [through],
      },
      {
        kind: "next",
        text: "I intend to follow the lantern road.",
        source: "traveler_intention",
      },
      {
        kind: "blockage",
        text: "Nothing blocked the move, and I did not repeat it.",
        source: "action_receipts",
        action_intent_ids: [accepted.action.intent_id],
      },
    ],
  }).run;
  run = reserveTelegramDelivery(run, {
    expedition_id: expeditionId,
    target_alias: "team-postcards",
    reserved_at: `2026-08-${String(ordinal).padStart(2, "0")}T12:00:00Z`,
  });
  run = claimTelegramDelivery(run, {
    expedition_id: expeditionId,
    chat_id: "-1001",
    claimed_at: `2026-08-${String(ordinal).padStart(2, "0")}T12:00:00Z`,
  }).run;
  run = acceptTelegramDelivery(run, {
    expedition_id: expeditionId,
    telegram_message_id: 10_000 + ordinal,
    accepted_at: `2026-08-${String(ordinal).padStart(2, "0")}T12:00:01Z`,
  });
  return recordExpeditionFeedback(run, {
    expedition_id: expeditionId,
    reaction: ordinal % 2 === 1,
    reply: ordinal === 2,
    follow_up_question: ordinal === 4,
    requested_another: ordinal === 7,
    notes:
      ordinal === 7
        ? "Asked where Mara would go after the waystation."
        : "No written reply.",
  });
}

describe("Telegram postcard proof contract", () => {
  it("binds action retries to one current server-authored offer and intent", () => {
    let run = beginExpedition(initialRun(), { expedition_id: "expedition-1" });
    const state = stateAt(0, "current-offer");
    const first = prepareExpeditionAction(run, {
      expedition_id: "expedition-1",
      step: 1,
      state,
      offer_id: "current-offer",
    });
    const retry = prepareExpeditionAction(first.run, {
      expedition_id: "expedition-1",
      step: 1,
      state,
      offer_id: "current-offer",
    });

    expect(retry.action).toEqual(first.action);
    expect(
      commandRequestFor(first.action, "session-only-at-send-time"),
    ).toEqual(commandRequestFor(retry.action, "session-only-at-send-time"));
    expect(JSON.stringify(first.run)).not.toContain(
      "session-only-at-send-time",
    );
    expect(() =>
      prepareExpeditionAction(run, {
        expedition_id: "expedition-1",
        step: 1,
        state,
        offer_id: "invented-offer",
      }),
    ).toThrow(/not in the current server-authored action hand/);
  });

  it("bounds report claims to actor-visible canonical evidence", () => {
    let run = beginExpedition(initialRun(), { expedition_id: "expedition-1" });
    const accepted = acceptAction(run, "expedition-1", 1, 0);
    run = captureEvidenceWindow(accepted.run, {
      expedition_id: "expedition-1",
      pages: [
        {
          world_id: "world://cosyworld/official",
          world_epoch: 1,
          through_seq: 2,
          next_after: 2,
          events: [
            {
              world_id: "world://cosyworld/official",
              world_epoch: 1,
              seq: 1,
              type: "actor.moved",
              success: true,
              reason: 0,
              destination_location_name: "Lantern Road",
              nested_internal_state: { ignored: true },
            },
            {
              world_id: "world://cosyworld/official",
              world_epoch: 1,
              seq: 3,
              type: "future.event",
              success: true,
              reason: 0,
            },
          ],
        },
      ],
    }).run;

    expect(run.expeditions[0].evidence.events).toEqual([
      expect.objectContaining({
        seq: 1,
        destination_location_name: "Lantern Road",
      }),
    ]);
    expect(run.expeditions[0].evidence.events[0]).not.toHaveProperty(
      "nested_internal_state",
    );
    expect(() =>
      preparePostcardReport(run, {
        expedition_id: "expedition-1",
        traveler_name: "Mara",
        sections: [
          {
            kind: "changed",
            text: "I found a castle.",
            source: "canonical_events",
            event_seqs: [99],
          },
          {
            kind: "who",
            text: "No one new mattered.",
            source: "truthful_quiet",
          },
          {
            kind: "next",
            text: "I intend to keep walking.",
            source: "traveler_intention",
          },
          {
            kind: "blockage",
            text: "Nothing blocked me.",
            source: "truthful_quiet",
          },
        ],
      }),
    ).toThrow(/outside its evidence packet/);
  });

  it("fails closed after an ambiguous Telegram timeout instead of sending twice", () => {
    let run = finishExpedition(initialRun(), 1);
    run = beginExpedition(run, { expedition_id: "expedition-2" });
    const accepted = acceptAction(run, "expedition-2", 1, 2);
    run = captureEvidenceWindow(accepted.run, {
      expedition_id: "expedition-2",
      pages: [
        {
          world_id: "world://cosyworld/official",
          world_epoch: 1,
          through_seq: 4,
          next_after: 4,
          events: [
            {
              world_id: "world://cosyworld/official",
              world_epoch: 1,
              seq: 3,
              type: "actor.moved",
              success: true,
              reason: 0,
            },
          ],
        },
      ],
    }).run;
    run = preparePostcardReport(run, {
      expedition_id: "expedition-2",
      traveler_name: "Mara",
      sections: [
        {
          kind: "changed",
          text: "I moved on.",
          source: "canonical_events",
          event_seqs: [3],
        },
        { kind: "who", text: "No one new mattered.", source: "truthful_quiet" },
        {
          kind: "next",
          text: "I intend to look around.",
          source: "traveler_intention",
        },
        {
          kind: "blockage",
          text: "The action itself did not repeat.",
          source: "action_receipts",
          action_intent_ids: [accepted.action.intent_id],
        },
      ],
    }).run;
    run = reserveTelegramDelivery(run, {
      expedition_id: "expedition-2",
      target_alias: "team-postcards",
      reserved_at: "2026-08-08T12:00:00Z",
    });
    const claimed = claimTelegramDelivery(run, {
      expedition_id: "expedition-2",
      chat_id: "-1001",
      claimed_at: "2026-08-08T12:00:01Z",
    });
    expect(claimed.request).toEqual(
      expect.objectContaining({
        chat_id: "-1001",
        disable_web_page_preview: true,
      }),
    );
    run = claimed.run;

    run = recordTelegramDeliveryUnknown(run, {
      expedition_id: "expedition-2",
      detail: "request timed out after the body was written",
    });
    expect(() =>
      claimTelegramDelivery(run, {
        expedition_id: "expedition-2",
        chat_id: "-1001",
        claimed_at: "2026-08-08T12:00:02Z",
      }),
    ).toThrow(/not reserved/);
    expect(() =>
      reserveTelegramDelivery(run, {
        expedition_id: "expedition-2",
        target_alias: "team-postcards",
        reserved_at: "2026-08-08T12:01:00Z",
      }),
    ).toThrow(/already reserved or complete/);

    run = acceptTelegramDelivery(run, {
      expedition_id: "expedition-2",
      telegram_message_id: 88,
      accepted_at: "2026-08-08T12:02:00Z",
      reconciled: true,
    });
    expect(run.accepted_report_cursor).toBe(4);
    expect(run.expeditions[1].report.delivery.reconciled).toBe(true);
  });

  it("serializes cron invocations and writes proof state atomically", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cosyworld-postcard-proof-"),
    );
    const filePath = path.join(directory, "run.json");
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const first = withPostcardProofLock(filePath, async () => {
      await gate;
      return initialRun();
    });
    await new Promise((resolve) => setImmediate(resolve));

    await expect(
      withPostcardProofLock(filePath, async () => initialRun()),
    ).rejects.toThrow(/fail closed/);
    release();
    await first;
    expect(readPostcardProof(filePath)).toEqual(initialRun());
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);

    writePostcardProof(filePath, initialRun());
    expect(readPostcardProof(filePath).run_id).toBe("seven-postcards-1");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("accepts only a complete seven-expedition qualitative record", () => {
    let run = initialRun();
    for (let ordinal = 1; ordinal <= 7; ordinal += 1)
      run = finishExpedition(run, ordinal);
    run = recordPostcardRecall(run, {
      location: "Mara is at Waystation 7.",
      relationship: "Gust has become the recurring road companion.",
      durable_change: "Mara crossed seven waystations without resetting.",
      expected_next:
        "Mara will follow the lantern road beyond the last station.",
    });
    run = recordPostcardDecision(run, {
      verdict: "iterate",
      rationale:
        "The story was legible, but quiet reports need a more natural opening.",
      supported_issue_moves: [
        {
          issue: 774,
          evidence_expedition_ids: ["expedition-2", "expedition-6"],
          reason:
            "Both reports made the next available Notice hard to explain.",
        },
      ],
    });

    expect(analyzePostcardProof(run)).toEqual({
      ready: true,
      expedition_count: 7,
      delivered_count: 7,
      reactions: 4,
      replies: 1,
      follow_up_questions: 1,
      requests_for_another: 1,
      gaps: [],
    });

    const duplicated = structuredClone(run);
    duplicated.expeditions[6].report.delivery.telegram_message_id =
      duplicated.expeditions[5].report.delivery.telegram_message_id;
    expect(analyzePostcardProof(duplicated).gaps).toContain(
      "expedition expedition-7 repeats Telegram message 10006",
    );
  });
});
