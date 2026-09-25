import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('../../v2/orchestrator-rust/src/index.html', import.meta.url), 'utf8');
const itemSource = html.slice(html.indexOf('    function disclosedRoomItems('), html.indexOf('    function nearbyLocationPanelHtml('));
const autonomySource = html.slice(html.indexOf('    function autonomyDraft('), html.indexOf('    function minimalMenuPanelHtml('));
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

function game() {
  const hand = [{ sceneCardType: 'item', nounEntry: { entity_kind: 'item', entity_id: 10, think: { available: true, offer_id: 'think-item', free: true } } }];
  const state = {
    location: { id: 652000, name: 'Void 001' }, actors: [{ id: 2, name: 'Rati' }],
    items: [
      { id: 10, name: 'Token A', location_id: 652000, holder_actor_id: null },
      { id: 11, name: '<Tonic>', location_id: 652000, holder_actor_id: null },
      { id: 12, name: 'Button', holder_actor_id: 2 },
      { id: 13, name: 'Your charm', holder_actor_id: 1 },
    ],
    avatar_autonomy: { generation: 4, enabled: false, scope: 'speech_and_actions', action_limit: 8, speech_limit: 2 },
  };
  const context = vm.createContext({
    state, actorId: 1, actorSession: 'owner-session', avatarAutonomyDraft: null,
    avatarAutonomyOpen: true, avatarAutonomyBusy: false, avatarAutonomyNotice: '',
    escapeHtml: escape, escapeAttr: escape, actionBarActions: () => hand,
    projectedHandEntryForAction: (action) => action?.nounEntry,
    communityArtSubject: (card) => card,
    cardForItem: (id) => ({ kind: 'item', id }), cardImage: () => '',
    cardDataAttr: (card) => ` data-card-key="item:${card.id}"`,
    itemForId: (id) => state.items.find((item) => item.id === id),
    itemNameForId: (id) => state.items.find((item) => item.id === id)?.name || 'an unknown item',
    actorNameForId: (id) => state.actors.find((actor) => actor.id === id)?.name,
    renderLog: () => {}, renderCommands: () => {}, setError: () => {}, refresh: async () => {},
  });
  vm.runInContext(itemSource + autonomySource, context);
  return { context, hand, state };
}

describe('room items outside the dealt hand', () => {
  it('shows disclosed floor, carried, and owned items while keeping the hand intact', () => {
    const { context, hand } = game();
    expect(context.disclosedRoomItems().map((item) => item.id)).toEqual([10, 11, 12, 13]);
    const panel = context.roomItemsPanelHtml({ kind: 'location', id: 652000 });
    expect(panel).toContain('Token A');
    expect(panel).toContain('&lt;Tonic>');
    expect(panel).toContain('Carried by Rati');
    expect(panel).toContain('In your pack');
    expect(hand).toHaveLength(1);
    expect(context.itemCardPanelHtml({ kind: 'item', id: 10 })).toContain('View in hand');
    expect(context.itemCardPanelHtml({ kind: 'item', id: 11 })).toContain('Think · Free');
    expect(context.itemCardPanelHtml({ kind: 'item', id: 11 })).not.toContain('data-room-item-hand');
  });

  it('handles a clear floor and a stale item card without suggesting an illegal play', () => {
    const { context, hand, state } = game();
    state.items = state.items.filter((item) => item.holder_actor_id);
    expect(context.roomItemsPanelHtml({ kind: 'location', id: 652000 })).toContain('The ground is clear');
    expect(context.itemCardPanelHtml({ kind: 'item', id: 10 })).toBe('');
    hand[0].nounEntry.think.available = false;
    expect(context.itemCardPanelHtml({ kind: 'item', id: 12 })).not.toContain('data-room-item-think');
  });
});

describe('owner autonomy controls', () => {
  it('starts an explicit allowance with current generation and prevents duplicate clicks', async () => {
    const { context } = game();
    let finish;
    const calls = [];
    context.postResult = (url, body) => { calls.push({ url, body }); return new Promise((resolve) => { finish = resolve; }); };
    context.autonomyDraft().goal_item_id = 11;
    const saving = context.setAvatarAutonomy(true);
    await context.setAvatarAutonomy(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ url: '/avatar/autonomy', body: {
      actor_id: 1, actor_session: 'owner-session', enabled: true,
      scope: 'speech_and_actions', action_limit: 8, speech_limit: 2,
      goal_item_id: 11, expected_generation: 4,
    } });
    finish({ ok: true });
    await saving;
    expect(context.avatarAutonomyBusy).toBe(false);
  });

  it('refreshes a draft after another session changes the allowance', () => {
    const { context, state } = game();
    context.autonomyDraft().action_limit = 12;
    Object.assign(state.avatar_autonomy, { generation: 5, action_limit: 2, speech_limit: 1 });
    const draft = context.autonomyDraft();
    expect(draft.generation).toBe(5);
    expect(draft.action_limit).toBe(2);
    expect(draft.speech_limit).toBe(1);
  });

  it('limits talk mode to speech and requires a positive allowance', async () => {
    const { context } = game();
    const calls = [];
    context.postResult = async (_, body) => { calls.push(body); return { ok: true }; };
    Object.assign(context.autonomyDraft(), { scope: 'speech', goal_item_id: 11, speech_limit: 0 });
    await context.setAvatarAutonomy(true);
    expect(calls).toHaveLength(0);
    context.autonomyDraft().speech_limit = 1;
    await context.setAvatarAutonomy(true);
    expect(calls[0].action_limit).toBe(0);
    expect(calls[0].goal_item_id).toBe(null);
  });

  it('shows current remaining budget, offers pause, and refreshes after a stale setting', async () => {
    const { context, state } = game();
    Object.assign(state.avatar_autonomy, { enabled: true, remaining_actions: 3, remaining_speech: 1, estimated_spend_limit_microdollars: 4000 });
    expect(context.avatarAutonomyPanelHtml()).toContain('3 actions · 1 reply left');
    expect(context.avatarAutonomyPanelHtml()).toContain('Pause and take control');
    expect(context.avatarAutonomyPanelHtml()).not.toContain('Start this allowance');
    let refreshed = 0;
    context.refresh = async () => { refreshed++; };
    context.postResult = async () => ({ ok: false, status: 409 });
    await context.setAvatarAutonomy(false);
    expect(refreshed).toBe(1);
    expect(context.avatarAutonomyNotice).toContain('allowance changed');
    expect(context.avatarAutonomyBusy).toBe(false);
  });
});
