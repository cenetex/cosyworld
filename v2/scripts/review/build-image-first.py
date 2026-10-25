from pathlib import Path
import re

def edit(path, fn):
 p=Path(path); old=p.read_text(); new=fn(old); assert new!=old, f'No change: {path}'; p.write_text(new)
def between(s,a,b,new):
 assert a in s and b in s, (a,b)
 i=s.index(a); j=s.index(b,i); return s[:i]+new+s[j:]

def app(s):
 s=between(s,'import {\n  enableMotives,','import { createNarrator', 'import { enableMotives } from "./motives.mjs";\n')
 s=between(s,'import {\n  lifeOf,','import { createRoomMusic','')
 s=s.replace('import { conditionText } from "./situations.mjs";\n','')
 for name in ['shining','reflectionOpen','handStatus','handText','tradeOffers','standoffFor','opponentOf','strikePower','sceneScript']:
  s=s.replace(f'  {name},\n','')
 s=s.replace('  cardChoices,\n','  cardChoices,\n  cardObservation,\n')
 s=between(s,'import { LESSONS,','const $ =', 'import { knownActors } from "./quests.mjs";\n')
 s=between(s,'// Cards the player has met.','function save() {','')
 s=between(s,'function status(id) {','function choose(id) {','')
 s=s.replace('  fresh.delete(id);\n','')
 s=s.replace('$("play-readout").textContent = resolved.hint;','$("play-readout").textContent = "That cannot be used here.";')
 s=s.replace('  if (action.actor === "vale" && LESSONS.includes(action.kind))\n    learn(action.kind);\n','')
 s=s.replace('  storyStatus = "pending";\n  pendingReplay = replay;', '''  // Manipulating an object needs no automatic speech or tutorial recap.
  const speak = ["talk", "ask", "give", "trade", "accompany", "threaten", "attack", "choose", "move"].includes(action.kind);
  narrator.invalidate();
  exchange.cancel();
  storyStatus = speak ? "pending" : "ready";
  pendingReplay = replay;''')
 s=s.replace('  exchange.begin();\n  selected = [];','  if (speak) exchange.begin();\n  selected = [];')
 s=s.replace('travel(world.actors.vale.place, render, unveilNew);','travel(world.actors.vale.place, render, render);')
 s=s.replace('    unveilNew();\n','')
 s=s.replace('  narrator.changed(action);','  if (speak) narrator.changed(action);')
 s=between(s,'function unveilNew() {','const figures =', '')
 s=between(s,'function card(id) {','  el.addEventListener("click", () => choose(id));',r'''function card(id) {
  const type = cardType(id), def = places[id] || people[id] || things[id];
  const raised = selected.includes(id);
  const chosen = raised ? cardPlay(world, selected) : null;
  const el = node("button", undefined, `card ${type}`);
  el.type = "button";
  el.dataset.card = id;
  el.disabled = saveBlocked || cardsCooling;
  el.setAttribute("aria-pressed", String(raised));
  el.setAttribute("aria-label", `${def.name}, ${type}`);
  el.setAttribute("aria-describedby", `card-detail-${id}`);
  const graphic = node("span", undefined, "art");
  const img = node("img");
  img.src = type === "item" ? packMedia(id, "art") || `./assets/${id}-card.png`
    : type === "avatar" ? portrait(id, null, world) : backdrop(id);
  img.alt = "";
  img.draggable = false;
  if (type === "avatar") frameFigure(img);
  graphic.append(img);
  if (type === "location") {
    el.dataset.locationVariant = locationVariant(world, id);
    const src = locationOverlay(world, id);
    if (src) {
      const overlay = node("img", undefined, "location-overlay");
      overlay.src = src; overlay.alt = ""; graphic.append(overlay);
    }
  }
  if (type === "item") {
    const item = world.items[id];
    // Observable physical states, never fuel arithmetic or puzzle progress.
    if (typeof item.lit === "boolean") el.dataset.lit = String(item.lit);
    if (typeof item.ringing === "number") el.dataset.ringing = String(item.ringing > 0 && !covered(world, id));
    const covering = Object.keys(world.items).find((other) => world.items[other].holder === id);
    if (covering) {
      el.dataset.covered = "true";
      const cloth = node("img", undefined, "object-cover");
      cloth.src = packMedia(covering, "art") || `./assets/${covering}-card.png`;
      cloth.alt = ""; graphic.append(cloth);
    }
  }
  const label = playLabel(chosen?.action);
  const observation = node("span", cardObservation(world, id), "sr-only");
  observation.id = `card-detail-${id}`;
  if (raised && label) observation.textContent += ` ${label}.`;
  el.append(graphic, node("span", def.name, "name"), observation);
''')
 s=s.replace('$("stage").dataset.play = cardPlay(world, dragging).hint;', '$("stage").dataset.play = playLabel(cardPlay(world, dragging).action) || "";')
 s=between(s,'  const plays = type === "avatar" ? avatarPlays(world, id) : [];','  return frame;\n}',r'''  if (raised) {
    const options = node("div", undefined, "card-options");
    const revision = world.revision;
    const primary = chosen?.action;
    if (primary) {
      const button = node("button", playLabel(primary), "card-primary");
      button.type = "button";
      button.disabled = saveBlocked || cardsCooling;
      button.setAttribute("aria-label", `${playLabel(primary)} · ${def.name}`);
      button.onclick = (event) => { event.stopPropagation(); commitAction(primary, revision); };
      options.append(button);
    }
    if (selected.length === 1) {
      const choices = cardChoices(world, id);
      const plays = type === "avatar" ? avatarPlays(world, id).filter((a) => a.kind !== primary?.kind) : [];
      if (choices.length || plays.length) {
        const button = node("button", "···", "card-more");
        button.type = "button";
        button.dataset.choicesFor = id;
        button.setAttribute("aria-label", `More actions · ${def.name}`);
        button.disabled = saveBlocked || cardsCooling;
        button.onclick = (event) => {
          event.stopPropagation(); showCardChoices(id, [...choices, ...plays], revision);
        };
        options.append(button);
      }
    }
    frame.append(options);
  }
''')
 s=s.replace('$("prior-response").hidden = !previous;','$("prior-response").hidden = true;')
 s=between(s,'  $("line-turn").textContent = scene.line','  $("story-status").hidden', '  $("line-turn").textContent = "";\n')
 s=s.replace('  const text = scene.line?.text || "";', '  const spoken = scene.line?.kind === "dialogue" && (reviewing || scene.line.turn === world.turn);\n  const text = spoken ? scene.line.text : "";')
 s=s.replace('  $("speech-hint").hidden = !text;','  $("speech-hint").hidden = true;')
 s=s.replace('    (entry) => entry.generated === true || witnessed(entry),','    (entry) => entry.kind === "dialogue" && witnessed(entry),')
 s=s.replace('    by.append(node("span", `Turn ${entry.turn}`));','')
 s=s.replace('  $("turn").textContent = `Turn ${world.turn}`;\n','')
 s=between(s,'  $("path-state").textContent =','  const handKey', '')
 s=s.replace('    [...fresh],\n','')
 s=between(s,'  for (const card of $("hand").querySelectorAll("[data-card]")) {','  $("play-readout").textContent', '')
 s=s.replace('    ? cardPlay(world, selected).hint','    ? playLabel(cardPlay(world, selected).action) || ""')
 s=s.replace('  renderTip();\n','')
 s=between(s,'// The first gift, trade, and shared journey','// A hand wider than the dock', '')
 s=between(s,'$("history-button").onclick = () => {','document\n  .querySelectorAll("[data-close]")',r'''$("history-button").onclick = () => {
  $("history-dialog").showModal();
  pauseSpeech();
  $("messages").scrollTop = $("messages").scrollHeight;
};
$("menu-button").onclick = () => {
  $("menu-dialog").showModal(); pauseSpeech();
};
''')
 s=s.replace('JSON.stringify(sceneScript(world), null, 2)', 'JSON.stringify(world.log.filter((e) => e.kind === "dialogue" && witnessed(e)).map(({speaker, text}) => ({speaker, text})), null, 2)')
 s=between(s,'  encountered = new Set(availableCards(world));','  reviewing = false;', '')
 s=s.replace('  narrator.changed();\n','')
 s=s.replace('    if (!saveBlocked) narrator.changed();\n','')
 s=s.replace('    !e.target.closest(".card") &&','    !e.target.closest(".card-frame") &&')
 s=s.replace('previousLine?.locationId === world.actors.vale.place','speak && previousLine?.locationId === world.actors.vale.place')
 return s
