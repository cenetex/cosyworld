# The Wine-Dark Sea

A Greek drama card-world pack reached from Black Pond. **Before the Burial**
opens at seven painted places around Thebes. Dione's next invitation opens
**The Open Door** around Athens. Travelers keep their identities,
belongings, memories and decisions across both local and shared games.
Marathon, Troy and the Far Shores are **rumours** (rules 94, the breadth
freeze): no way leads there in a world of this release, so Marathon's tale,
Dione's full Open Door account and **Earth Beside the Ships**, Ajax's
household and burial account near Troy, wait in old full-scope worlds only.

## Before the Burial

A new game exposes the Wine-Dark Harbor, Theban Courtyard, Market Well,
City Gate, Exposed Battlefield, Palace Forecourt and Hillside Sanctuary.
Seven residents support the opening: Myrto, Antigone, Ismene, Creon, the guard,
Dione and the chorus elder. Each place has distinct painted scenery.

Thebes has no story buttons. Its deeds are the ordinary verbs:

- **Give** Dione the water jar to return it. With her Sack of Wheat she
  bakes the Courtyard Bread (rules 102); the jar goes home to the well and
  the wheat to Piraeus.
- The guard holds the Burial Decree and guards the battlefield both ways
  (rules 100, revision 20) until he holds Creon's writ; the card beyond reads
  "The Gate Guard is guarding this card". He wants to eat the bread and
  trades the decree for it. Creon holds his writ and wants the decree back.
  Beaten, the guard is knocked through and bars the way again once he walks
  back. See the [Greek redesign](../../docs/card-table/greek-redesign.md#the-theban-gate-greek-revision-20). Meeting the elder at
  the well after it gives the household a witness.
- The funeral quest card appears in **Polynices’ Hollow** when the traveler,
  Antigone and the remaining supplies are there. **Anoint** gives her the oil,
  **Veil** gives her the cloth, and **Bury** gives her the shovel. Supplies may
  be carried or laid in the Hollow; the card first offers Take or Ask when
  needed. Used oil and cloth return home, while the next rite stays available
  with its remaining materials. The shovel stays in the Hollow after burial.
- Antigone's **home is the Hollow** (owner, 2026-11-11), not the gate. She
  starts at the gate and cannot get home while the gate is locked or the Hollow's
  way waits on the Shade's word; once both are open she walks home by the
  ordinary resident rules (no scripted move, no `homeWhen`). She does not fetch
  or carry the burial items: residents do not yet take, carry or lay toward a
  want.
- Antigone holds two **staged wants** (rules 133, unordered, at most three): the
  rites laid in the Hollow, and, once the guard holds Creon's writ and until
  the burial, being at the Hollow herself. The seeded pick chooses between the
  open ones; after the burial her wants are drawn.
- **Trade** Creon the decree for his writ, with the household token in hand
  and the elder's witness, to petition (revision 20: Creon holds the writ and
  wants the decree back). Given the writ, the guard stands aside.
- **Patroclus** (rules 133, #2620) is the first companion, a sealed card of the
  Charybdis. It opens when Polynices is buried, the Charybdis lies at Piraeus
  and the Travel Provisions are aboard (`appearsWhen` with `ship_at` and
  `item_at`, latched by the flag `greek-patroclus-met` that the meeting sets),
  so he does not vanish again when the provisions go or the ship sails. He is a
  rider of that arrival and steps ashore on the Piraeus quay, his home. The
  meeting (`greek-meet-patroclus`, at Piraeus Quays) sets his trust in the
  traveler to 3 (owner decisions, 2026-11-11) on the traveler's next play that
  is not a Wait, so Talk tells his bread want (`want.minTrust: 1`) and he will
  accompany at once. Art: the idle portrait, a holding-bread pose and a
  sleeping portrait are wired; the other poses and the cropped portrait stay in
  `docs/design/assets/patroclus/`.
- Antigone holds two **staged wants** (rules 133, unordered, at most three): the
  rites laid in the Hollow, and, once the guard holds Creon's writ and until
  the burial, being at the Hollow herself. The seeded pick chooses between the
  open ones; after the burial her wants are drawn.
- **Trade** Creon the decree for his writ, with the household token in hand
  and the elder's witness, to petition (revision 20: Creon holds the writ and
  wants the decree back). Given the writ, the guard stands aside.
