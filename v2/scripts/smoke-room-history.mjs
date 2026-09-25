export async function assertRoomHistoryPaging(page) {
  const routePattern = '**/room-history?**';
  const fixtureRoom = 999990001;
  const message = (seq) => ({
    seq, type: 'message.created', location_id: fixtureRoom,
    actor_id: 5000, actor_name: 'Room historian',
    content: `Saved conversation ${seq}. The garden remembers this visit.`,
  });
  const requests = [];
  await page.route(routePattern, async (route) => {
    const url = new URL(route.request().url());
    if (Number(url.searchParams.get('location_id')) !== fixtureRoom) return route.continue();
    requests.push(url.searchParams.get('before'));
    const older = url.searchParams.has('before');
    await route.fulfill({ json: {
      location_id: fixtureRoom,
      events: Array.from({ length: older ? 10 : 80 }, (_, index) => message(index + (older ? 1 : 11))),
      next_before: older ? 1 : 11,
      has_more: !older,
    } });
  });
  const viewport = page.viewportSize();
  try {
    await page.waitForFunction(() => refreshInFlight === null && !actionBusy);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async (locationId) => {
      window.__roomHistoryFixture = {
        state, logEvents, roomConversation, renderedChatTailKey,
        accountPanelPinned, libraryPanelPinned, pendingChats, pendingModelInteractions,
        pendingReflection, defeatTransition, seenSeq: [...seenSeq],
      };
      if (stream) stream.close();
      state = { ...state, location: { ...state.location, id: locationId }, journey: null };
      accountPanelPinned = false;
      libraryPanelPinned = false;
      pendingChats = [];
      pendingModelInteractions = [];
      pendingReflection = null;
      defeatTransition = null;
      logEvents = [];
      syncRoomConversation(true);
      await loadRoomConversation();
    }, fixtureRoom);
    const earlier = page.getByRole('button', { name: 'Earlier conversation', exact: true });
    await earlier.waitFor({ state: 'visible' });
    const size = await earlier.boundingBox();
    if (!size || size.height < 44 || size.width > 390) throw new Error('Room history needs a mobile-sized touch target');
    await earlier.click();
    await page.waitForFunction(() => roomConversation.loaded && !roomConversation.loading && !roomConversation.hasMore);
    const result = await page.evaluate(() => {
      const before = [...document.querySelectorAll('#log .line.chat')].map((row) => row.textContent);
      const live = {
        seq: 91, type: 'message.created', location_id: state.location.id,
        actor_id: 5000, actor_name: 'Room historian', content: 'A fresh reply after the old pages.',
      };
      pushEvents([live]);
      pushEvents(Array.from({ length: 120 }, (_, index) => ({
        seq: 92 + index, type: 'hand.shuffled', location_id: state.location.id,
      })));
      renderLog();
      return {
        before, after: document.querySelectorAll('#log .line.chat').length,
        text: document.querySelector('#log').textContent,
        width: document.documentElement.scrollWidth,
      };
    });
    if (requests.length !== 2 || requests[1] !== '11') throw new Error(`Room history used the wrong cursor: ${requests}`);
    if (result.before.length !== 90 || !result.before[0].includes('Saved conversation 1.')
        || !result.before[89].includes('Saved conversation 90.')) throw new Error('Older conversation should appear in order');
    if (result.after !== 91 || !result.text.includes('A fresh reply after the old pages.')) throw new Error('Live activity erased loaded conversation');
    if (result.width > 391) throw new Error('Room history overflowed the mobile screen');
  } finally {
    await page.unroute(routePattern);
    await page.evaluate(() => {
      const previous = window.__roomHistoryFixture;
      if (!previous) return;
      ({ state, logEvents, roomConversation, renderedChatTailKey,
        accountPanelPinned, libraryPanelPinned, pendingChats, pendingModelInteractions,
        pendingReflection, defeatTransition } = previous);
      seenSeq.clear();
      for (const seq of previous.seenSeq) seenSeq.add(seq);
      delete window.__roomHistoryFixture;
      renderTimelines();
      connectStream();
    });
    if (viewport) await page.setViewportSize(viewport);
  }
}
