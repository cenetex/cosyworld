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
