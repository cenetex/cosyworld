# Telegram postcard proof

Issue #782 tests one product hypothesis: the same traveler can live an ongoing,
truthful life in CosyWorld while a human follows that life through Telegram
postcards. The seven-expedition run is qualitative product evidence, not a new
world mechanic or a retention study.

The scheduler and Telegram transport remain external. They use the ordinary
player surface: authenticated `/state`, visibility-filtered `/events`, and
certified `/commands`. The world server remains the only authority.

## Proof helper

`v2/scripts/telegram-postcard-proof.mjs` supplies the small durable contract the
external scheduler needs. It does not hold credentials, choose actions, invent
events, call a model, or send Telegram messages. It provides:

- a stable actor/world identity for the whole run;
- deterministic action intents bound to an exact current `offer_id`;
- canonical command requests that can be retried without repeating an action;
- bounded, actor-visible event windows after the last accepted report cursor;
- four evidence-linked postcard sections;
- a fail-closed Telegram delivery reservation;
- atomic private state files and an exclusive cron lock; and
- a validator for the completed seven-expedition qualitative record.

Keep the state file outside the repository and back it up with the scheduler's
other private runtime state. The helper writes it with mode `0600`. Never put an
actor session, wallet session, bot token, Telegram authorization header, model
prompt, provider secret, or moderation record in it.

## One expedition

Run these steps under `withPostcardProofLock`. A second cron invocation then
fails closed while the first one owns the state file.

1. Recover the same actor session and fetch `/state` with `actor_id` and
   `actor_session`.
2. Begin the next expedition. Select only an enabled offer in the returned
   `action_offers` array.
3. Call `prepareExpeditionAction` and persist its returned run **before**
   submitting the command. The returned action contains the exact offer,
   observed actor/location versions, world cursor, and deterministic
   `intent_id`.
4. Add the actor session only to the outgoing request with
   `commandRequestFor`. If the request times out or the process restarts, load
   the pending action and submit that same request again. The canonical command
   receipt deduplicates the intent. Do not select a replacement offer under the
   old step or intent.
5. Accept a successful canonical receipt with `acceptExpeditionAction`. Repeat
   steps 2–5 for any additional bounded actions in the expedition.
6. Page `/events?after=<accepted-report-cursor>&limit=200` with the same actor
   identity and session. Keep the `through_seq` from the first response as the
   fixed expedition boundary. Continue from `next_after` until it reaches that
   boundary. Pass those pages to `captureEvidenceWindow`.
7. Compose exactly one `changed`, `who`, `next`, and `blockage` section. Each
   factual section cites canonical event sequences or accepted action intents.
   The next section is explicitly a traveler intention, not a world fact. Use
   `truthful_quiet` when nothing relevant changed; do not manufacture drama.
8. Persist `reserveTelegramDelivery`, then call `claimTelegramDelivery` and
   persist its returned run **before** calling Telegram. The claim returns the
   one permitted transport payload; supply the chat id only at claim time. A
   loaded `sending` claim can never produce another payload.
9. On a definite successful Telegram response, record its `message_id` with
   `acceptTelegramDelivery`. Only this transition advances the accepted report
   cursor. Then record whether the human reacted, replied, asked a follow-up, or
   requested another expedition—even when every answer is false.

The four section texts are the whole delivered body. Generated connective
prose cannot add unreferenced facts because the helper adds only fixed framing.
The evidence packet marks event text as untrusted and caps it at 200 events and
64 KiB.

## Ambiguous Telegram outcomes

Telegram `sendMessage` has no caller-supplied idempotency key. A response can be
lost after Telegram accepted the message, so automatic retry cannot guarantee
both at-least-once and at-most-once delivery.

The proof chooses at-most-once delivery. If a request times out, record
`recordTelegramDeliveryUnknown`. Future cron invocations will not produce
another send payload. Inspect the target chat:

- if the exact reserved postcard exists, call `acceptTelegramDelivery` with its
  message id and `reconciled: true`;
- if it definitely does not exist, create a new, explicitly reviewed delivery
  attempt in the external scheduler; or
- if the result remains ambiguous, leave the run stopped rather than risk a
  duplicate.

A process crash after the send claim has the same rule. A leftover `.lock`
directory is therefore an operator signal, not something to delete blindly.
Reconcile pending action receipts and any claimed Telegram report first.

## Seven-expedition record

After every accepted postcard, record feedback with
`recordExpeditionFeedback`. After the seventh, ask the human—without showing the
answers in advance—to state:

- where the traveler is;
- one relationship or recurring character;
- one durable change; and
- what they expect next.

Record those answers with `recordPostcardRecall`. Finish with
`recordPostcardDecision`: `continue`, `iterate`, or `stop`, plus the rationale.
Every issue proposed for `horizon:now` must cite the expedition ids that support
the move. An empty issue-move list is valid.

Validate the private run record with:

```sh
node v2/scripts/telegram-postcard-proof.mjs --check /private/path/run.json
```

Use `--json` for a machine-readable summary. A ready result means the record is
complete and internally consistent; it does not substitute fixtures for seven
real scheduled expeditions or human feedback.

## Required failure drills

The helper's contract tests cover the mechanical failure modes before the live
run:

- a command timeout/restart yields the identical offer-bound request and
  `intent_id`;
- an invented or stale offer is not accepted as current evidence;
- event claims cannot cite outside the accepted visibility window;
- duplicate cron invocations cannot enter the state lock together;
- an ambiguous Telegram outcome cannot produce a second send request; and
- a duplicate Telegram message receipt makes the final proof fail.

The live record should mention any failure actually observed, but the team does
not need to induce a production timeout or crash to make the seven postcards
look rigorous.
