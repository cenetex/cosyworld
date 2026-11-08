# RatiRadio presentation

A pack avatar may declare `sealed: { at, reason }` beside nonempty activation
requirements. At that place, its existing locked card previews the reason.
The avatar stays inactive; rules, possession, conversations remain unchanged.
When its requirements hold, the normal card replaces the preview. A resident
who later roams elsewhere leaves no locked duplicate behind.

RatiRadio uses the existing one-shot music cue path for the first booth visit.
A cue's `at` field names its room; the app looks up the cue for the current
avatar without naming any pack. The cue catalog owns the track's identity.
A playback receipt belongs to one browser listener, world, avatar. It is
written only after playback starts. Leaving the booth does not restart the
performance; a reload does not automatically repeat it. These receipts never
affect quest completion, authoritative world state, journal replay.

All presentation uses the existing cards, locked back, descriptor, music
controls. The content pack owns room names, return text, avatar activation.
