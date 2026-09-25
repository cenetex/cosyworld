import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('../../v2/orchestrator-rust/src/index.html', import.meta.url), 'utf8');
const historySource = html.slice(html.indexOf('    function syncRoomConversation('), html.indexOf('    async function exportJournal('));
const transcriptSource = html.slice(html.indexOf('    function sharedRoomTranscriptEvents('), html.indexOf('    function narratedTranscriptEvents('));
const message = (seq, location_id = 1) => ({ seq, location_id, type: 'message.created', content: `line ${seq}` });

function game(api = async () => ({ location_id: 1, events: [], has_more: false, next_before: null })) {
  const log = { scrollTop: 30, scrollHeight: 200 };
  const context = vm.createContext({
    state: { location: { id: 1 } }, roomConversation: { locationId: 0 },
    renderedChatTailKey: '', URLSearchParams, api,
    eventIsChatTranscriptEvent: (event) => event.type === 'message.created',
    eventIsMuted: (event) => event.actor_id === 99,
    narratedTranscriptEvents: (events) => events,
    appendLogEvent: (event, target) => target.push(event),
    $: () => log,
  });
  context.renderLog = () => { log.scrollHeight = 200 + context.roomConversation.events.length * 50; };
  vm.runInContext(historySource + transcriptSource, context);
  context.syncRoomConversation();
  return { context, log };
}

describe('persistent room conversation', () => {
  it('keeps conversation when the short event feed fills with other room activity', () => {
    const { context } = game();
    context.mergeRoomConversation(Array.from({ length: 160 }, (_, index) => message(index + 1)));
    const otherRoom = Array.from({ length: 90 }, (_, index) => message(index + 161, 2));
    expect(context.sharedRoomTranscriptEvents(otherRoom)).toHaveLength(160);
    context.mergeRoomConversation([message(160), message(161), { ...message(162), actor_id: 99 }]);
    expect(context.sharedRoomTranscriptEvents([message(161)])).toHaveLength(161);
    expect(context.roomConversation.events.at(-1).seq).toBe(161);
  });

  it('loads earlier pages in order, keeps live replies, and holds the scroll position', async () => {
    const requests = [];
    let finish;
    const { context, log } = game(async (url) => {
      requests.push(url);
      if (requests.length === 1) return { location_id: 1, events: [message(3), message(4)], next_before: 3, has_more: true };
      return new Promise((resolve) => { finish = resolve; });
    });
    await context.loadRoomConversation();
    log.scrollTop = 0;
    const loading = context.loadRoomConversation(true);
    context.mergeRoomConversation([message(5)]);
    context.renderLog();
    finish({ location_id: 1, events: [message(1), message(2)], next_before: 1, has_more: false });
    await loading;
    expect(requests[1]).toContain('location_id=1&limit=80&before=3');
    expect(context.roomConversation.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(log.scrollTop).toBe(100);
    expect(context.roomConversationControlHtml()).toBe('');
  });

  it('ignores an old room response after moving and restores history on return', async () => {
    let finish;
    const { context } = game(() => new Promise((resolve) => { finish = resolve; }));
    const loading = context.loadRoomConversation();
    context.state = { location: { id: 2 } };
    context.syncRoomConversation();
    finish({ location_id: 1, events: [message(1)], next_before: 1, has_more: false });
    await loading;
    expect(context.roomConversation.locationId).toBe(2);
    expect(context.roomConversation.events).toHaveLength(0);
    context.state = { location: { id: 1 } };
    context.syncRoomConversation();
    context.api = async () => ({ location_id: 1, events: [message(1)], next_before: 1, has_more: false });
    await context.loadRoomConversation();
    expect(context.roomConversation.events.map((event) => event.seq)).toEqual([1]);
  });

  it('offers retry after failure while preserving messages already displayed', async () => {
    const { context } = game(async () => { throw new Error('offline'); });
    context.mergeRoomConversation([message(10)]);
    await context.loadRoomConversation();
    expect(context.roomConversationControlHtml()).toContain('Retry conversation');
    expect(context.roomConversation.events.map((event) => event.seq)).toEqual([10]);
    context.api = async () => ({ location_id: 1, events: [message(9), message(10)], next_before: 9, has_more: false });
    await context.loadRoomConversation();
    expect(context.roomConversation.error).toBe(false);
    expect(context.roomConversation.events.map((event) => event.seq)).toEqual([9, 10]);
  });

  it('discards an in-flight page at a world reset', async () => {
    let finish;
    const { context } = game(() => new Promise((resolve) => { finish = resolve; }));
    const loading = context.loadRoomConversation();
    context.syncRoomConversation(true);
    finish({ location_id: 1, events: [message(1)], next_before: 1, has_more: false });
    await loading;
    expect(context.roomConversation.events).toHaveLength(0);
    expect(context.roomConversation.loaded).toBe(false);
  });
});