- **Patroclus** (rules 133, #2620) is the first companion, a sealed card of the
  Charybdis. It opens when Polynices is buried, the Charybdis lies at Piraeus
  and the Travel Provisions are aboard (`appearsWhen` with `ship_at` and
  `item_at`, latched by the flag `greek-patroclus-met` that the meeting sets),
  so he does not vanish again when the provisions go or the ship sails. The
  meeting aboard sets his trust in the traveler to 3 (the `trust` effect on
  `greek-meet-patroclus`; owner decisions, 2026-11-11), so Talk tells his want
  (`want.minTrust: 1`) and he will accompany. His home is Piraeus Quays. Art:
  the idle portrait, a holding-bread pose and a sleeping portrait are wired; the
  talking, listening, walking, guard, attack and hit poses and the cropped
  portrait stay in `docs/design/assets/patroclus/` (no pose slot, or the combat
  art pipeline).
- Antigone holds two **staged wants** (rules 133, unordered, at most three): the
  rites laid in the Hollow, and, once the guard holds Creon's writ and until
  the burial, being at the Hollow herself. The seeded pick chooses between the
  open ones; after the burial her wants are drawn.
- **Trade** Creon the decree for his writ, with the household token in hand
  and the elder's witness, to petition (revision 20: Creon holds the writ and
  wants the decree back). Given the writ, the guard stands aside.
- **Patroclus** (rules 133, #2620) is the first companion. Once Polynices is
  buried he stands aboard the Charybdis. Meeting him there sets his trust in the
  traveler to 3 (the `trust` effect on `greek-meet-patroclus`; owner decision,
  2026-11-11), so Talk tells that he wants bread (`want.minTrust: 1`) and he will
  accompany from the meeting. His home is Piraeus Quays. Art: the idle portrait,
  a holding-bread pose and a sleeping portrait are wired; the talking, listening,
  walking, guard, attack and hit poses and the cropped portrait stay in
  `docs/design/assets/patroclus/` (no pose slot, or the combat art pipeline).
- Antigone holds two **staged wants** (rules 133, unordered, at most three): the
  rites laid in the Hollow, and, once the guard holds Creon's writ and until
  the burial, being at the Hollow herself. The seeded pick chooses between the
  open ones; after the burial her wants are drawn.
- **Trade** Creon the decree for his writ, with the household token in hand
  and the elder's witness, to petition (revision 20: Creon holds the writ and
  wants the decree back). Given the writ, the guard stands aside.
- **Patroclus** (rules 133) is the first companion. Once Polynices is buried
  he stands aboard the Charybdis; when the ship docks without the traveler he
  steps ashore on the Wine-Dark Harbor quay. Meeting him there, aboard or on the
  quay, sets his trust in the traveler to 1 (the `trust` effect on
  `greek-meet-patroclus` and `greek-meet-patroclus-quay`), so Talk tells that he
  wants bread (`want.minTrust: 1`). A gift of bread makes it 2, and then he
  travels with the traveler; his home is Piraeus Quays. His portrait is a
  plain placeholder (`patroclus.svg`); the finished set is in
  `docs/design/assets/patroclus/` and waits for the image build.
- The Theban-response branch is gone (the report-plan, permitted-burial and
  courtyard choices, the Guard's Tablet and the `greek-theban-response`
  outcomes): the burial is the three rites in the Hollow, and burying
  Polynices opens the Open Door.

### Locked boxes (rules 133)