edit('v2/card-game/app.mjs',app)

edit('v2/card-game/cards.mjs',lambda s: s+ r'''

export function cardObservation(world, id) {
  const item = world.items[id];
  if (item) {
    const observations = [];
    if (typeof item.lit === "boolean") observations.push(item.lit ? "Lit" : "Unlit");
    if (typeof item.ringing === "number") observations.push(item.ringing > 0 && !covered(world, id) ? "Ringing" : "Silent");
    const cover = Object.keys(world.items).find((other) => world.items[other].holder === id);
    if (cover) observations.push(`Covered by ${nameOf(cover)}`);
    observations.push(things[item.holder] ? `On ${nameOf(item.holder)}` : people[rootHolder(world,id)] ? `Carried by ${nameOf(rootHolder(world,id))}` : "Resting here");
    return observations.join(". ") + ".";
  }
  if (world.actors[id]) return world.actors[id].awake === false ? "Asleep." : "Here.";
  return id === world.actors.vale.place ? "Here." : "A way onward.";
}
''')

def html(s):
 s=s.replace('<span id="turn">Turn 0</span>','')
 s=s.replace('>History</button','>Conversation</button')
 s=s.replace('          <p id="path-state"></p>\n','')
 s=between(s,'        <p id="hand-tip"','        <div class="hand-wrap">','')
 s=between(s,'    <dialog id="unveil-dialog"','    <dialog id="history-dialog">','')
 s=between(s,'      <details id="inner-life-panel">','    </dialog>', '')
 s=between(s,'      <p>\n        Play cards to guide Vale.','      <button id="speech-sound"', '''      <details class="controls-help">
        <summary>Controls</summary>
        <p>Select a card, or two together. Select a raised card again to act.
        You can also drag them into the scene. Escape or the scene lowers them.</p>
        <p>Arrow keys move between cards. Enter selects. Reading and selecting do not advance the world.</p>
      </details>
''')
 s=s.replace('      <div id="quest-guide" aria-label="Quest programs"></div>\n','')
 s=s.replace('History holds the scene script.','Conversation holds spoken lines.')
 return s
