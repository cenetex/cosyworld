from pathlib import Path

p=Path('v2/card-game/app.mjs');s=p.read_text()
s=s.replace('  witnessed,\n','')
s=s.replace('"choose",\n    "move",','"choose",\n    "move",\n    "ring",')
s=s.replace('"choose", "move"].includes(action.kind)', '"choose", "move", "ring"].includes(action.kind)')
s=s.replace('entry.kind === "dialogue" && witnessed(entry)','entry.kind === "dialogue" && entry.generated === true')
s=s.replace('e.kind === "dialogue" && witnessed(e)','e.kind === "dialogue" && e.generated === true')
s=s.replace('// Words and the world\'s own account, so every turn is recorded even when\n  // its words fail or are still on the way.','// Only spoken lines belong in this optional conversation record.\n  // Rule receipts and hidden counters stay in the save, not on the screen.')
s=s.replace('  dialog.addEventListener("close", () => dialog.remove(), { once: true });','  dialog.addEventListener("close", () => { dialog.remove(); pauseSpeech(); }, { once: true });')
s=s.replace('  document.body.append(dialog);\n  dialog.showModal();','  document.body.append(dialog);\n  dialog.showModal();\n  pauseSpeech();')
s=s.replace('`cosyworld-scene-turn-${world.turn}.json`','"cosyworld-conversation.json"')
p.write_text(s)
# Reserve the dialogue safe area while retaining one coordinate space for the
# resident and the painted backdrop. No crossing or temperament rule changes.
p=Path('v2/card-game/awakening.css');s=p.read_text().replace('  inset: 0 0 124px;', '  inset: 0 0 calc(var(--dock-height) + 72px);').replace('  bottom: 10px;', '  bottom: calc(var(--dock-height) + 8px);').replace('    bottom: 132px;', '    bottom: calc(var(--dock-height) + 72px);');p.write_text(s)
p=Path('v2/card-game/index.html');s=p.read_text().replace('Save scene script','Save conversation');p.write_text(s)
# Add coverage for selected-card actions, optional conversation history, and drag.
p=Path('v2/scripts/smoke-card-image-first.mjs');s=p.read_text()
s=s.replace("await page.screenshot({path:new URL(`pond-${width}.png`,output).pathname,fullPage:true});", "await art();\n   await page.screenshot({path:new URL(`pond-${width}.png`,output).pathname,fullPage:true});")
s=s.replace("await cards('greek-harbor');", "await card('greek-harbor').click();\n   await page.locator('.card-primary').click();await ready();",1)
s=s.replace("await cards('greek-courtyard');await art();", "await cards('greek-courtyard');await art();\n   await page.locator('#history-button').click();\n   assert.match(await page.locator('#messages').innerText(), /The water is still/);\n   assert.doesNotMatch(await page.locator('#messages').innerText(), /Turn \\d|first flash|ritual progress/);\n   await page.locator('[data-close=\"history-dialog\"]').click();\n   await ready();")
s=s.replace("assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);", """const beforeDrag=await state();
   await card('cloth').scrollIntoViewIfNeeded();
   await card('cloth').dragTo(card('lamp'));
   assert.equal((await state()).turn,beforeDrag.turn,'pairing by drag is selection only');
   assert.equal(await card('lamp').getAttribute('aria-pressed'),'true');
   await card('lamp').dragTo(page.locator('#stage'),{targetPosition:{x:width/2,y:110}});
   await ready();
   assert.equal((await state()).items.cloth.holder,'lamp','dragged pair resolves once');
   assert.equal((await state()).turn,beforeDrag.turn+1);
   assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);""")
p.write_text(s)
