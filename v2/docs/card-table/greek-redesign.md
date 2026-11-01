# Greek redesign

Status: approved by the owner (2026-11-01; see Owner decisions). It applies the owner decisions
recorded on #1581 and #1540 to the Wine-Dark Sea pack
(`v2/content/greek-drama/card-world.json`). The Thebes pilot follows this doc.

## Rules this doc applies

- **Scale.** A district has at most four places. Thebes, in four quarters,
  is the model. Roads are real places you can stand in, and there is one road per
  pair of towns. The current paintings roughly fit this scale.
- **Interiors.** A place *within* another, such as a shop, a house or the
  well in a courtyard, links only to its one parent. The map rule allows it:
  an interior is a leaf of its parent. Interiors do not count toward the four.
- **No story buttons.** Every authored `choice` becomes an item quest done
  with the normal verbs, something said through Talk, or nothing. Item quests
  use the existing `item_near` and `holding` conditions, as the Willows kit
  does. Talk choices use the generic `on: "talk"` trigger from #1611.
- **Outcomes are items.** Each storyline ends with an object (an account, a
  truce, signed testimony) carried back to Dione's table in the Theban
  Courtyard, the homecoming frame. An outcome item exists in the data from the
  start and appears through its own `requires`, as Teucer's plea does today.
  No engine change is needed for that.
- **Lore lives in things.** Books and inscriptions hold the plays' words.
  Prompts and authored lines do not; captions come from the rules.