edit('v2/card-game/index.html',html)

def world(s):
 s=s.replace("A bell sounds among the Steam Clock's roots. Its dark reflection opens onto Black pond. The clock's bell can be rung again before the sound fades.","A bell sounds among the Steam Clock's roots. A dark reflection opens onto Black pond.")
 s=s.replace("The Steam Clock ticks among the trees. The roots show only moss: no path to Black pond is visible. Ring the clock's bell to reopen the crossing.","The Steam Clock ticks among the trees. Moss lies between its roots.")
 s=between(s,'        : shipSignalPhase(s) >= 2','      : s.opening && place === "attic"', '''        : "Dark water reflects the trees. A path leads along the shore."
''')
 s=between(s,'  if (shipSignalPhase(s) < 2 && shipSignalPhase(next) === 2)','  if (shipWasPresent !== greekShipPresent(next))','')
 s=s.replace('At the second uncovering, a Greek ship appears on Black pond.','A Greek ship appears on Black pond.')
 s=s.replace("The bells fall silent. The path to Black pond disappears between the roots; the Steam Clock's bell can reopen it.","The bells fall silent. The path to Black pond disappears between the roots.")
 return s
edit('v2/card-game/world.mjs',world)

def narrative(s):
 s=s.replace('  shipSignalPhase,\n','')
 s=s.replace('// witnessed events; quest counters remain on the cards and in the history.','// witnessed events. Hidden puzzle bookkeeping is not dialogue material.')
 s=between(s,'        if (id === "pond")\n          facts.push(\n            shipSignalPhase(world)', '        if (id === "clearing")', '')
 s=s.replace('Irritation: ${world.actors.badger.irritation}/3. ', '')
 s=s.replace('resolve ${conflict.resolve[id]}/4; ', '')
 return s
