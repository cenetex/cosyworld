# The Wine-Dark Sea

A Greek drama card-world pack reached from Black Pond. **Before the Burial**
opens at seven painted places around Thebes. Dione's next invitation opens
**The Open Door**, five places around Athens. Travelers keep their identities,
belongings, memories and decisions across both local and shared games.

## Before the Burial

A new game exposes the Wine-Dark Harbor, Theban Courtyard, Market Well,
City Gate, Exposed Battlefield, Palace Forecourt and Hillside Sanctuary.
Seven residents support the opening: Myrto, Antigone, Ismene, Creon, the guard,
Dione and the chorus elder. Each place has distinct painted scenery.

The player can return water, hear the decree, arrange a witness, carry a
shovel, supply cloth and oil, perform a burial, petition, accept permission,
refuse, report or give a later warning. Objects keep their actual holders.
Witnesses and recorded deeds shape each later offer. The quiet sanctuary and
the homeward road remain available throughout.

Three short story cards follow the opening. The Bard carries its growing
poem. Finishing a quest brings him to the next room the player enters.
Talking to him supplies the earned verses through that visit, in order.
Permission earns a verse while the burial remains open. A later rite adds
another verse and opens a return to Dione. The [exact copy list](OPENING-POEM.md)
records all three card lines and every branch of the song.

## The Open Door

After the public account of burial, permission, refusal or warning, Dione
can offer a place on the road to Athens. Accepting records a lasting opening
for the Athenian Agora, Piraeus Quays, Colonus Grove, Eleusinian Sanctuary
and Marathon Altar. One shared traveler can open the roads for everyone.

The main journey follows the mothers in Euripides' _Suppliant Women_.
Carry their petition to Theseus, choose the civic response, hear its report,
bring cloths for the funeral, place the ashes and prepare a berth home.
The grove keeper tells Sophocles' _Oedipus at Colonus_ as an earlier tale.
The altar keeper tells Euripides' _Children of Heracles_ in its own later
generation. Gifts and present promises join the remembered accounts.

Six short story cards follow these scenes. Twenty new couplets distinguish
present deeds, heard reports and chosen tellings. The final account returns
to Dione's table. Read the [full scene and source guide](OPEN-DOOR.md) for the
route, choices, source endings and original alternatives.

## Sources and runtime

`card-world.json` is canonical author data: 50 places including the ship,
29 residents, 22 objects, 113 typed choices and 44 work records. Eight works
have developed scenes; 36 retain situated hooks for later releases.

`release` lists the content in this release. `sections` groups places behind
lasting story events. New saves begin with seven shore places and the ship.
Dione's invitation adds five shore places. Earlier full-scope worlds keep
their travel access and their chosen Helen and Atreid accounts.

Greek pack revision 3 adds eight residents and nine objects to valid earlier
saves. The upgrade preserves old custody, memories, flags, choices, receipts
and poem. Shared rules version 10 records the change. Versions 2–9 retain
their original interpreter bytes so accepted history can replay.

The Forest and Greek packs share the card table's schema, registry, rules,
item custody, quests and save system. Choices use the closed effects
`choose`, `set_flag` and `place_item`. A placement requires the acting
traveler to hold that object at the named place. Ordered receipts validate
recorded branches and flags on load. Generated speech describes those facts.

`v2/worlds/greek-drama/card-bridge.json` joins the pack to the hub.
`v2/worlds/card-table.json` selects both packs. The generated
`v2/card-game/packs.json` supplies the browser and Rust's trusted personas.
The local game saves in the browser. Shared worlds save each accepted turn
through the server and rebuild from their journal.

```sh
npm run v2:card:pack:build
npm run v2:card:pack:check
```

## The crossing

At quiet Black Pond, cover and uncover the fueled, lit Lamp with Black cloth
twice. The signal counts each resolved action. Its conditions require a lit,
fueled lamp at the pond and quiet at both the pond and clearing.

Completing the signal summons a shared ship. Its saved discovery keeps the
boarding shores open through lamp changes, reloads and later voyages.
Boarding starts a crossing while the ship stays at the departure dock for
other passengers. The first passenger ashore moves it to the arrival dock.
Those still aboard can disembark there. A new boarding starts the return
crossing. An occupied ship completes its voyage before a lamp recall.

## Art and presentation

Thebes has seven generated paintings. The Open Door adds five paintings
and eight transparent resident portraits. The pond ship uses a transparent
ship layer over the original pond. The boarding card shows that same ship,
mirror and night setting.

`assets/greek-drama/scenery-provenance.json` records the opening scenery.
`assets/greek-drama/open-door-art.json` records the new art prompts, source
hashes, dimensions and runtime hashes. Later repertoire places retain their
original SVG scenery.

Card faces show large art and small names. Actions describe immediate deeds.
Quest cards each show one short line. The Bard gives the growing poem.
Conversation history preserves spoken lines. Accessibility descriptions
follow the same visible facts as the scene.

## Checks

```sh
npm test
npm run check:local
node v2/scripts/smoke-card-open-door.mjs
node v2/scripts/smoke-card-theban-scenery.mjs
node v2/scripts/smoke-card-greek-drama.mjs
```

The Open Door tests cover every invitation, alternate endings, object care,
shared authorship, earned verses, interrupted duties and the return to Dione.
Browser journeys play all five places at desktop and phone widths, inspect
cards and art, reload during the story and hear the earned Bard context.
Speech fixtures let these journeys run consistently.

Save checks use real earlier saves and frozen shared interpreters. They
preserve old state through both checkpoint loading and journal-only recovery.
The shared invitation is checked through the server with two human avatars.

See [attribution](ATTRIBUTION.md) for the wider repertoire and translations.