- Also in force: one want per avatar and the quest card (#1700, #1704), the
  Hillside Sanctuary as the Greek rest place (#1713), the decree-gated Theban
  gate (#1728), fixed verbs, mystery over reachability, and expensive engine
  changes.

The 44 `greek-inquire-*` choices are dead inquiry buttons. #1581 step 1
deletes them, so they are not in the table below. That leaves 108 choices.

## Map

Each district lists its places; *interiors* are marked and do not count.
Today's place ids are in backticks.

### Thebes: four quarters

| Quarter | Place | Links | Who and what |
| --- | --- | --- | --- |
| Lower Town | Theban Courtyard `courtyard` | Harbor Road, palace, sanctuary, gate, well | Dione's table, the homecoming frame |
| (within Lower Town) | Market Well `well` | courtyard only | *Interior*; the elder and the water jar |
| The Cadmeia | Palace Forecourt `palace` | courtyard | Creon; the decree starts here |
| The Ismenion | Hillside Sanctuary `sanctuary` | courtyard | The Greek rest place (#1713) |
| The Gate | City Gate `gate` | courtyard, battlefield (gated, #1728) | The guard and the decree |

Thebes has two roads:

- **The Theban Harbor Road** `road-thebes` to the Wine-Dark Harbor.
- **The Exposed Battlefield** `battlefield`, outside the gate. It is a
  road-like place you stand in. It leads on over the **Cithaeron road**
  (today's Cithaeron Slopes `cithaeron`, as a road place) toward Attica.

The well's links to the palace and gate go; the palace links to the
courtyard. Aulis leaves the gate and becomes a ship stop. Cithaeron leaves the
sanctuary and becomes the road beyond the battlefield.

### The unlock chain

Each step opens through an item quest or a live condition in pack data, the
way the Theban gate does today. No step is a button.

| Step | Opens | Condition |
| --- | --- | --- |
| Thebes to the battlefield | The City Gate route | The guard holds the decree at the gate (#1728) |
| Battlefield to the Cithaeron road | The battlefield's far route | The dead have burial rights: the rite that yields the Burial Account is done, or the Herald's Truce has reached the battlefield |
| Cithaeron road to Eleusis | The road's far end | Open to anyone on the road |
| Eleusis to the city | The Sacred Way through the Dipylon | The Suppliants' petition is delivered: the Dipylon's warden holds it |
| City to the harbour | The Long Walls | The Open Door: the Herald's Truce is in the Agora |

This follows Euripides' *Suppliant Women*: the Argive dead go from the
Theban battlefield to their mothers at Eleusis, and the mothers' plea goes on
to Theseus in the city.

### Athens: three districts

A district has at most four places.

| District | Places | Interiors |
| --- | --- | --- |
| Countryside | Eleusinian Sanctuary `eleusis`, Colonus Grove `colonus`, Marathon Altar `marathon` (with **Marathon Bay**, the east harbour), Attic Farm `attic-farm` | Acharnae Market `acharnae`, within the farm |
| City | Agora `athens`, Assembly Hill `assembly`, Acropolis Treasury `acropolis`, The Thinkery `thinkery` | House of Demos `demos-house` within the Assembly; Women's Festival `festival` within the Acropolis |
| Harbour | Piraeus Quays `piraeus` (Athens Harbor `athens-harbor` merges into it) | The quay host's house (new, optional) |

The Juror's House `jury-house` goes (owner decision 5).

**Gates** are road places between districts:

- **The Sacred Way and the Dipylon** (renames `road-athens-eleusis`):
  Countryside to City. The Sacred Way no longer runs to Delphi.
- **The Long Walls** (renames `road-athens-piraeus`): City to Harbour.

Inside a district places link directly, so the other Athenian roads
(`road-athens-colonus`, `road-athens-marathon`, `road-piraeus-eleusis`,
`road-colonus-eleusis`, `road-colonus-marathon`, `road-athens-harbor`) retire.
The Divine Heights, the Hoopoe's Thicket and the Underworld Landing leave the
farm and Colonus (see the Far Shores).

### Two seas

- **The west sea:** the ship sails between Black Pond and the Wine-Dark
  Harbor, and between the Wine-Dark Harbor and Piraeus. The Travel Provisions
  aboard rule for the Piraeus lane stays.
- **The east sea:** Marathon Bay is the far harbour of Athens. From there the
  ship goes to Troy and the Far Shores. The Wine-Dark Harbor's lane to the
  Trojan landing moves to Marathon Bay.

### Argos

Argolid Crossroads `argolid-road`, Argive Palace `argos-palace` (merged with
Mycenaean Palace `mycenae-palace`), Agamemnon's Tomb `argos-tomb` and Argive
Shore Sanctuary `argos-sanctuary`. *Interior:* the Argive Farmhouse
`argive-farm`, within the crossroads. Its road is the Argolid Road from the
Wine-Dark Harbor. The three Atreid tellings share one palace; the telling is
fixed (owner decision 1).

### Troy

Today Troy has six places of its own: the Walls, the Greek Camp, the Trojan
Night Camp, the Trojan Camp Landing, Ajax's tent and Ajax's grave. Proposal:

- **Interior:** Ajax's Household Tent `ajax-household`, within the Greek Camp.
- **Merge:** the Trojan Night Camp `trojan-camp` (Rhesus, no scene) into the
  Walls, and the Homecoming Beach `troy-beach` (Helen) into the Landing.
- Troy is then the Landing (the ship stop), the Greek Camp, Ajax's Grave and
  the Walls: four places plus the tent.

### Trachis, Corinth, Troezen and Delphi

- **Trachis:** House at Trachis, Palace of Pherae and Thetis's Sanctuary. The
  Oeta Road joins it to Delphi.
- **Delphi:** one place. With the Sacred Way now Athenian, Delphi's other road
  is the Krisa Road from the Wine-Dark Harbor.
- **Corinth:** the Corinthian Courtyard alone, on the Isthmus Road from the
  Argolid Crossroads. **Troezen** is an interior of Corinth until it has a
  scene.

### The Far Shores

East-sea ship stops from Marathon Bay. Each is one place, or a small city if a
developed story needs it. Places without a story stay out of the release, as
all of them are today.

| Place | Proposal |
| --- | --- |
| Troy | Small city (above) |
| Lemnian Cave | Ship stop (Philoctetes) |
| Thracian Shore | Ship stop (Hecuba); the Black Sea Road retires |
| Proteus's Tomb in Egypt | Ship stop (Helen's Egyptian account) |
| Taurian Temple | Ship stop; the Scythian Crag merges into it |
| Sicilian Cave | Ship stop; the Colonists' Road retires |
| Aulis Anchorage | West-sea stop from the Wine-Dark Harbor |
| Court at Susa | Retire with the Royal Road |
| Divine Heights, Hoopoe's Thicket, Underworld Landing | Retire |

## The 108 choices

Totals: 39 item quests, 34 Talk, 35 deleted. "Present" means the item is at
the place, held or put down (`item_near`). "Give" uses the existing
`on: "give"` trigger. Talk rows use `on: "talk"`.

### Antigone and Thebes

| Choice | Button today | Becomes | How |
| --- | --- | --- | --- |
| `return-water-jar` | Return the water jar | Item | Give the jar to Dione. |
| `hear-decree` | Hear the burial order | Talk | Talk with the guard; the decree's inscription carries the order. |
| `gather-witness` | Ask for a public witness | Talk | Talk with the elder at the well, after the decree. |
| `prepare-burial-ground` | Prepare the burial ground | Item | Shovel present at the battlefield. |
| `perform-burial` | Perform the burial | Item | Cloth and oil present at the prepared grave. Yields the Burial Account. |
| `petition-burial` | Petition for burial | Item | Give Creon the decree with the household token in hand. Yields Creon's Writ. |
| `prepare-permitted-burial` | Prepare the permitted burial | Delete | Merged into the shovel rule above. |
| `perform-permitted-burial` | Complete the permitted burial | Item | Cloth and oil at the grave after the writ. Yields the Burial Account. |
| `decline-burial` | Decline the request | Delete | Refusing is not acting; nothing to commit. |
| `report-plan` | Report the intended burial | Item | Give the guard the shovel. Yields the Guard's Tablet. |

### Courtyard (Dione's table)

| Choice | Button today | Becomes | How |
| --- | --- | --- | --- |
| `courtyard-burial` | Tell the courtyard what happened | Item | Give Dione the Burial Account. |
| `courtyard-concession` | Share the public exception | Item | Give Dione Creon's Writ. |
| `courtyard-permitted-burial` | Tell Dione about the grave | Item | Give Dione the Burial Account after the writ. |
| `courtyard-refusal` | Return to the common table | Delete | Goes with the refusal. |
| `courtyard-exposure` | Explain the warning | Item | Give Dione the Guard's Tablet. |
| `open-door-invite-burial` | Take the road to Eleusis | Delete | The gift to Dione opens the road. |
| `open-door-invite-concession` | Take the road to Eleusis | Delete | The gift to Dione opens the road. |
| `open-door-invite-refusal` | Take the road to Eleusis | Delete | Goes with the refusal. |
| `open-door-invite-exposure` | Take the road to Eleusis | Delete | The gift to Dione opens the road. |

### Helen

| Choice | Button today | Becomes | How |
| --- | --- | --- | --- |
| `helen-egypt` | Follow Helen's Egyptian account | Delete | The city keeps one fixed telling (owner decision 1). |
| `helen-troy` | Follow Helen's Trojan account | Delete | As above. |
| `hear-helen-egypt` | Hear Helen's testimony | Talk | Talk with Helen at Proteus's tomb. |
| `helen-egypt-passage` | Provision a return passage | Item | Give Menelaus the provisions with the testimony in hand. Testimony goes to Dione. |
| `helen-egypt-shelter` | Support a stay under protection | Talk | Talk with Helen while holding the testimony. |
| `hear-helen-troy` | Hear Helen's testimony | Talk | Talk with Helen on the beach. |
| `helen-troy-passage` | Provision a return passage | Item | As the Egyptian passage. |
| `helen-troy-shelter` | Support a stay under protection | Talk | As the Egyptian shelter. |

### Atreids

| Choice | Button today | Becomes | How |
| --- | --- | --- | --- |
| `atreid-aeschylus` | Follow the tomb account · Aeschylus | Delete | One fixed telling (owner decision 1). |
| `atreid-sophocles` | Follow the palace account · Sophocles | Delete | As above. |
| `atreid-euripides` | Follow the farmhouse account · Euripides | Delete | As above. |
| `hear-electra-aeschylus` | Hear the household's testimony | Talk | Talk with Electra at the tomb. |
| `hear-electra-sophocles` | Hear the household's testimony | Talk | Talk with Electra at the palace. |
| `hear-electra-euripides` | Hear the household's testimony | Talk | Talk with Electra at the farmhouse. |
| `atreid-aeschylus-hearing` | Commit the testimony to a hearing | Item | Give Orestes the testimony. Yields the Hearing Summons. |
| `atreid-sophocles-hearing` | Commit the testimony to a hearing | Item | As above. |
| `atreid-euripides-hearing` | Commit the testimony to a hearing | Item | As above. |
| `atreid-aeschylus-refusal` | Refuse the revenge commitment | Delete | Pure attitude fork (owner decision 2 allows its return). |
| `atreid-sophocles-refusal` | Refuse the revenge commitment | Delete | As above. |
| `atreid-euripides-refusal` | Refuse the revenge commitment | Delete | As above. |

### The Open Door

| Choice | Button today | Becomes | How |
| --- | --- | --- | --- |
| `open-door-hear-mothers` | Hear the mothers’ request | Talk | Talk with Aethra. |
| `open-door-hear-adrastus` | Ask Adrastus about the war | Talk | Talk with Adrastus. |
| `open-door-register-plea` | Lay the mothers’ petition before Theseus | Item | Give Theseus the petition. |
| `open-door-request-truce` | Ask for a witnessed burial truce | Item | Merged: the petition yields the Herald's Truce. |
| `open-door-request-recovery` | Support the city’s recovery demand | Delete | The source battle is told, not chosen (owner decision 2 allows its return). |
| `open-door-hear-truce-report` | Receive the herald’s truce report | Talk | Talk with Theseus after the truce. |
| `open-door-hear-recovery-report` | Receive the messenger’s recovery report | Delete | Folded into the truce report. |
| `open-door-hear-quay` | Ask what the returning households need | Talk | Talk with the quay host. |
| `open-door-set-provisions` | Set the basket beside the resting place | Item | Basket present at the quay. |
| `open-door-lay-cloths` | Lay out the clean burial cloths | Item | Cloths present at Eleusis. |
| `open-door-lay-ashes` | Place the urn in the mothers’ care | Item | Give the urn to the Argive mother. |
| `open-door-hear-pyre` | Hear what happened beside the pyre | Talk | Talk with Aethra after the ashes. |
| `open-door-eleusis-pledge` | Pledge care for the dead of either side | Delete | Attitude fork; the ashes finish Eleusis. |
| `open-door-eleusis-care` | Keep the families’ needs in the account | Delete | As above. |
| `open-door-family-berth` | Reserve the berth for the listed households | Item | Give the quay host the return list. |
| `open-door-open-berth` | Keep a place for later guests too | Delete | Attitude fork. |
| `open-door-colonus-enter` | Hear the earlier tale of Oedipus | Talk | Talk with the grove keeper. |
| `open-door-colonus-water` | Set water and honey by the grove | Item | Cup and honey present at the grove. |
| `open-door-colonus-daughters` | Hear the daughters’ return and the son’s plea | Talk | Talk with the keeper. |
| `open-door-colonus-farewell` | Hear the kept promise at the end | Talk | Talk with the keeper. |
| `open-door-colonus-custom` | Record a welcome for the next exile | Item | Refuge tablet put down in the grove; it becomes the Colonus outcome. |
| `open-door-colonus-family` | Record the daughters’ work of care | Delete | Attitude fork. |
| `open-door-marathon-enter` | Hear the tale of Heracles’s children | Talk | Talk with the altar keeper. |
| `open-door-marathon-blanket` | Lay the blanket inside the shelter | Item | Blanket present in the shelter. |
| `open-door-marathon-daughter` | Hear the daughter’s own answer | Talk | Talk with the keeper. |
| `open-door-marathon-battle` | Hear the battle and the captive’s arrival | Talk | Talk with the keeper. |
| `open-door-marathon-captive` | Hear the claim against the captive | Talk | Talk with the keeper; yields the Marathon Record. |
| `open-door-marathon-alcmene` | Hear the source ending with Alcmene | Delete | Told in the captive Talk. |
| `open-door-marathon-hearing` | Ask for a hearing in another telling | Delete | Attitude fork (owner decision 2 allows its return). |
| `open-door-return-dione` | Tell Dione what welcome has cost | Item | Four Athenian outcomes on Dione's table. |

### Homecoming

| Choice | Button today | Becomes | How |
| --- | --- | --- | --- |
| `homecoming-report-agora-truce` | Tell Dione about the burial truce | Item | Give Dione the Herald's Truce. |
| `homecoming-report-agora-force` | Tell Dione about the recovery | Delete | Its fork is gone. |
| `homecoming-report-eleusis-pledge` | Tell Dione about the burial pledge | Item | Give Dione the Pyre Account (appears after the ashes). |
| `homecoming-report-eleusis-care` | Tell Dione about the families’ care | Delete | Its fork is gone. |
| `homecoming-report-piraeus-family` | Tell Dione about the reserved berth | Item | Give Dione Myrine's signed return list. |
| `homecoming-report-piraeus-open` | Tell Dione about the shared berth | Delete | Its fork is gone. |
| `homecoming-report-colonus-custom` | Tell Dione about the grove’s welcome | Item | Give Dione the refuge tablet. |
| `homecoming-report-colonus-family` | Tell Dione about the daughters’ care | Delete | Its fork is gone. |
| `homecoming-report-marathon-alcmene` | Tell Dione the Marathon source ending | Item | Give Dione the Marathon Record. |
| `homecoming-report-marathon-hearing` | Tell Dione the changed Marathon ending | Delete | Its fork is gone. |
| `homecoming-agree-journey` | Agree to walk with Myrine to the quay | Talk | Talk with Myrine; Accompany does the walk. |
| `homecoming-receive-family` | Witness Myrine receive her household’s care | Item | Arrive at the quay with Myrine and the basket. |
| `homecoming-receive-open` | Witness Myrine join the shared quay | Delete | Its fork is gone. |
| `homecoming-read-basket-family` | Read the basket verse with Myrine’s reply | Delete | Merged into the return-list gift above. |
| `homecoming-read-berth-family` | Read the berth verse with Myrine’s reply | Delete | As above. |
| `homecoming-read-basket-open` | Read the basket verse with Myrine’s reply | Delete | As above. |
| `homecoming-read-berth-open` | Read the berth verse with Myrine’s reply | Delete | As above. |

### Ajax

| Choice | Button today | Becomes | How |
| --- | --- | --- | --- |
| `ajax-invitation` | Accept the Trojan camp’s invitation | Talk | Talk with Myrto once Dione's table holds the Athenian outcomes. |
| `ajax-learn-shield-teucer` | Hear Teucer name the shield’s keeper | Talk | Talk with Teucer. |
| `ajax-learn-shield-odysseus` | Hear Odysseus name the shield’s keeper | Talk | Talk with Odysseus. |
| `ajax-learn-shield-tecmessa` | Hear Tecmessa speak for Eurysaces | Talk | Talk with Tecmessa. |
| `ajax-deliver-shield` | Set the shield with Tecmessa for Eurysaces | Item | Give Tecmessa the shield. |
| `ajax-hear-plea` | Hear Teucer’s burial plea | Talk | Talk with Teucer. |
| `ajax-deliver-plea` | Bring Teucer’s plea to Odysseus | Item | Give Odysseus the plea. |
| `ajax-choose-public` | Seek a public burial with Odysseus’s support | Talk | Talk with Odysseus holding the plea. |
| `ajax-choose-household` | Keep the rite with Ajax’s household | Talk | Talk with Tecmessa holding the plea. |
| `ajax-choose-appeal` | Keep a vigil while the burial appeal is heard | Talk | Talk with Teucer holding the plea. |
| `ajax-witness-appeal` | Hear the witnessed appeal with Teucer and Odysseus | Talk | Talk with Odysseus with Teucer present. |
| `ajax-prepare-grave` | Prepare Ajax’s grave with the camp tools | Item | Tools present at the grave. |
| `ajax-lay-cloth` | Lay the camp’s cloth at Ajax’s grave | Item | Cloth present at the grave. |
| `ajax-bury-public` | Complete Ajax’s public burial | Item | Tools and cloth at the grave, public route. |
| `ajax-bury-household` | Complete Ajax’s household burial | Item | As above, household route. |
| `ajax-bury-appeal` | Complete Ajax’s witnessed-appeal burial | Item | As above, after the witnessed appeal. |
| `ajax-record-public` | Ask Teucer to sign the burial account | Talk | Talk with Teucer; the plea becomes the signed account. |
| `ajax-record-household` | Ask Teucer to sign the burial account | Talk | As above. |
| `ajax-record-appeal` | Ask Teucer to sign the burial account | Talk | As above. |
| `ajax-return-public` | Read Teucer’s signed account to Dione | Item | Give Dione Teucer's signed account. |
| `ajax-return-household` | Read Teucer’s signed account to Dione | Delete | One gift; the ending travels on the account. |
| `ajax-return-appeal` | Read Teucer’s signed account to Dione | Delete | As above. |


## How each storyline resolves

| Storyline | Without buttons | Outcome item on Dione's table |
| --- | --- | --- |
| Antigone and Thebes | Hear the decree from the guard. Then either: bring shovel, cloth and oil to the battlefield (burial); or give Creon the decree with the household token and the elder's witness, then bury (permitted burial); or give the guard the shovel (report). | **Burial Account** (appears at the battlefield after the rite), **Creon's Writ** (at the palace after the petition) or **the Guard's Tablet** (at the gate after the report) |
| The Open Door | Dione's road opens when she receives a Theban outcome. Give Theseus the petition; lay cloths and the urn at Eleusis; set the basket and the return list at Piraeus; water and honey at Colonus; the blanket at Marathon. | **Herald's Truce**, **Pyre Account**, Myrine's signed **return list**, the **refuge tablet**, the **Marathon Record** |
| Homecoming | Each Athenian outcome given to Dione is that story's report. Myrine's walk stays an Accompany play. | The same five items; all five on the table finish the Open Door |
| Ajax | Myrto's Talk opens the camp. Give Tecmessa the shield and Odysseus the plea; tools and cloth at the grave; Teucer's Talk signs the plea. | **Teucer's signed account** |
| Helen | Hear Helen; give Menelaus provisions with the testimony in hand, or Talk with Helen for shelter. | **Helen's testimony** |
| Atreids | Hear Electra; give Orestes the testimony. | **Hearing Summons** |

The courtyard storyline is Dione's table itself. Every report is a Give to
Dione, and the item stays on her table as the record. The Bard's verses and
the quest card read the same receipts they read today.

## Thebes pilot

The first PR after this doc:

1. Thebes becomes four quarters. The well is within the courtyard and links
   only to it; the palace links to the courtyard.
2. `return-water-jar`, `petition-burial`, `report-plan` and the courtyard
   reports become `on: "give"` choices.
3. The grave and both rites become item quests at the battlefield: Wait
   there with the shovel, then with cloth and oil (`on: "wait"`).
4. `hear-decree` and `gather-witness` become Talk. Until `on: "talk"`
   (#1611) lands they commit `on: "meet"`: the guard's order reaches anyone at
   the gate, and the elder stands witness when met after it. Each is a one-word
   change to `on: "talk"` afterwards.
5. The refusal pair and the four invitation buttons are deleted; the
   courtyard gifts open the road to Eleusis.
6. New items: Burial Account, Creon's Writ, the Guard's Tablet.
7. The battlefield stays the gate's road-like place. A follow-up opens the
   Cithaeron road beyond it to Eleusis; Aulis and Cithaeron move then.

Choice ids, flags and receipts stay, so the Bard, the quest card and the Open
Door read them unchanged. Alpha saves may break.

## Open Door conversion

Greek revision 15 follows the table above for the Open Door and the
homecoming:

- Talk rows commit `on: "meet"` until `on: "talk"` (#1611) lands. In play,
  the next card played in the room tells the next part.
- "Present" deeds are `on: "wait"` with `item_near`; Thaleia's berth also
  needs the basket resting at the quay (`item_at`).
- Gifts are `on: "give"`: the petition to Theseus, the urn to the Argive
  mother, the return list to Thaleia, and each outcome to Dione.
- New outcome items: the Pyre Account (`greek-pyre-account`) and the Marathon
  Record (`greek-marathon-record`). The Herald's Truce keeps the olive
  branch's ID, `greek-olive-branch`. It appears in the Agora with the plea,
  and the Long Walls stay open only while it is there.
- `return-dione` commits when all five outcomes are on Dione's table.
- The save upgrade passes a deleted fork's receipt to the step that took it
  in (for example the open berth to the family berth, and a reading to the
  return-list gift), drops the rest, and counts the story's flags again.

## Owner decisions

Recorded on #1732 (2026-11-01):

1. **Fixed cities.** Helen and the Atreids each keep one fixed telling; their
   telling buttons are deleted, not drawn per run.
2. **Endings may differ from the plays.** A deleted fork may come back as an
   item quest where it earns one; the table is the starting point.
3. **Unlocked roads close again if the item moves.** Every step of the unlock
   chain is a live condition, like the Theban gate, not a lasting flag.
4. **The Far Shores are one-place ship stops** on the east sea.
5. **The Athens sort stands as written**, and the Juror's House goes.

## East sea

Greek revision 16 opens the east sea. Marathon Altar is also Marathon Bay,
the far harbour of Athens. The ship rounds the cape from Piraeus, and from
Marathon it sails to the Trojan camp landing, Lemnos and Sicily; Lemnos leads
on to Thrace and Egypt, and Thrace to Tauris. The Wine-Dark Harbor's lane to
the landing goes. A dock counts boarding the ship as one link, however many
lanes the ship sails (owner, 2026-11-01).
