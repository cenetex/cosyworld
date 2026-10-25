from pathlib import Path
p=Path('v2/card-game/app.mjs');s=p.read_text()
s=s.replace('  const at = scene.lines.findIndex(', '  const spokenLines = scene.lines.filter((entry) => entry.kind === "dialogue");\n  const at = spokenLines.findIndex(')
s=s.replace('at < scene.lines.length - 1 ? scene.lines[at + 1].seq', 'at < spokenLines.length - 1 ? spokenLines[at + 1].seq')
s=s.replace('lineSeq = scene.lines[at - 1].seq;', 'lineSeq = spokenLines[at - 1].seq;')
s=s.replace('  selectionRevision = world.revision;\n  render();\n}\nfunction commit(', '  selectionRevision = world.revision;\n  render();\n  $("hand").querySelector(`[data-card="${id}"]`)?.closest(".card-frame")?.scrollIntoView({block: "nearest", inline: "nearest"});\n}\nfunction commit(')
p.write_text(s)
p=Path('v2/card-game/README.md');s=p.read_text()
s=s.replace('## World packs and the Wine-Dark Sea','''## Image-first presentation

Card faces contain the illustration and a small name. Selecting a card or
pair reveals its immediate action. Additional authored decisions and social
actions sit under the selected card's more-actions button. Selection, cancellation,
drag pairing and keyboard navigation spend no turn; only a committed play does.

No card face or hover text exposes quest checklists, levels, hope fractions,
Inspiration, fuel arithmetic, ringing deadlines, or ritual phases. New cards join
the hand without an interrupting tutorial or discovery modal. Observable changes
belong in the scene and art; hidden conditions never become a progress indicator.
Accessible descriptions report the same observable facts, not extra puzzle clues.

Lamp and cloth manipulations need no generated commentary. Social exchanges,
travel and the existing authored bell echo retain their speech. The optional
Conversation panel and export contain spoken lines, not an objective journal.
Basic controls are available on request in Menu, without combination recipes.

This presentation change preserves the existing simulation and save fields;
it does not erase saved levels or replace the resident motivation system.
Forest owns crossing mechanics. No new gate format is introduced here.

Run `node v2/scripts/smoke-card-image-first.mjs` for real desktop, phone and
short-landscape checks. It exercises keyboard, scrolling, selection, drag,
ritual reload, visible state, travel and conversation without paid model calls.

## World packs and the Wine-Dark Sea''')
s=s.replace('Cards with authored decisions have a **Choices** button.', 'Selected cards with authored decisions have a **···** button.')
s=s.replace('three quiet turns. Its checklist leaves the card.', 'three quiet turns. This is internal simulation state.')
s=s.replace('meter unchanged.', 'saved inspiration unchanged.')
s=s.replace('Avatar cards show Inspiration during the quiet and seeking phases. The Menu\nshows each hope, its milestones, and the current quest when one is active.\nItem cards explain attachments. Personal facts also enter the story context.', 'These mechanics remain internal; cards and menus do not display Inspiration,\nhope milestones or task checklists. Personal relationships may inform speech.')
s=s.replace('The conversation shows generated text, with the prior spoken line and speaker portrait above the current line.', 'The conversation shows the current spoken line; earlier words are available in the optional Conversation panel.')
a='Every card the player meets for the first time is unveiled:'
if a in s:
 i=s.index(a);j=s.index('\n\n',i)
 s=s[:i]+'''Newly encountered cards join the hand without a modal or tutorial. Travel still
fades between locations and loads the next scene before revealing it. Reduced
motion skips the fade. The opening route stays the same: attic, pond, then station.
The `v2:card:unveil:smoke` command now runs the image-first presentation regression.'''+s[j:]
s=s.replace('and turn order. During a personal quest, an avatar card shows its target hand\nand progress. Between quests it shows Inspiration. Menu shows lasting hopes,\nmilestones, and the active quests of the discovered cast.', 'and turn order. Their quests, motives and saved progress remain internal;\nthe player encounters people and their observable actions, not task dashboards.')
s=s.replace('After a card play, the browser sends', 'When a play calls for speech, the browser sends')
s=s.replace('Playing a card commits the action and starts the next exchange.', 'Playing a card commits the action; social actions and travel can start an exchange, while ordinary object manipulation can remain silent.')
s=s.replace('Direct interactions, item plays, combat, travel and introductions retain their relevant speakers.', 'Direct interactions, combat, travel and introductions retain their relevant speakers.')
s=s.replace('Scene exports include entity memories and generated beats.', 'Conversation exports include only the speaker and text of spoken lines.')
p.write_text(s)
p=Path('v2/content/greek-drama/README.md');s=p.read_text().replace('The branches are content-driven choices in the ordinary action system.', 'The branches are content-driven choices in the ordinary action system.\nSelect a character or place card and use its more-actions button to see\nauthored decisions; the idle card remains illustration and name.');p.write_text(s)
p=Path('v2/docs/pond-crossings.md');s=p.read_text().replace('The first flash gives a\nripple hint; waiting between flashes is allowed but consumes normal fuel.', 'Partial signal phases have no progress text or bespoke reassurance cue.\nWaiting between actions is allowed but consumes normal fuel.').replace('Run the 24 ritual regressions', 'Run the ritual regressions');p.write_text(s)
# Fit both source cards and a drop area into short landscape instead of forcing
# a vertically scrolling page that moves the scene out of reach during a drag.
css='''
@media (max-height: 640px) and (min-width: 701px) {
  :root {
    --card-height: clamp(126px, 37dvh, 176px);
    --card-width: clamp(100px, 28dvh, 128px);
    --dock-height: calc(var(--card-height) + 82px);
  }
  body, body[data-world="forest"] { min-height: 0; height: 100dvh; overflow: hidden; }
  main, body .stage, body[data-world="forest"] .stage { min-height: 0; }
  .topbar { min-height: 44px; padding-block: 2px; }
  body .card .name { font-size: 14px; padding-bottom: 8px; }
  body .cast { top: 46px; }
  body .dialogue, body[data-world="forest"] .dialogue {
    bottom: calc(var(--dock-height) + 4px); padding: 4px 10px;
  }
  #dialogue-text { max-height: 40px; }
}
'''
p=Path('v2/card-game/awakening.css');p.write_text(p.read_text()+css)
