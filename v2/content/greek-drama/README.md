# The Wine-Dark Sea

A Greek drama card-world pack reached from Black Pond. **Before the Burial**
opens at seven painted places around Thebes. Dione's next invitation opens
**The Open Door**, five places around Athens. Travelers keep their identities,
belongings, memories and decisions across both local and shared games.
The completed Athenian stories open **Earth Beside the Ships**, Ajax's
household and burial account near Troy.

## Before the Burial

A new game exposes the Wine-Dark Harbor, Theban Courtyard, Market Well,
City Gate, Exposed Battlefield, Palace Forecourt and Hillside Sanctuary.
Seven residents support the opening: Myrto, Antigone, Ismene, Creon, the guard,
Dione and the chorus elder. Each place has distinct painted scenery.

Thebes has no story buttons. Its deeds are the ordinary verbs:

- **Give** Dione the water jar to return it.
- Meeting the guard at the gate tells the decree. Meeting the elder at the
  well after it gives the household a witness.
- **Wait** on the battlefield with the shovel to dig the grave, then with the
  cloth and oil laid there to bury the brother. The **Burial Account** then
  lies on the battlefield.
- **Give** Creon the decree, with the household token in hand and the elder's
  witness, to petition. **Creon's Writ** then lies at the palace.
- **Give** the guard the shovel to report the plan. **The Guard's Tablet**
  then lies at the gate.
- **Give** Dione the account, the writ or the tablet. It stays on her table,
  and her road to Eleusis opens.

The Market Well lies within the courtyard and opens only onto it. Objects
keep their actual holders. The quiet sanctuary and the homeward road remain
available throughout. See the [Greek redesign](../../docs/card-table/greek-redesign.md).

The City Gate opens onto the battlefield only while the gate guard
(`greek-guard`) holds the Burial Decree (`greek-decree`, first at the palace)
at the gate. It is a live condition in pack data: a `greek-gate` →
`greek-battlefield` route that `requires` a `holding` condition and an
`item_near` condition at the gate. The gate's open paintings use exactly the
same two conditions, and `test/card-theban-gate.test.mjs` keeps them equal, so
the painting and the passage cannot disagree. While the gate is closed no
travel card leads out. The gate only blocks the way out: anyone already on the
battlefield can always walk back in. If the guard gives the decree away or
leaves his post, the gate closes. A petition needs the decree in hand and
returns it to the palace, so a petitioner carries it back to the guard
afterwards. The battlefield is a Theban place just outside the walls, so by
the map rule it links directly to the gate. Beyond it the Cithaeron road
leads over the mountain to Eleusis. From the battlefield it opens while a
Theban account (the Burial Account, Creon's Writ or the Guard's Tablet) is
at the battlefield or on Dione's table in the courtyard, and closes when that
account moves away. The way back from Eleusis is always open. The road is in
the Open Door, so it opens with Dione's report.

Three short story cards follow the opening. The Bard carries its growing
poem. Finishing a quest brings him to the next room the player enters.
Talking to him supplies the earned verses through that visit, in order.
Permission earns a verse while the burial remains open. A later rite adds
another verse and opens a return to Dione. The [exact copy list](OPENING-POEM.md)
records all three card lines and every branch of the song.

## The Open Door

When Dione receives the account of burial, permission or warning, she opens
the road to Athens. That records a lasting opening
for the Athenian Agora, Piraeus Quays, Colonus Grove, Eleusinian Sanctuary
and Marathon Altar. One shared traveler can open the roads for everyone.

The main journey follows the mothers in Euripides' _Suppliant Women_.
Carry their petition to Theseus, choose the civic response, hear its report,
bring cloths for the funeral, place the ashes and prepare a berth home.
The grove keeper tells Sophocles' _Oedipus at Colonus_ as an earlier tale.
The altar keeper tells Euripides' _Children of Heracles_ in its own later
generation. Gifts and present promises join the remembered accounts.

Six short story cards follow these scenes. Twenty couplets distinguish
present deeds, heard reports and chosen tellings. Homecoming adds sixteen
couplets for early reports, Myrine’s arrival and her written answer. A
traveler can bring each completed local story to Dione, then return for
the rest. The full account remains available when all five stories are ready.

Myrine, an original household representative, agrees at Eleusis to walk
to Piraeus. One Accompany play takes her along the shore path. She receives her
household’s basket or joins the shared quay, following the chosen berth.
Her signed return list carries her own words to Dione. The traveler chooses
an earned basket or berth stanza, and Dione answers the reading. Read the [full scene and source guide](OPEN-DOOR.md) for the
route, choices, source endings and original alternatives.

## Earth Beside the Ships

