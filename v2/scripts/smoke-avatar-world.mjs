import assert from 'node:assert/strict';

export async function assertAvatarWorldControls(page, screenshotDir = '') {
  const viewport = page.viewportSize();
  const stateRoute = (url) => url.pathname === '/state';
  const autonomyRoute = '**/avatar/autonomy';
  const requests = [];
  let fixture;
  try {
    await page.waitForFunction(() => refreshInFlight === null && !actionBusy);
    await page.setViewportSize({ width: 390, height: 844 });
    fixture = await page.evaluate(() => {
      window.__avatarWorldFixture = {
        state, accountPanelPinned, libraryPanelPinned, avatarAutonomyDraft,
        avatarAutonomyOpen, avatarAutonomyNotice, storyHandExpanded,
        storyHandActiveKey, sceneMeldKeys, sceneMeldOfferId,
      };
      if (stream) stream.close();
      const locationId = state.location.id;
      const holder = state.actors.find((actor) => actor.id !== actorId) || { id: 99001, name: 'Rati', location_id: locationId };
      const item = (id, name, holderId = null) => ({ id, name, holder_actor_id: holderId, location_id: locationId, role: 'item', kind: 'trinket' });
      const items = [item(99010, 'Void Token'), item(99011, 'Garden Tonic', holder.id)];
      const itemCard = (item) => ({ card_id: `item-${item.id}`, display_name: item.name, role: 'item', blurb: 'A keepsake from this place.', image_url: '' });
      const itemEntry = { card_id: 'fixture-item', entity_kind: 'item', entity_id: 99010, card_type: 'item', label: 'Void Token', offer_ids: [], think: { available: false } };
      state = {
        ...state, items, actors: [...state.actors.filter((actor) => actor.id !== holder.id), holder],
        cards: { ...state.cards, items: Object.fromEntries(items.map((item) => [String(item.id), itemCard(item)])) },
        action_hand: { ...state.action_hand, entries: [...state.action_hand.entries.filter((entry) => entry.card_type !== 'item'), itemEntry] },
        avatar_autonomy: { generation: 0, enabled: false, scope: 'speech_and_actions', action_limit: 8, remaining_actions: 8, speech_limit: 2, remaining_speech: 2, estimated_spend_limit_microdollars: 4000, goal_item_id: null, goal_status: 'none' },
      };
      accountPanelPinned = false;
      libraryPanelPinned = false;
      avatarAutonomyDraft = null;
      avatarAutonomyOpen = false;
      closeStoryHand();
      render();
      return state;
    });
    await page.route(stateRoute, (route) => route.fulfill({ json: fixture }));
    await page.route(autonomyRoute, async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      assert.equal(body.expected_generation, fixture.avatar_autonomy.generation);
      fixture.avatar_autonomy = {
        ...fixture.avatar_autonomy,
        generation: body.expected_generation + 1, enabled: body.enabled,
        scope: body.scope, action_limit: body.action_limit, remaining_actions: body.action_limit,
        speech_limit: body.speech_limit, remaining_speech: body.speech_limit,
        goal_item_id: body.goal_item_id, goal_status: body.goal_item_id ? 'seeking' : 'none',
        estimated_spend_limit_microdollars: body.speech_limit * 2000,
      };
      await route.fulfill({ json: { ok: true, status: 0, avatar_autonomy: fixture.avatar_autonomy, events: [] } });
    });
    const itemsButton = page.getByRole('button', { name: 'Browse 2 known items here' });
    await itemsButton.click();
    const list = page.locator('#room-items-list');
    await list.waitFor({ state: 'visible' });
    assert.equal(await list.locator('.room-item-row').count(), 2);
    assert.match(await list.textContent(), /Carried by/);
    assert.match(await list.textContent(), /On the ground/);
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/mobile-room-items.png` });
    await list.getByRole('button', { name: /Garden Tonic/ }).click();
    assert.equal(await page.getByRole('button', { name: 'View in hand', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'All items here', exact: true }).click();
    await list.getByRole('button', { name: /Void Token/ }).click();
    await page.getByRole('button', { name: 'View in hand', exact: true }).click();
    assert.equal(await page.locator('#card-modal').isVisible(), false);
    assert.equal(await page.locator('#scene-meld').isVisible(), true);
    await page.getByRole('button', { name: 'Close card actions', exact: true }).click();
    await page.getByRole('button', { name: 'Open Menu', exact: true }).click();
    await page.locator('.avatar-autonomy summary').click();
    await page.getByLabel('Action allowance', { exact: true }).fill('3');
    await page.getByLabel('Reply allowance', { exact: true }).fill('1');
    await page.getByLabel('Item to seek', { exact: true }).selectOption('99010');
    await page.evaluate(() => renderLog());
    assert.equal(await page.getByLabel('Action allowance', { exact: true }).inputValue(), '3');
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/mobile-avatar-allowance.png` });
    await page.getByRole('button', { name: 'Start this allowance', exact: true }).click();
    await page.getByRole('button', { name: 'Pause and take control', exact: true }).waitFor({ state: 'visible' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].action_limit, 3);
    assert.equal(requests[0].speech_limit, 1);
    assert.equal(requests[0].goal_item_id, 99010);
    await page.getByRole('button', { name: 'Pause and take control', exact: true }).click();
    await page.getByRole('button', { name: 'Start this allowance', exact: true }).waitFor({ state: 'visible' });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].enabled, false);
    assert.equal(requests[1].expected_generation, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 391), true);
  } finally {
    await page.unroute(stateRoute);
    await page.unroute(autonomyRoute);
    await page.evaluate(() => {
      const previous = window.__avatarWorldFixture;
      if (!previous) return;
      closeCardModal();
      ({ state, accountPanelPinned, libraryPanelPinned, avatarAutonomyDraft,
        avatarAutonomyOpen, avatarAutonomyNotice, storyHandExpanded,
        storyHandActiveKey, sceneMeldKeys, sceneMeldOfferId } = previous);
      delete window.__avatarWorldFixture;
      render();
      connectStream();
    });
    if (viewport) await page.setViewportSize(viewport);
  }
}
