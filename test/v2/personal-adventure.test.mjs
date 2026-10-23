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
