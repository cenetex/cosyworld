# One RatiRadio broadcast

Every world receives the same station clock, independent of its saved game.
The server maps UTC milliseconds onto a looping, measured catalog of all
unique room, cue and title songs. Restarting a server does not restart music.
The no-store response names the catalog version, song and absolute start/end.
The local Node server serves the same endpoint and UTC schedule.

`npm run v2:card:music:build` measures original audio with ffprobe. The check
needs no ffprobe: it verifies source hashes, titles, membership, positive durations and
catalog identity. Adding or replacing music requires rebuilding the catalog.
A new catalog changes the schedule on deployment. Clients must refresh at
boundaries and after returning; old instances during a rolling deployment may
briefly serve the previous catalog. This is station sync, not sample-accurate
multi-speaker playback. No database timer, paid service or player data is used.

The existing music switch, volume and first user gesture still govern sound.
Shared saved rules, replay, song bytes and performance receipts are unchanged.

The browser player is `radio-player.mjs`, connected to the existing music
controls through `createRoomMusic.setRadio`. The portable-item rule calls it
from accepted world state.
There is no automatic booth activation or station picker. Hidden, muted,
settings-paused and battle-cued listeners stop and fetch a fresh clock on return.
`node v2/scripts/smoke-card-radio-player.mjs` checks real decoded audio signal
and station position at desktop and phone widths; it does not prove speaker output.

## Portable receiver activation

The booth supplies one portable receiver, initially off. Its normal item card
turns it on or off while carried; paired with its current place, a grounded
receiver can be switched without taking it. Other people's custody still needs
the existing ask/give rules. The accepted `radio` action stores a boolean on the
item; old saves install the new item off and malformed switch values fail save
validation. This is a shared-rules change requiring a new released engine.

The browser derives audibility from the active receiver, its actual holder's
place and the listener's presence. A switched-on receiver can be heard by
co-located travelers, including when set down. Leaving, absent custody or a
sleeping pack removes audibility; entering the booth alone does not start it.
There is no station selector, new widget, paid call or additional storage.
