import assert from "node:assert/strict";

const lifecycleKinds = new Set(["create_avatar", "summon_avatar", "create_rescuer", "abandon_avatar"]);
const primaryOfferKind = (kind) => kind === "travel" ? "move" : kind;

export function assertPlayerReachability(view, label, clientActions = null) {
  const primary = view.primary_action;
  assert(primary?.kind, `${label}: a primary action is required`);
  const offers = (view.action_offers || []).filter((offer) => !offer.disabled);
  const ids = new Set((view.action_offers || []).map((offer) => offer.offer_id || offer.id));
  for (const entry of view.action_hand?.entries || []) {
    for (const id of entry.offer_ids || []) {
      assert(ids.has(id), `${label}: card ${entry.card_id} refers to an undealt offer`);
    }
  }
  if (clientActions) {
    for (const action of clientActions) {
      for (const id of action.offerIds || []) {
        assert(ids.has(id), `${label}: the client created an offer outside the server hand`);
      }
    }
  }
  if (lifecycleKinds.has(primary.kind)) {
    assert(!primary.disabled, `${label}: the avatar lifecycle path is disabled`);
    if (clientActions) {
      assert(clientActions.some((action) => action.runnable && !action.disabled),
        `${label}: the client omitted the avatar lifecycle action`);
    }
    return;
  }
  if (!offers.length) {
    assert(primary.kind === "wait" && primary.disabled
      && Number(view.turn?.seat_expires_at_ms) > 0,
    `${label}: the scene needs a legal offer, a lifecycle action, or a turn deadline`);
    return;
  }
  if (!primary.disabled) {
    const matching = offers.filter((offer) => offer.kind === primaryOfferKind(primary.kind)
      || offer.command === primary.command);
    assert(matching.length, `${label}: the primary action has no legal offer`);
    if (clientActions) {
      const primaryIds = new Set(matching.map((offer) => offer.offer_id || offer.id));
      assert(clientActions.some((action) => action.runnable && !action.disabled
        && action.offerIds?.some((id) => primaryIds.has(id))),
      `${label}: the client omitted the primary action's dealt offer`);
    }
  }
  if (clientActions) {
    const available = new Set(offers.map((offer) => offer.offer_id || offer.id));
    assert(clientActions.some((action) => action.runnable && !action.disabled
      && action.offerIds?.some((id) => available.has(id))),
    `${label}: the client hand needs a runnable dealt action`);
  }
}

export async function assertBrowserReachability(page, label) {
  const { view, actions } = await page.evaluate(() => ({
    view: {
      primary_action: state.primary_action,
      action_offers: state.action_offers,
      action_hand: state.action_hand,
      turn: state.turn,
    },
    actions: buildActions(state).map((action) => ({
      offerIds: action.offerIds || [], disabled: Boolean(action.disabled),
      runnable: typeof action.run === "function",
    })),
  }));
  assertPlayerReachability(view, label, actions);
}