edit('v2/card-game/narrative.mjs',narrative)
edit('v2/orchestrator-rust/src/card_narrative.rs',lambda s:s.replace('Let the player choose the next card.','Let the player choose the next card. Do not coach solutions, recommend card combinations, count ritual steps, announce progress, or explain hidden gate conditions. Describe observable changes without explaining their algorithm. Do not turn desires into task checklists or mention inspiration, levels, points, fuel arithmetic, or remaining turns.'))

css=r'''
/* Image-first cards. The illustration is the face, not a banner above a report. */
:root {
  --card-width: clamp(174px, 15.5vw, 224px);
  --card-height: clamp(224px, 31dvh, 310px);
  --dock-height: calc(var(--card-height) + 82px);
}
body { background: #090d12; }
.topbar {
  position: absolute; inset: 0 0 auto; z-index: 10; min-height: 58px;
  border: 0; background: linear-gradient(#090d12bc, #090d1200);
}
.top-actions button { background: #0e121888; border-color: #c7af7955; border-radius: 22px; }
main { position: relative; }
.stage { min-height: 0; flex: 1; }
.play-dock {
  position: absolute; bottom: 0; left: 0; right: 0; z-index: 5;
  padding: 10px 22px max(4px, env(safe-area-inset-bottom));
  background: linear-gradient(#090d1200, #090d12bd 55%, #090d12f5);
  border: 0; pointer-events: none;
}
.hand-wrap { position: relative; pointer-events: auto; }
.hand {
  display: flex; gap: 14px; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;
  padding: 16px 5px 56px; scrollbar-width: thin; scrollbar-color: #ad97744d transparent;
  scroll-padding-inline: 5px; scroll-snap-type: x proximity;
}
.hand-wrap::before, .hand-wrap::after { display: none; }
.hand-scroll { position: absolute; top: 42%; translate: 0 -50%; z-index: 3;
  width: 44px; height: 44px; padding: 0; border-radius: 50%; border: 1px solid #bda57488;
  background: #11151de6; color: var(--gold); font-size: 24px; }
.hand-scroll.prev { left: -15px; } .hand-scroll.next { right: -15px; }
.hand-scroll:disabled { opacity: 0; pointer-events: none; }
.card-frame:first-child { margin-left: auto; } .card-frame:last-child { margin-right: auto; }
body .card-frame { position: relative; flex: 0 0 var(--card-width); width: var(--card-width);
  height: var(--card-height); scroll-snap-align: start; transition: transform .16s; }
body .card-frame[data-raised="true"] { transform: translateY(-10px); }
body .card { position: relative; width: 100%; height: 100%; display: block; padding: 0;
  overflow: hidden; border: 1px solid #a48d63b3; border-radius: 13px; text-align: center;
  background: #181b22; touch-action: pan-x; box-shadow: 0 6px 20px #0006; }
body .card:hover { transform: translateY(-2px); background: #181b22; }
body .card[aria-pressed="true"] { border-color: #f2dba6; background: #181b22;
  box-shadow: 0 0 0 1px #f2dba677, 0 0 22px #f2dba61a; }
body .card .art { position: absolute; inset: 0; display: block; overflow: hidden;
  border-radius: inherit; background: radial-gradient(ellipse at 50% 66%, #70543c6e, #141b2499); }
body .card .art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
body .card.item .art img { inset: 6% 3% 12%; width: 94%; height: 82%; object-fit: contain;
  filter: drop-shadow(0 8px 10px #0009); }
body .card.avatar .art img { --shown: calc(var(--figure-height, 1) * .78);
  inset: auto; top: calc(6% - 100% * var(--figure-top, 0) / var(--shown)); left: 50%;
  width: auto; height: calc(100% / var(--shown)); translate: calc(-100% * var(--head-x, .5)) 0;
  object-fit: fill; }
body .card .name { position: absolute; inset: auto 0 0; z-index: 1; margin: 0;
  padding: 36px 8px 14px; background: linear-gradient(transparent, #080b12eb 65%);
  font: 18px/1.2 Georgia, serif; color: #f2e3c4; white-space: normal; text-wrap: balance;
  text-shadow: 0 2px 5px #000; }
body .card[data-lit="true"] .art { background: radial-gradient(ellipse at 50% 60%, #e0a94a66, #151b24 76%); }
body .card[data-lit="false"] .art > img:first-child { filter: saturate(.35) brightness(.48); }
body .card[data-covered="true"] .art > img:first-child { opacity: .35; }
body .card.item .art .object-cover { inset: 10% 3% 12%; height: 80%; filter: brightness(.65); }
body .card[data-ringing="true"] .art > img:first-child { animation: sounding .5s ease-in-out infinite alternate; transform-origin: 50% 20%; }
@keyframes sounding { from { rotate: -2deg; } to { rotate: 2deg; } }
body .card-options { position: absolute; left: 4px; right: 4px; top: calc(100% + 8px); bottom: auto;
  display: flex; justify-content: center; gap: 6px; }
body .card-options button { flex: 1 1 auto; min-width: 0; min-height: 44px; padding: 7px 10px;
  background: #171920ee; border: 1px solid #baa37c; border-radius: 24px; color: #f2e3c4;
  font: 15px/1.2 Georgia, serif; white-space: normal; }
body .card-options .card-more { flex: 0 0 44px; font: 20px/1 Georgia, serif; }
body .card-options button:hover { background: #3c3325; }
body .card.drag-over { outline: 2px solid var(--gold); }
.stage.ready::after { content: attr(data-play); position: absolute; inset: 60px 15% var(--dock-height);
  border: 1px solid #dfc38d55; border-radius: 20px; display: grid; place-items: center;
  background: #13161a44; color: var(--gold); font: 24px Georgia,serif; pointer-events:none; z-index: 8; }
body .dialogue { bottom: calc(var(--dock-height) + 12px); max-width: 720px; width: calc(100% - 28px);
  background: #10151ddd; border-color: #b09a6a55; }
body .cast { --cast-bottom: calc(var(--dock-height) - 70px); bottom: var(--cast-bottom); top: 64px;
  height: auto; width: min(92%, 1100px); inset-inline: 0; margin-inline: auto; }
body .cast[data-count] { bottom: var(--cast-bottom); height: auto; }
body .card-choices { width: min(460px, calc(100vw - 28px)); }
body .card-choice-list button { min-height: 44px; }
.controls-help { margin-bottom: 20px; }
.controls-help summary { min-height:44px; display:flex; align-items:center; cursor:pointer; }
@media (max-width: 700px) {
  :root { --card-width: 154px; --card-height: clamp(196px, 28dvh, 246px); }
  .topbar { min-height: 50px; padding: 4px 10px; }
  .top-actions button { padding: 5px 10px; font-size: 12px; }
  .play-dock { padding-inline: 16px; } .hand { gap: 10px; }
  body .card .name { font-size: 16px; padding-bottom: 12px; }
  body .cast { top: 54px; width: 98%; }
  body .dialogue { bottom: calc(var(--dock-height) + 6px); padding: 8px 12px; }
}
@media (max-height: 640px) {
  :root { --card-height: 176px; --card-width: 128px; --dock-height: 244px; }
  body { overflow-y: auto; min-height: 570px; }
  main { min-height: 570px; } body .stage { min-height: 570px; }
}
'''
def style(s):
 s=between(s,'/* Every world action belongs to a card','dialog {','')
 s=between(s,'/* A card met for the first time','@media (prefers-reduced-motion: reduce)', '')
 s=between(s,'.hand-condition {','.card-choices {','')
 s=s[:s.index('.inspiration-meter {')]
 return s+css