Every gated way and conditional resident in the pack is a locked box that
tells its want: `sealed.reason` is the short phrase the context button shows
when the play is blocked ("Give Myrto Helen’s Account Tablet to follow the
Egyptian account.", "Not here until Polynices is buried."). Two are left
unsealed on purpose: the Gate Guard draws his own way, and Patroclus is not on
the table until the burial. The made things (the bread and the provisions)
and the Wine-Dark Harbor lane to Piraeus tell their wants from their own
data. No text goes on a card.

### The provisions loop (rules 95, 102)

Myrto will not sail her crew out of Thebes without bread, figs and wine. She
wants to eat the Travel Provisions at Piraeus. The provisions are made
(`locked`): they wait locked at the Wine-Dark Harbor, and Myrto makes them
when given, or when laid on her quay, the Courtyard Bread, the Dried Figs
and the Wine Skin. The figs come from the Hillside Sanctuary and the wine
skin from the guard's ration at the City Gate. Each ingredient goes home
when used (the bread home locked, to be baked again); nothing regrows at
dawn, so there is only ever one of each. Laid on deck, the provisions open
the voyage to Piraeus, which leaves them aboard; eaten, they go home locked.
The way home is free.

The funeral cloth and oil start in Thebes but come from Attica: the cloth's
`home` is the Eleusinian Sanctuary and the oil's is Colonus Grove. A Theban
rite sends them home at once, or back where they started while the Open
Door is shut. The same cloth and oil are meant for Ajax's grave when Troy
opens again. The Libation Wine (`greek-libation`) is a separate cup of wine
on the Cithaeron road, distinct from the provisions' wine skin; no rite needs
it yet.

Thebes runs Courtyard, Market Well, Palace Forecourt, Hillside Sanctuary in
a line, with the City Gate off the courtyard: the forecourt is reached
through the well (revision 19), not straight from the courtyard. Its save
upgrade (`upgradeGreekForecourtSave`) turns a known step between the
courtyard and the forecourt into the walk through the well. Objects keep
their actual holders. The quiet sanctuary and the homeward road remain
available throughout. See the [Greek redesign](../../docs/card-table/greek-redesign.md).

The City Gate opens onto the battlefield once the gate guard
(`greek-guard`) holds the Burial Decree (`greek-decree`, first at the palace)
or Creon's writ at the gate, and stays open after (rules 86). In pack data
these are two `greek-gate` → `greek-battlefield` routes, one per order, each
requiring a `holding` condition and an `item_near` condition at the gate;
they share one saved gate. The guard accepts the writ (he values it at 2)
and hands it back when asked, so it can still reach Dione. While the gate is
shut, the battlefield shows at the gate as a sealed card (rules 95): its
context button says the guard lifts the bar for an order from the palace,
the Burial Decree or Creon's writ, and Seek the way gives the quest to give
the guard the decree. His own line says the same. The first time they hold,
the world records the gate in `openedRoutes`. The gate's open paintings
require `gate_open` for that route, and `test/card-theban-gate.test.mjs`
checks it, so the painting and the passage cannot disagree. While the gate is
closed the only card toward the battlefield is the sealed one. The gate guards the city both ways (rules 94): the
battlefield's exits are the gate and the Cithaeron road (rules 100). The
Gate Guard bars the gate from both sides while he stands at his post: from
the battlefield it shows as the locked box, "The Gate Guard bars the way",
and only he may pass, so knocked through he always walks home. A traveler
who comes over Cithaeron reaches the battlefield on foot, but enters Thebes
only once the gate has opened or while the guard is away from his post. If the guard later gives the decree
away or leaves his post, the gate stays open. A petition needs the decree in hand and
returns it to the palace, so a petitioner carries it back to the guard
afterwards. The battlefield is a Theban place just outside the walls, so by
the map rule it links directly to the gate. Beyond it the Cithaeron road
leads over the mountain to Eleusis. It is open both ways. The road is in
the Open Door section, so it appears once the burial opens the Open Door.

Three short story cards follow the opening. The Bard carries its growing
poem. Finishing a quest brings him to the next room the player enters.
Talking to him supplies the earned verses through that visit, in order.
Permission earns a verse while the burial remains open. A later rite adds
another verse and opens a return to Dione. The [exact copy list](OPENING-POEM.md)
records all three card lines and every branch of the song.

### Open question: weight of the burial routes

The burial routes (defy, the witnessed exception, report) each preserve what
occurred as a different Theban account. They still need later weight, so that
the route a player committed to keeps mattering after Dione takes the account.
Otherwise they read as an inventory lock accepting its key.

## The Open Door

When Dione receives the account of burial, permission or warning, she opens
the road to Athens. That records a lasting opening
for the Athenian Agora, Colonus Grove and the Eleusinian Sanctuary, reached
through the City Gate; the Long Walls from Piraeus Quays open with the
herald's truce. One shared traveler can open the roads for everyone. Marathon Altar is a rumour in this release.

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
the rest. The full account needs all five stories, Marathon's among them, so
it waits in old full-scope worlds.

Myrine, an original household representative, agrees at Eleusis to walk
to Piraeus. One Accompany play takes her along the shore path. She receives her
household’s basket or joins the shared quay, following the chosen berth.
Her signed return list carries her own words to Dione. The traveler chooses
an earned basket or berth stanza, and Dione answers the reading. Read the [full scene and source guide](OPEN-DOOR.md) for the
route, choices, source endings and original alternatives.

## Earth Beside the Ships

A rumour in this release (rules 94). In an old full-scope world, after the
five local endings and a return to Dione, Myrto offers a lasting invitation
to the Trojan camp; the Northern Road walks there from the Wine-Dark Harbor.
This named account begins after Ajax's death. Carry his shield to Tecmessa
for Eurysaces, hear Teucer's plea and bring its paper to Odysseus. Choose a
public rite, a household rite or a witnessed appeal. Prepare the grave with
the actual tools and cloth.

The appeal closes after the witnessed support and burial. Teucer then
signs the account. A traveler who has heard his words can carry the paper
to Dione. Three story beats and a return card follow the journey. Four
earned couplets grow from eight possible verses. Read the [chapter and
source guide](AJAX.md) for the choices, objects and saved account. In a
world of this release the invitation needs Marathon's tale, so it is never
offered.

## Roads, the Charybdis and the rumours

Places inside a town link directly. Between towns there is exactly one road
or a sea lane: the Road to Delphi joins the Agora and Delphi, and the Oeta
Road joins Delphi and Trachis.

The Greek ship (`greek-ship`, its id unchanged) is **the Charybdis**, on the
Black Pond route. Its lanes are in `v2/worlds/greek-drama/card-bridge.json`:

- Black Pond and the Wine-Dark Harbor, both ways, with no cargo. The ship
  always comes home this way.
- Out from the harbor to Piraeus Quays and from Piraeus to the Hoppy Cat
  jetty only while the Travel Provisions (`greek-provisions`, made at the
  harbor) or a Hoppy Cat thing are aboard: one `any` condition. To Piraeus
  the provisions must lie on deck (`item_at`), and the lane's `reason`
  labels the locked Piraeus card; the Hoppy Cat jetty lane still counts
  them carried (`item_present`; Hoppy Cat is paused). The Willows mist
  beside the rail needs the same cargo aboard. No voyage uses anything up.
- Every way back toward Black Pond, jetty to Piraeus and Piraeus to the
  harbor, is free.
- The cargo rule binds only a voyage with riders. Called away empty, the
  ship comes back to a traveler waiting at any dock without cargo.

Piraeus is Thebes's sea exit. It lies outside every section, so the
provisions carry a traveler there before Dione's invitation; the Long Walls
inland wait for the herald's truce, so until then Piraeus is a quay with the
ship home. The Hoppy Cat jetty beyond it is reachable as early, with cargo.

The ship is the quick way to a port, never a trap (#2049). From every dock
the Charybdis sails to, a traveler reaches home on foot or by a free leg,
even with the City Gate shut and every gate key out of reach.
`test/card-ship-port-roads.test.mjs` checks that by search over every walk,
carry and hand-over and every free lane, wherever someone else has called
the empty ship. The land route is the real geography: the Long Walls to the
Agora, the Sacred Way to Eleusis, the Cithaeron road to the battlefield,
then the City Gate into Thebes, which opens only once the guard has held
the decree there. The Coast Road, Piraeus to the Wine-Dark Harbor, retired.
The Long Walls open from both ends only with the herald's truce, so a sea
arrival waits at Piraeus until then and Attica is entered through the City
Gate. After the exposure the gate may never open; then nobody reaches
Attica by land or sea, and nobody is stranded there.

Marathon, the Trojan landing, the Greek camp and its household and grave,
and the Northern Road leave the release. The Lemnian Cave, the Thracian
Shore, the Taurian Temple and the Sicilian Cave, which only the ship
reached, retire into Piraeus. Their boarding shores retire, and their
residents, things and story choices stay authored for old full-scope worlds,
where Marathon and Troy still stand by Eleusis and the Northern Road. The
Northern Road runs from the Trojan landing to the Wine-Dark Harbor, outside
the City Gate.

The revision 18 save upgrade (`upgradeGreekLandRouteSave`) moves anyone or
anything on the Coast Road to Piraeus and forgets the retired gates and
known steps. It brings visitors and things from Marathon back to Piraeus,
and from Troy back to the harbor; a ship at, or bound for, a port it no
longer sails to comes in to Piraeus with its riders. In a world of this
release the rumours' residents and things go home unmet, and their story
steps are forgotten, with whatever followed from them (Marathon's tale, the
full return and Ajax's account). Athens is three districts joined by two
gate roads; see [The Open Door](OPEN-DOOR.md).

A pack retires a place with `retired: true` and one exit, the place that took
it in. No exit or route leads to it. A save upgrade moves anyone and anything
there, and a ship berthed or bound there, to that place. Athens Harbor joined
Piraeus; the Juror's House, the Divine Heights, the Hoopoe's Thicket, the
Underworld Landing and the Far Shores retired.

## Sources and runtime

`card-world.json` is canonical author data: 69 places including the ship,
33 residents, 26 objects, 149 typed choices and 44 work records. Nine works
have developed scenes; 35 retain situated hooks for later releases.

`release` lists the content in this release. `sections` groups places behind
lasting story events. New saves begin with seven shore places, the ship and,
by sea, Piraeus Quays. Dione's invitation adds three Attic places and their
roads. Earlier full-scope worlds keep
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

Completing the signal summons the Charybdis. Its saved discovery keeps the
boarding shores open through lamp changes, reloads and later voyages. It
sails the Black Pond route described above; the Travel Provisions
(`greek-provisions`, made by Myrto) laid on deck open the lane to Piraeus. Boarding the ship is a dock's
one link to the sea. Giving Theseus the mothers' petition brings the
herald's truce (`greek-olive-branch`, the Open Door's Agora outcome) into the
Agora. While it is in the Agora, the Long Walls open from both ends.
Its card uses `assets/greek-drama/olive-branch.webp`, the wool-bound branch
painting documented in [the Argos art handoff](../../card-game/assets/greek-drama/argos-alternates-README.md).
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
