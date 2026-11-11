# Forest charm consequence traces

Synthetic seed 17, captured on main
`b6b3f646a021b6afae0ccf90880ed5123c43aa21` from the shipping
`createLandingWorld(packDefinition("lonely-forest"), 17)`, then
`dispatchShared({ op: "create", seed: 17, save: encodeSave(initial) })`.
No places, inventory, turns, flags or meetings were edited. The JSON's SHA-256
fields pin engine-v131.js and the exact accompanying content bytes.

Both branches share eleven legal plays:

1. Talk to RATi twice: hide Vale's button at turn 1, record welcome at turn 2.
2. Walk to the garden, use ordinary Wait to clear the drain at turn 4,
   then walk to the trail and Talk to Skull (pawprints at turn 6).
3. Take the Wolfprint Charm, walk to Oak, Talk (hearth account at turn 9),
   then return through the garden to the cottage at turn 11.

At turn 12, ordinary Wait records `forest-keep-charm`, holder `vale`.
The alternative Give to RATi records `forest-leave-charm`, with actual holder
`forest-cottage`, not RATi. Both branches leave for the garden, return to the
cottage, then visit Oak through the garden: sixteen accepted plays each.
The earned garden–trail passage stays open. Oak's live shortcut requires the
nearby charm and is open only on the keep branch. First meetings with RATi,
Skull and Oak remain turns 1, 5 and 8.

The JS regression also covers retreat before choosing, cloned validation and
reload after each play, repeated views/Talk, a legal later offer to RATi
(which is declined without a new ending), an accepted later gift to Oak
(which changes custody without a new ending), and current source/compiled agreement.
The existing Rust world-life module commits both exact traces in C-hosted
QuickJS, rejects a repeated give at the cottage without a journal row,
reconnects Mara at her real Theatre, deletes only its temporary test database's
checkpoints and compares close/reopen journal replay with explicit upgrade or
content-repack output when needed. Mara sees the public consequence; this does
not claim she walked to the cottage or earned a personal upgrade.

Do not regenerate historical expected worlds to hide a failure. Investigate
the first divergent request. These tests cover one technical slice of #2520
and #2579, not either issue's completion. Scarf ownership, Mara travel, Raven,
Theban personal entry and human editorial playtesting remain separate work.