After the four local endings and a return to Dione, Myrto offers a lasting
ship invitation to the Trojan camp. This named account begins after Ajax's
death. Carry his shield to Tecmessa for Eurysaces, hear Teucer's plea and
bring its paper to Odysseus. Choose a public rite, a household rite or a
witnessed appeal. Prepare the grave with the actual tools and cloth.

The appeal closes after the witnessed support and burial. Teucer then
signs the account. A traveler who has heard his words can carry the paper
to Dione. Three story beats and a return card follow the journey. Four
earned couplets grow from eight possible verses. Read the [chapter and
source guide](AJAX.md) for the choices, objects and saved account.

The camp's landing, household and grave have direct local paths. Places inside
a town link directly. Between towns there is exactly one road or a sea lane:
the Road to Delphi joins the Agora and Delphi, the Oeta Road joins Delphi and
Trachis, the Royal Road joins Troy and Susa, the Black Sea Road joins Thrace and
Tauris, and the Colonists' Road joins Corinth and Sicily. Troy is reached by
ship at the Trojan landing. The Greek ship serves Piraeus, the Wine-Dark
Harbor, Black Pond and the invited Trojan landing. Athens is three districts
joined by two gate roads; see [The Open Door](OPEN-DOOR.md).

A pack retires a place with `retired: true` and one exit, the place that took
it in. No exit or route leads to it. A save upgrade moves anyone and anything
there, and a ship berthed or bound there, to that place. Athens Harbor joined
Piraeus; the Juror's House, the Divine Heights, the Hoopoe's Thicket and the
Underworld Landing retired.

## Sources and runtime

`card-world.json` is canonical author data: 67 places including the ship,
33 residents, 26 objects, 149 typed choices and 44 work records. Nine works
have developed scenes; 35 retain situated hooks for later releases.

`release` lists the content in this release. `sections` groups places behind
lasting story events. New saves begin with seven shore places and the ship.
Dione's invitation adds five shore places. Earlier full-scope worlds keep
their travel access and their chosen Helen and Atreid accounts.

Greek pack revision 3 added eight residents and nine objects. Revision 4
adds Myrine and her agreed journey. The upgrade preserves old custody,
memories, flags, choices, receipts and poem. Shared rules version 12 records
the new journey rule. Earlier versions retain their original interpreter
bytes so accepted history can replay.
Revision 7 adds the Ajax cast, four objects and three place memories.
Earlier travelers keep their positions, custody, stories and poem.

The Forest and Greek packs share the card table's schema, registry, rules,
item custody, quests and save system. Choices use the closed effects
`choose`, `set_flag` and `place_item`. Myrine’s authored `journey` names the
agreement and its road; Accompany moves her through the ordinary rules.
A stationary pack resident can declare
`journey: { after: <agreement choice id>, path: [<home>, ..., <destination>] }`.
The path contains two to eight distinct, adjacent places in the same pack.
The agreement targets that resident at home, and the resident has
`travels: false`. Each step uses the human traveler's ordinary open route
and the resident's saved position. An arrival choice targets the resident
at the destination and checks the required item custody.
A placement requires the acting traveler to hold that object at the named place. Ordered receipts validate
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

At quiet Black Pond, cover the fueled, lit Lamp with Black cloth, then uncover
it. The signal counts each resolved action. Its conditions require a lit,
fueled lamp at the pond and quiet at both the pond and clearing. Covering hides
the flame without putting it out, so it is never a douse. Residents who cover
or uncover the lamp break a partial signal and never complete one. Pack
revision 10 shortened the signal from two cycles to one; an older save keeps a
single saved cover and starts any longer partial signal again.

Completing the signal summons a shared ship. Its saved discovery keeps the
boarding shores open through lamp changes, reloads and later voyages.
The ship sails authored lanes on two seas. On the west sea: Black Pond only
to the Wine-Dark Harbor, and the Wine-Dark Harbor to Piraeus. Round the cape,
Piraeus to Marathon Bay. On the east sea (Greek revision 16), Marathon Bay to
the Trojan camp landing, the Lemnian Cave and the Sicilian Cave; the Lemnian
Cave on to the Thracian Shore and Proteus's tomb in Egypt; the Thracian Shore
on to the Taurian Temple. The Far Shores are one-place stops: their roads,
the Court at Susa and the Scythian Crag retire. Every lane out of the
Wine-Dark Harbor, Piraeus or Marathon opens only while the Travel Provisions
are aboard, and every way back is always open. Boarding the ship is a dock's
one link to the sea. The lane between the
Wine-Dark Harbor to Piraeus opens only while the Travel Provisions
(`greek-provisions`, first at the harbour) are aboard; the way home from
Piraeus is always open. Giving Theseus the mothers' petition brings the
herald's truce (`greek-olive-branch`, the Open Door's Agora outcome) into the
Agora. While it is in the Agora, the Long Walls open from the Agora to Piraeus.
Its card uses `assets/greek-drama/olive-branch.webp`, the wool-bound branch
painting documented in [the Argos art handoff](../../card-game/assets/greek-drama/argos-alternates-README.md).
Piraeus Quays lies outside the Open Door section, so that lane reaches it in
any save; its roads inland and its stories still wait for Dione's invitation.
Boarding keeps the ship at its harbour. The first course
card played aboard sets the voyage for everyone, and the ship spends one world
round at sea. On arrival the only Disembark card is that port. The ship stays
where the first passenger lands; others can step off there or stay for the
next course. An occupied ship completes its voyage before a lamp recall.

