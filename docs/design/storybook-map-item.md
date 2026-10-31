# The storybook map as a hub item

The **Map of the Wood and the Wine-Dark Sea** (`world-map`) waits at the Empty
station, outside the opening hand. It starts covered like every newly met card.
The station's timetable names years yet to happen; a map belongs beside it.

## Rules and compatibility

`forest.json` supplies the name, text, art, large view and initial station holder.
`card-table.json` registers the hub item; `entity-profiles.json` supplies its voice.
Take, give, trade, drop and wants use the ordinary item rules. The Willows retain
their separate `willows-map` and `assets/willows/map.png`.

`installPacks` adds genuinely absent hub items at their initial holders, including
in older local saves and shared worlds. Existing custody, history and memories
stay intact; a present malformed item remains invalid. This generic migration
also restores other absent hub items. Its rule change requires shared engine v60.
Content is supplied separately by the host; released interpreters stay pinned.

## Presentation and art

An uncovered selected item with a `view` offers client-only **Look**. The dialog
pauses speech and supports Enlarge/Fit, image tapping, Close, Escape and outside
tapping. Keyboard buttons work without submitting a play or advancing the world.
Card art resolves from pack art, then the hub item's `art`, then the forest card.

`assets/shared/items/world-map.webp` serves cards/stage at 1600 px;
`world-map-full.webp` serves the view at 4096 px. The generation chain, original
PNG hashes and encoding details live in `world-map-art-prompts.json` beside them.
