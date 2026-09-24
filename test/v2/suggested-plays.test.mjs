import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('../../v2/orchestrator-rust/src/index.html', import.meta.url), 'utf8');
const functions = html.slice(html.indexOf('    function sceneMeldResolutionRank('), html.indexOf('    function renderSceneMeld('));
const buildActionsSource = html.slice(html.indexOf('    function buildActions('), html.indexOf('    function mergeDuplicateUseCards('));
function game() {
  const cards = [
    { nounCard: true, handKey: 'place', nounEntry: { card_id: 'place', entity_kind: 'location', entity_id: 1 } },
    { nounCard: true, handKey: 'friend', nounEntry: { card_id: 'friend', entity_kind: 'actor', entity_id: 2 } },
    { nounCard: true, handKey: 'gift', nounEntry: { card_id: 'gift', entity_kind: 'item', entity_id: 3 } },
  ];
  const offers = [
    { offer_id: 'walk', kind: 'move', label: 'Walk to the garden' },
    { offer_id: 'talk', kind: 'chat', target: { kind: 'actor', id: 2 } },
    { offer_id: 'give', kind: 'give_item', source_collectible: { kind: 'item', instance_id: 3 }, target: { kind: 'actor', id: 2 } },
  ];
  const context = vm.createContext({
    actorId: 9, sceneMeldOfferId: '', sceneMeldKeys: ['place'], cards,
    actions: offers.map((offer) => ({ label: offer.kind, offerIds: [offer.offer_id] })),
    state: { location: { id: 1 }, action_offers: offers, action_hand: { entries: cards.map((card, index) => ({ ...card.nounEntry, offer_ids: [[ 'walk' ], [ 'talk' ], [ 'give' ]][index] })) } },
    storyHandKey: (card) => card?.handKey || "",
    sceneMeldEntityKey: (card) => card.nounEntry.card_id,
    actionBarActions: () => cards,
  });
  vm.runInContext(functions, context);
  return context;
}

describe('suggested plays from the current hand', () => {
  it('builds and plays the late arrival room check after shared discoveries are spent', async () => {
    const context = game();
    const offer = {
      offer_id: 'late-arrival-check', kind: 'check', intention: 'notice',
      verb: 'Notice', command: 'listen',
      target: { kind: 'location', id: 1, label: 'Rain-Soft Garden' },
      effect: 'Leave your own mark on the open garden path.',
    };
    context.state.action_offers = [offer];
    context.state.action_hand.entries[0].offer_ids = [offer.offer_id];
    context.state.first_tale = { phase: 'contribute', advancing_offer_id: offer.offer_id };
    context.state.clocks = [{ id: 'garden', filled: 4, segments: 4 }];
    const submissions = [];
    Object.assign(context, {
      cardForLocation: (id) => ({ id }),
      activePathwayJourney: () => null,
      projectProgressDetail: () => '',
      compareActions: () => 0,
      runCommandText: (command, certificate) => submissions.push({ command, certificate }),
    });
    vm.runInContext(buildActionsSource, context);
    context.actions = vm.runInContext('buildActions(state)', context);
    const resolution = vm.runInContext('sceneMeldResolution()', context);
    expect(resolution.chosenOffer?.offer_id).toBe(offer.offer_id);
    const playable = context.actions.find((action) => action.offerIds.includes(offer.offer_id));
    expect(playable.accessibleLabel).toBe('Notice Rain-Soft Garden');
    await playable.run();
    expect(submissions).toEqual([{ command: 'listen', certificate: offer }]);
  });
  it('finds a gift that needs both the item and its recipient', () => {
    const context = game();
    const plays = vm.runInContext('suggestedScenePlays()', context);
    expect(plays.map((play) => play.chosenOffer.offer_id)).toEqual(['walk', 'talk', 'give']);
    expect([...plays[2].keys]).toEqual(['friend', 'gift']);
    expect([...context.sceneMeldKeys]).toEqual(['place']);
  });
  it('deduplicates plays and uses the smallest valid card combination', () => {
    const plays = vm.runInContext('suggestedScenePlays()', game());
    expect(plays.filter((play) => play.chosenOffer.offer_id === 'talk')).toHaveLength(1);
    expect([...plays[1].keys]).toEqual(['friend']);
  });
  it('drops a suggestion when its recipient leaves the hand', () => {
    const context = game();
    context.cards.splice(1, 1);
    const plays = vm.runInContext('suggestedScenePlays()', context);
    expect(plays.map((play) => play.chosenOffer.offer_id)).toEqual(['walk']);
  });
  it('offers only actions that the current client can submit', () => {
    const context = game();
    context.actions = context.actions.filter((action) => action.offerIds[0] !== 'give');
    expect(vm.runInContext('suggestedScenePlays()', context).map((play) => play.chosenOffer.offer_id)).toEqual(['walk', 'talk']);
  });
  it('handles an empty hand', () => {
    expect(vm.runInContext('suggestedScenePlays([])', game())).toHaveLength(0);
  });
});


