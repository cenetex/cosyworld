import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('../../v2/orchestrator-rust/src/index.html', import.meta.url), 'utf8');
const functions = html.slice(html.indexOf('    function sceneMeldResolutionRank('), html.indexOf('    function renderSceneMeld('));
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
    storyHandKey: (card) => card.handKey,
    sceneMeldEntityKey: (card) => card.nounEntry.card_id,
    actionBarActions: () => cards,
  });
  vm.runInContext(functions, context);
  return context;
}

describe('suggested plays from the current hand', () => {
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