edit('v2/card-game/style.css',style)
edit('v2/card-game/awakening.css',lambda s:re.sub(r'body\[data-world="forest"\] \.card(?:-frame)? \{[^}]*\}\n','',s))
edit('test/card-ship-ritual.test.mjs',lambda s:s.replace('At the second uncovering','A Greek ship appears').replace('the narration receives a first-flash hint without claiming the ship is present','the narration does not expose a partial ritual or claim a ship is present').replace('assert(facts.some((f) => f.includes("Completed lamp signals: 1 of two")));','assert(!facts.some((f) => /Completed lamp signals|cover and uncover|once more|first flash/i.test(f)));'))
edit('test/card-crossings.test.mjs',lambda s:s.replace('/no path to Black pond/','/Moss lies between its roots/'))
edit('test/card-combat.test.mjs',lambda s:s.replace('"resolve 4/4; guarding"','"guarding"'))
for name in ['smoke-card-greek-drama.mjs','check-card-awakening.mjs','smoke-card-pond-crossings.mjs']:
 edit('v2/scripts/'+name,lambda s:re.sub(r'        if \(await page.locator\("#unveil-dialog"\).evaluate\(\(d\) => d.open\)\)\n          await page.locator\("#unveil-take"\).click\(\);\n','',s).replace('if (await page.locator("#unveil-dialog").evaluate((d) => d.open)) {','if (await page.locator("#unveil-dialog[open]").count()) {').replace('        await opener.scrollIntoViewIfNeeded();','        await card(action.cards[0]).click();\n        await opener.scrollIntoViewIfNeeded();').replace('      await page.locator(\'[data-choices-for="clearing"]\').click();','      await page.locator(\'#hand [data-card="clearing"]\').click();\n      await page.locator(\'[data-choices-for="clearing"]\').click();'))