describe('deliberate approach selection', () => {
  it('offers each legal approach from one place card and honors the chosen one', () => {
    const context = game();
    const offer = { offer_id: 'inspect', kind: 'check' };
    context.state.action_offers.push(offer);
    context.state.action_hand.entries[0].offer_ids.push('inspect');
    context.actions.push({ label: 'Inspect', offerIds: ['inspect'] });
    const plays = vm.runInContext('suggestedScenePlays()', context);
    expect(plays.map((play) => play.chosenOffer.offer_id)).toContain('walk');
    expect(plays.map((play) => play.chosenOffer.offer_id)).toContain('inspect');
    context.sceneMeldOfferId = 'inspect';
    expect(vm.runInContext('sceneMeldResolution().chosenOffer.offer_id', context)).toBe('inspect');
    context.sceneMeldOfferId = 'walk';
    expect(vm.runInContext('sceneMeldResolution().chosenOffer.offer_id', context)).toBe('walk');
  });
  it('reconciles a stale choice against the current card authority', () => {
    const context = game();
    context.sceneMeldOfferId = 'give';
    expect(vm.runInContext('sceneMeldResolution().chosenOffer.offer_id', context)).toBe('walk');
    expect(vm.runInContext('sceneMeldResolution().candidates.map(offer => offer.offer_id)', context)).not.toContain('give');
  });
});

describe('card ownership labels', () => {
  it('uses the exact item instance when two cards share a name', () => {
    const context = game();
    context.state.items = [
      { id: 4, name: 'Tonic', holder_actor_id: 9, location_id: 1 },
      { id: 3, name: 'Tonic', holder_actor_id: 2, location_id: 1 },
    ];
    context.state.actors = [{ id: 2, name: 'Rati' }];
    expect(vm.runInContext('storyHandNounState(cards[2])', context)).toBe('With Rati');
    context.state.items[1].holder_actor_id = 9;
    expect(vm.runInContext('storyHandNounState(cards[2])', context)).toBe('In your pack');
    context.state.items[1].holder_actor_id = 0;
    expect(vm.runInContext('storyHandNounState(cards[2])', context)).toBe('On the ground');
  });
  it('keeps missing item ownership unknown', () => {
    expect(vm.runInContext('storyHandNounState(cards[2])', game())).toBe('Item');
  });
});


describe('card action recovery', () => {
  it('selects a playable action when a higher ranked offer has no client action', () => {
    const context = game();
    context.state.action_offers.push({ offer_id: 'missing', kind: 'accept_transfer' });
    context.state.action_hand.entries[0].offer_ids.push('missing');
    context.sceneMeldOfferId = 'missing';
    expect(vm.runInContext('sceneMeldResolution().chosenOffer.offer_id', context)).toBe('walk');
  });
  it('keeps a tapped item selected until the player adds its recipient', () => {
    const context = game();
    Object.assign(context, {
      actionBusy: false, storyHandExpanded: false, storyHandActiveKey: '',
      usesInlineStoryHand: () => true,
      actionHandKey: (card) => card.handKey,
      setStoryHandExpanded: (expanded) => { context.storyHandExpanded = expanded; },
      renderCommands: () => {},
    });
    vm.runInContext(html.slice(html.indexOf('    function activateStoryHandAction('), html.indexOf('    function closeStoryHand(')), context);
    vm.runInContext('activateStoryHandAction(cards[2])', context);
    expect(context.storyHandExpanded).toBe(true);
    expect([...context.sceneMeldKeys]).toEqual(['gift']);
    expect(vm.runInContext('selectedScenePlays()', context)).toHaveLength(0);
    vm.runInContext('activateStoryHandAction(cards[1])', context);
    expect([...context.sceneMeldKeys]).toEqual(['gift', 'friend']);
    expect(vm.runInContext('selectedScenePlays().map(play => play.chosenOffer.offer_id)', context)).toEqual(['give']);
    vm.runInContext('activateStoryHandAction(cards[1])', context);
    expect([...context.sceneMeldKeys]).toEqual(['gift']);
    expect(vm.runInContext('selectedScenePlays()', context)).toHaveLength(0);
  });
  it('offers Think directly when the open card has no playable action', () => {
    const context = game();
    context.actions = [];
    const nodes = new Map();
    Object.assign(context, {
      storyHandExpanded: true, storyHandActiveKey: 'place', actionBusy: false, handShuffleBusy: false,
      usesInlineStoryHand: () => true, activeHeldStoryHandActions: () => null,
      $: (id) => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
      canDiscardHandCard: () => true, handCardThink: () => ({ free: true }),
      sceneMeldCardTypeLabel: () => "Location", friendlyActionText: (text) => text,
      storyHandActionWaitsForTurn: () => false, originalStoryHandAction: (card) => card,
    });
    vm.runInContext(html.slice(html.indexOf('    function renderSceneMeld('), html.indexOf('    function playSceneMeld(')), context);
    vm.runInContext('renderSceneMeld(cards)', context);
    expect(nodes.get('scene-meld-play')).toMatchObject({ hidden: false, disabled: false, textContent: 'Think · Free' });
    context.storyHandExpanded = false;
    vm.runInContext('renderSceneMeld(cards)', context);
    expect(nodes.get('scene-meld').hidden).toBe(true);
  });
});


it('keeps the displayed card and submitted action together during keyboard navigation', () => {
  const context = game();
  Object.assign(context, {
    storyHandExpanded: true, storyHandActiveKey: 'place', focusedKey: '', focusIndex: 0,
    usesInlineStoryHand: () => true, originalStoryHandAction: (card) => card,
    renderRoomAvatarRail: () => {}, renderCommands: () => {}, $: () => ({ focus() {} }),
  });
  vm.runInContext(html.slice(html.indexOf('    function moveVisibleActionFocus('), html.indexOf('    function isDefinitivePassRejection(')), context);
  vm.runInContext('moveVisibleActionFocus(1)', context);
  expect(context.storyHandActiveKey).toBe('friend');
  expect([...context.sceneMeldKeys]).toEqual(['friend']);
  expect(vm.runInContext('sceneMeldResolution().chosenOffer.offer_id', context)).toBe('talk');
});