## Art and presentation

Thebes has seven generated paintings. The Open Door adds five paintings
and eight transparent resident portraits. Myrine has her own portrait. The pond ship uses a transparent
ship layer over the original pond. The boarding card shows that same ship,
mirror and night setting.

`assets/greek-drama/scenery-provenance.json` records the opening scenery.
`assets/greek-drama/open-door-art.json` records the new art prompts, source
hashes, dimensions and runtime hashes. Seven later places have daytime
paintings salvaged from closed art PRs: Cithaeron Slopes, the Argive Shore
Sanctuary, Pherae, Trachis, Proteus's Tomb, the Court at Susa and the Taurian
Temple. Trojan Shores paints the Lemnian Cave and the Thracian Shore, so their
salvaged paintings now show the Sicilian Cave and Thetis's Sanctuary.
`assets/greek-drama/salvaged-backdrops-provenance.json` keeps each original
record. The other later places keep their SVG scenery for now.
The Ajax chapter adds day and night camp paintings, Tecmessa, Teucer,
Odysseus and the shield. Its [art record](../../card-game/assets/greek-drama/AJAX-ART.md)
lists the retained sources and prompt records.

The Theban City Gate shows its closed day or night painting
(`city-gate-closed-day.webp`, `city-gate-closed-night.webp`) unless the Gate
Guard holds the Burial Decree at the gate. Then it shows the open gate. The
state backdrop uses the same `holding` and `item_near` conditions as the
battlefield road.

Trojan Shores adds matching day and night paintings for Aulis Anchorage,
the Trojan Walls, the Trojan Night Camp and the Homecoming Beach. Sixteen inventory objects gain their own transparent
paintings, including the separate witness accounts, petitions, cloths, vessels
and grave tools. The scenery uses lossless WebP; the item PNGs keep their
original alpha channels. The [art record](../../card-game/assets/greek-drama/trojan-shores-art-provenance.json)
lists the selected sources, hashes, retained prompts and known provenance gaps.
The paintings follow each place's existing access and story conditions.

The onboard deck now selects the open-sea day or night painting only while
the saved voyage is at sea. Docked, course and arrived states retain the
coastal deck, and the boarding card retains its outside view. These are
matched complete paintings from the ship art handoff.

The four existing Atreid places use the matched House of Atreus paintings
and their night counterparts. Their saved account requirements remain in
force. All four share a stage focus of 31% across and 50% down, keeping the
doorway visible on narrow phones. This prepares the art in the full-scope
world; the Argos release and the planned folding into one House remain part
of the small-worlds pilot. Crossroads and Corinth/Troezen still need their art.
`smoke-card-painted-travel.mjs` checks the actual ship phases and all eight
Argos paintings at desktop/phone widths, including the doorway and save reload.

Card faces show large art and small names. Actions describe immediate deeds.
Each story has one short line, which the cast uses in Talk. The Bard gives the growing poem.
Conversation history preserves spoken lines. Accessibility descriptions
follow the same visible facts as the scene.

## Checks

```sh
npm test
npm run check:local
node v2/scripts/smoke-card-open-door.mjs
node v2/scripts/smoke-card-ajax.mjs
node v2/scripts/smoke-card-theban-scenery.mjs
node v2/scripts/smoke-card-greek-drama.mjs
```

The Open Door tests cover every invitation, the ordinary-verb steps, object care,
shared authorship, earned verses, interrupted duties and the return to Dione.
Browser journeys play all five places at desktop and phone widths, inspect
cards and art, reload during the story and hear the earned Bard context.
Speech fixtures let these journeys run consistently.

Save checks use real earlier saves and frozen shared interpreters. They
preserve old state through both checkpoint loading and journal-only recovery.
The shared invitation is checked through the server with two human avatars.

See [attribution](ATTRIBUTION.md) for the wider repertoire and translations.
