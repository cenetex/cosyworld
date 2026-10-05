import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
const html = fs.readFileSync(new URL('../../v2/orchestrator-rust/src/index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('    function adventureModel('), html.indexOf('    function renderAdventure('));
const tale = {
  destination_location_id: 2, shared_progress: 1, shared_goal: 4,
  instruction: 'Clear the drain.', completion_memory: 'You marked a stone.', next_invitation: 'Visit Mara.',
  presentation: { title: 'Rati’s path', premise: 'Help Rati.', recognition: 'Your help is recorded.', scene: 'garden_path' },
};
function model(firstTale = tale) {
  const context = vm.createContext({ state: { location: { id: 2 }, first_tale: firstTale }, escapeHtml: (text) => text });
  vm.runInContext(source, context);
  return vm.runInContext('adventureModel()', context);
}
describe('a saved personal adventure in a shared garden', () => {
  it('shows shared progress separately from personal contribution', () => {
    expect(model()).toMatchObject({ progress: 1, goal: 4, memory: '', recognition: '', invitation: '' });
    expect(model({ ...tale, trace_event_seq: 32, recognition: 'Your help is recorded.' })).toMatchObject({ progress: 1, memory: 'You marked a stone.', recognition: 'Your help is recorded.' });
  });
  it('shows a finished path to a late arrival with their next contribution still open', () => {
    expect(model({ ...tale, shared_progress: 4 })).toMatchObject({ status: 'The garden path is open.', memory: '', instruction: 'Clear the drain.' });
  });
  it('restores the personal memory and current invitation from the server after reload', () => {
    const saved = JSON.parse(JSON.stringify({ ...tale, shared_progress: 4, trace_event_seq: 32, continuation: { instruction: 'Find Mara at the inn.' } }));
    expect(model(saved)).toMatchObject({ memory: 'You marked a stone.', invitation: 'Visit Mara.', instruction: 'Find Mara at the inn.' });
  });
  it('supports other worlds through their own authored story', () => {
    expect(model({ ...tale, presentation: undefined, question: 'Recover the signal.', consequence: 'Help the witnesses.' })).toMatchObject({ title: 'Recover the signal.', premise: 'Help the witnesses.', garden: false });
    expect(model(null)).toBeNull();
  });
});


describe('visible adventure receipts', () => {
  function receipts({ memoryVisible = false, journalOpen = false } = {}) {
    const recorded = [];
    const context = vm.createContext({
      actorId: 1, actorSession: 'test', journalOpen, libraryPanelPinned: false, accountPanelPinned: false,
      document: { visibilityState: 'visible' }, activeModal: () => false,
      state: { ledger: { advancement_points: 1 } },
      $: () => ({ hidden: journalOpen, getClientRects: () => [1], querySelector: (selector) => ({ selector }) }),
      worldBeatRowIsActuallyVisible: (row) => row.selector === '[data-first-tale-presentation]' || (memoryVisible && row.selector === '[data-first-tale-completion-memory]'),
      acknowledgeFirstTalePresentation: (kind) => recorded.push(kind),
    });
    vm.runInContext(html.slice(html.indexOf('    function acknowledgeVisibleFirstTalePresentations()'), html.indexOf('    async function acknowledgeFirstTalePresentation(')), context);
    vm.runInContext('acknowledgeVisibleFirstTalePresentations()', context);
    return recorded;
  }
  it('acknowledges the completion memory only when its own paragraph is visible', () => {
    expect(receipts()).toEqual(['phase_seen']);
    expect(receipts({ memoryVisible: true })).toEqual(['phase_seen', 'completion_memory_seen']);
  });
  it('records a Journal return while the scene panel is hidden', () => {
    expect(receipts({ journalOpen: true })).toEqual(['journal_opened_after_growth']);
  });
});


describe('quest dismissal', () => {
  it('keeps the quest dismissed after refresh and reload, scoped to one avatar and quest', () => {
    const storage = new Map();
    const create = () => {
      const context = vm.createContext({ actorId: 7, state: { first_tale: { job_id: 'garden' } },
        localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        renderAdventure: () => {}, $: () => ({ focus() {} }),
      });
      vm.runInContext(html.slice(html.indexOf('    const dismissedAdventures'), html.indexOf('    function renderAdventure(')), context);
      return context;
    };
    const first = create();
    vm.runInContext('dismissAdventure()', first);
    expect(vm.runInContext('adventureIsDismissed()', first)).toBe(true);
    const reload = create();
    expect(vm.runInContext('adventureIsDismissed()', reload)).toBe(true);
    reload.actorId = 8;
    expect(vm.runInContext('adventureIsDismissed()', reload)).toBe(false);
    reload.actorId = 7;
    reload.state.first_tale.job_id = 'another';
    expect(vm.runInContext('adventureIsDismissed()', reload)).toBe(false);
  });
});


describe('the keeper journey and return to Rati', () => {
  const journey = {
    title: 'The road back to Rati', instruction: 'Return to Rati with the road’s news.',
    outcome: 'The beacon is lit.', recognition: 'Rati remembers your part: used the lens.',
    contributions: ['used the lens'], shared_progress: 6, shared_goal: 6,
    next_request: { job_id: 'next-job', destination_location_id: 5, question: 'Help with the echoes.' },
  };
  it('shows the current road result, personal credit, and live next request after reload', () => {
    const saved = JSON.parse(JSON.stringify({ ...tale, trace_event_seq: 32, journey }));
    expect(model(saved)).toMatchObject({ title: journey.title, progress: 6, goal: 6,
      memory: journey.outcome, recognition: journey.recognition, invitation: 'Help with the echoes.',
      instruction: journey.instruction, garden: false, contributions: ['used the lens'] });
  });
  it('shows shared completion and the late visitor’s own news', () => {
    expect(model({ ...tale, trace_event_seq: 33, journey: { ...journey, contributions: [], recognition: 'Rati welcomes your road news.' } }))
      .toMatchObject({ progress: 6, recognition: 'Rati welcomes your road news.', contributions: [] });
  });
  it('uses the current beacon progress while the road is active', () => {
    expect(model({ ...tale, shared_progress: 4, trace_event_seq: 32,
      journey: { ...journey, shared_progress: 0, outcome: '', recognition: null, next_request: null } }))
      .toMatchObject({ progress: 0, goal: 6, recognition: '', invitation: '', garden: false });
  });
  it('updates the invitation when the world changes', () => {
    const first = model({ ...tale, trace_event_seq: 32, journey });
    const changed = model({ ...tale, trace_event_seq: 32, journey: { ...journey, next_request: { question: 'Help at the threshold.' } } });
    expect(first.invitation).toBe('Help with the echoes.');
    expect(changed.invitation).toBe('Help at the threshold.');
    expect(changed.recognition).toBe(first.recognition);
  });
});