edit('v2/scripts/smoke-card-clearing-access.mjs',lambda s:s.replace('    await page.locator(\'[data-choices-for="clearing"]\').click();','    await page.locator(\'#hand [data-card="clearing"]\').click();\n    await page.locator(\'[data-choices-for="clearing"]\').click();'))
edit('v2/scripts/smoke-card-music.mjs',lambda s:s.replace('while (await page.$eval("#unveil-dialog", (d) => d.open)) {','while (await page.locator("#unveil-dialog[open]").count()) {').replace('() => document.querySelector("#unveil-dialog").open,','() => document.querySelector(\'#hand [data-card="pond"]\'),'))
for name in ['smoke-card-hand.mjs','smoke-card-unveil.mjs']:
 Path('v2/scripts/'+name).write_text('// Card discovery and hand manipulation now share the image-first regression.\nimport "./smoke-card-image-first.mjs";\n')
p=Path('v2/scripts/check-card-awakening.mjs');s=p.read_text();s=s.replace('''  assert.match(
    await page.locator('[data-card="bell"] .state').textContent(),
    /Ring again/,
  );''','''  assert.equal(await page.locator('[data-card="bell"] .state').count(), 0);
  assert.doesNotMatch(await page.locator('#hand').innerText(), /Ring again/);''');p.write_text(s)
p=Path('v2/scripts/smoke-card-dialogue-recovery.mjs');s=p.read_text();anchor='''    await page.waitForFunction(() =>
      document
        .querySelector("#story-status")''';s=s.replace(anchor,'''    // Loading a quiet scene is silent. Explicit conversation requests words.
    const person = page.locator('#hand [data-card="moth"]');
    await person.click(); await person.click();
'''+anchor);s=s.replace('const pond = page.locator(\'#hand [data-card="pond"]\');','const pond = person;');s=s.replace('/speaks on turn 2/','/speaks on turn 3/').replace('/speaks on turn 5/','/speaks on turn 6/');s=s.replace('''    assert.match(
      await page.$eval("#messages", (box) => box.textContent),
      new RegExp(`Turn ${failed.turn}`),
    );''','''    assert.equal(failed.log.some(e => e.turn === failed.turn && e.kind === "action"), true);
    assert.doesNotMatch(await page.locator("#messages").innerText(), /Turn \\d/);''');s=s.replace('''    assert.match(
      await page.$eval("#messages", (box) => box.textContent),
      new RegExp(`Turn ${before.turn + 2}`),
    );''','''    assert.equal((await state()).log.some(e => e.turn === before.turn + 2 && e.kind === "action"), true);''');p.write_text(s)
