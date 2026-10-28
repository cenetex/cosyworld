# Book III source handoff

Prepared 2026-10-28. This draft builds six Book III chapters from the published capacity foundation. Ajax remains a separate stable PR. Source and focused checks proceed while the combined release uses the full test window.

## Source base and exact counts

Source: `codex/greek-epic-capacity`, commit `d0eed59f437f05467839f287d93c867f9da9d2d7`, package 1.2.5, Greek revision 7, rules 21. Chapter additions use Greek revision 8 in the same pack.

Rules 20 SHA256: `1e2c2195f737c60265be71cb772654ceda3248d02ab5728862dc5ac8d455aa24`. Interpreters 2–19 match qualified combined commit `1be7794b7b686ac1cad4a0a26486ec6307dd40f7`. Preserve all these bytes when making the next interpreter.

Counts were checked against the canonical JSON and an actual `ajaxJourney()` save:

| Scope | Actor records | Item records | Place definitions | Place memory records |
| --- | ---: | ---: | ---: | ---: |
| Greek revision 7 | 33 | 26 | 63 | 63 |
| Whole installed save | 66 | 60 | 93 | 93 |

Greek content also has 149 choices, 56 verses, 21 story quests, 18 topics, and 44 work entries. Two of the 63 Greek places are retained local road identities. Place definitions live in the catalog; matching entries in `world.memories` form the saved place count.

### Proposed fixed additions

These are design counts. They describe the named IDs below. A source change should compare its generated save with this ledger. Other Book I and II PRs will change the starting totals. Read their integrated save before chapter work and recalculate the cumulative columns; keep this proposal's additions at 16 actors, 27 items, and 12 places.

| Chapter | New actors | New items | New places | Greek actors/items/places after chapter | Whole save actors/items/places after chapter |
| --- | ---: | ---: | ---: | --- | --- |
| Iphigenia at Aulis | 3 | 4 | 2 | 36 / 30 / 65 | 69 / 64 / 95 |
| Philoctetes | 2 | 3 | 1 | 38 / 33 / 66 | 71 / 67 / 96 |
| Rhesus | 3 | 4 | 2 | 41 / 37 / 68 | 74 / 71 / 98 |
| Trojan Women | 3 | 7 | 2 | 44 / 44 / 70 | 77 / 78 / 100 |
| Hecuba | 3 | 5 | 2 | 47 / 49 / 72 | 80 / 83 / 102 |
| Persians | 2 | 4 | 3 | 49 / 53 / 75 | 82 / 87 / 105 |
| Total addition | 16 | 27 | 12 | +16 / +27 / +12 | +16 / +27 / +12 |

All new place definitions receive one saved place memory. People mentioned by witnesses stay attributed source voices. Their names add zero actor records. Offstage children receive explicit care, custody, and fate facts. They retain personhood in the prose. Their status is recorded through their carers and place facts.

The six source chapters add 41 verse definitions: Aulis 8, Philoctetes 6, Rhesus 6, Trojan Women 7, Hecuba 8, Persians 6. This gives 97 Greek verses. Hecuba has a separate burial and return pair for each chosen ending. Three physical beats and a return receipt give four story cards per chapter, for 45 total story quests. All 56 existing verse texts and receipts stay exact. Rules 21 supplies the chapter capacity. The four account-group limit stays fixed.

## Accounts, people, and travel

Follow `docs/worldpacks/greek-epic-loom/README.md`, `tragedians.md`, and `euripides.md`. The opening world is the Theban aftermath. Aulis, Lemnos, the night raid, Ajax, and Troy's fall each need a named recalled time. Susa uses a separate historical Salamis court account. Travel establishes the account before dialogue gives it present force.

Use one saved outcome per work. Keep three different records: selected truth in that account, what a named speaker believes, and the text a carrier actually heard. A later effect enters another chapter through a separate saved choice and a carried or published account.

Preserve Ajax's completed burial, shield custody, Teucer's signed paper, the learned words, and Dione's return receipt. Ajax's Odysseus stays at the Greek camp. A letter can carry his words to Lemnos; an authored journey must prove any physical visit.

Keep the embodied Egypt and Troy Helen accounts exclusive. Existing Helen and Menelaus IDs, locations, belongings, and Atreid author choices stay intact. In the Egypt account, claims about Helen at Troy belong to the named Trojan speakers and the phantom telling. The Aulis outcome has its own truth and belief records so later Clytemnestra and Tauris chapters can read them correctly.

The proposed actor names include the time frame in their profiles. Hecuba at the walls and Hecuba on the Thracian shore are two saved roles for one person at two named times. Both read the same selected Trojan account. The later role learns the earlier outcome through its saved handoff.

A frame actor remains a speaker of that recalled scene after its ending. Resolve the ending in story facts and retrospective speech. Current save validation allows a disabled actor only at its original or previous home with untouched talk and meeting state. Any feature that removes an actor after meeting them needs a separate rule change and replay tests. Qualify the remembered-scene treatment with a finished Aulis prototype before expanding the cast.

Local rooms, tents, graves, caves, and quays use direct paths. Fixed road scenes link towns. The existing Ajax landing serves Troy. Proposed extra ship docks are Aulis, Lemnos Landing, and the Thracian Shore. The shared ship then has eight docks: pond, Wine-Dark Harbor, Athens Harbor, Piraeus, Ajax Landing, Aulis, Lemnos Landing, Thracian Shore. Susa uses its inland court road.

Consent journeys currently validate 2–8 distinct places through authored exits or routes. Transport docks have a separate movement model. A follow-up passenger feature must prove consenting NPC boarding, one ship position, occupancy, waiting, disembarking, stale action rejection, and journal replay. Qualify it before an ending claims a passenger has sailed. A chosen destination, a departure, and an arrival each need their own receipt. The same care applies when the player gives a berth to a captive family.

## 1. Iphigenia at Aulis — The Wind's Price

Work `euripides-iphigenia-at-aulis`; existing `greek-aulis`.

**Primary ending.** The received text has Iphigenia leave for sacrifice. A messenger reports a hind in her place. Clytemnestra questions the report; Agamemnon confirms it and sends her home with the infant while the fleet prepares to leave. Record the report and her doubt separately. Label this the received rescue ending. Its textual history needs a source note. See the [full play](https://classics.mit.edu/Euripides/iphi_aul.pl.txt) and [Naomi Weiss's edition study](https://dash.harvard.edu/bitstreams/7312037d-7090-6bd4-e053-0100007fdf3b/download).

**Actual table cast:** `greek-aulis-iphigenia`, `greek-aulis-clytemnestra`, `greek-aulis-achilles`. **Attributed voices:** Agamemnon, Menelaus, the old servant, Calchas, the messenger, Talthybius, and the chorus. Their letters and testimony have named speakers and times.

**New places:** `greek-aulis-household`, `greek-aulis-altar`. **New items:** `greek-aulis-recall-letter`, `greek-aulis-wedding-veil`, `greek-aulis-offering-cloth`, `greek-aulis-departure-record`.

Three physical beats:

1. Carry the attempted recall letter from the anchorage and establish its interception through a published account.
2. Bring the marriage veil to the household. Tell mother and daughter the summons' purpose. Hear Achilles agree to witness their choice.
3. Carry the cloth to the altar route. Commit to the selected escape, sacrifice, or reported rescue. Write the departure record only after that deed.

**Chosen endings:** the army yields its price, an invented escape with living Iphigenia and altered war timing; the sacrifice remembered, a tragic account with the homecoming grievance; Artemis's rescue, the received ending with a later Taurian path. Living escape reaches Tauris only through a separately authored later journey. Each ending records Clytemnestra's knowledge and the fleet's belief. Return the actual departure record to a named listener before the final return stanza.

## 2. Philoctetes — The Offered Sail

Work `sophocles-philoctetes`; existing `greek-lemnos`.

**Primary ending.** Neoptolemus returns the bow and agrees to take Philoctetes home. Heracles appears and directs both men to Troy. He promises healing and victory, calls for mutual help, and requires piety at the city's fall. The men agree and bid Lemnos farewell. Healing belongs to the future journey. See the [full play](https://classics.mit.edu/Sophocles/philoct.pl.txt).

**Actual table cast:** `greek-lemnos-philoctetes`, `greek-lemnos-neoptolemus`. **Attributed voices:** Odysseus, the disguised merchant, Heracles, and the sailors' chorus. Odysseus's role refers to the existing Ajax actor through a dated message.

**New place:** `greek-lemnos-landing`. **New items:** `greek-lemnos-water`, `greek-lemnos-herb`, `greek-lemnos-bow`.

The implemented home route sails to Athens Harbor, then follows the existing
Athens, Delphi and Trachis places. It adds one Lemnian landing to the ship.
The home ending is recorded at Trachis after the actual journey. The emptied
care jug carries his arrival mark back to Myrto and Dione. The bow stays in
Philoctetes’s hand through all three chosen journeys.

The focused native proof journals the agreement, another carrier’s boarding,
two different stops chosen by a human, the passenger’s wait, the agreed
arrival, his published account and the physical return. It rejects stale
companion and boarding plays without adding a journal entry. Checkpoint
removal and database reopen restore the exact finished state. A second case
preserves a full-access Lemnian visitor through the rules-20 upgrade.

Three physical beats:

1. Bring water and the local healing plant to the cave. Give care before asking for military help.
2. Take the bow only through the owner's trust. Return it or record the deception with actual custody. Confession and the return restore the repair path.
3. State the army's purpose at the landing. Publish Philoctetes's choice of sail and his terms. Prove the passenger departure through the transport feature.

**Chosen endings:** truth and a freely accepted Troy journey, with the Heracles turn retained as an attributed source event; chosen homecoming, an invented change to the war; deception followed by repair, with the bow restored and his conditions binding. Continued shelter remains a valid unfinished state while he considers the sail. Keep `lemnos-consent`, `bow-returned`, and `wound-care` distinct. A carried Ajax burial account may open a new appeal; the player still makes that appeal.

## 3. Rhesus — The Watchword in the Dark

Work `euripides-rhesus`; existing `greek-trojan-camp`. Use the local guide's attribution note: the received play is under Euripides's name and its authorship is disputed.

**Primary ending.** The wounded charioteer blames Hector, who assigns the raid to Odysseus and orders care and burial. The Muse mourns Rhesus and promises a hidden divine life. Hector then calls for a dawn attack on the Greek ships. The ending carries grief and renewed fighting. See the [full play](https://classics.mit.edu/Euripides/rhesus.html). The linked Perseus attribution page was unavailable during this pass; retain that evidence limit in the next source review.

**Actual table cast:** `greek-rhesus-hector`, `greek-rhesus-rhesus`, `greek-rhesus-charioteer`. **Attributed voices:** Dolon, Odysseus, Diomedes, Athena, the Muse, and the sentries. Use a named sentry's report for each watchword fact.

**New places:** `greek-rhesus-allies`, `greek-rhesus-aid-tent`. **New items:** `greek-rhesus-lamp`, `greek-rhesus-watchword`, `greek-rhesus-bandage`, `greek-rhesus-testimony`.

Three physical beats:

1. Set the lamp at the arriving allies' ground and check the watch.
2. Carry the sentry's watchword and compare the challenged travellers' account with it.
3. Give an early warning with a real local evacuation, or bind the charioteer's wound and deliver his testimony to Hector after the raid.

**Chosen endings:** warning heeded, an invented survival with a saved later-fate obligation; the raid's witness, the source-shaped death with a recorded challenge to the false accusation. Record the Muse's promise as her source claim. A saved Rhesus gets a later fate before the fall-of-Troy frame opens. The household care receipt and Hector's attack order remain separate events.

## 4. Trojan Women — What the Ships Will Carry

Work `euripides-trojan-women`; existing `greek-troy`.

**Primary ending.** Andromache has sailed with Neoptolemus when Astyanax arrives on Hector's shield. Talthybius has washed the body and prepares the grave; Hecuba clothes the child for burial. Troy burns. Hecuba tries to return to its flames, then leaves for Odysseus's captivity with the other women. The Helen debate precedes this final sequence. See the [full play](https://classics.mit.edu/Euripides/troj_women.html).

**Actual table cast:** `greek-troy-hecuba`, `greek-troy-andromache`, `greek-troy-talthybius`. **Attributed voices:** Cassandra, the captive chorus, Poseidon, Athena, the chosen Helen and Menelaus account, and offstage Astyanax. Preserve Cassandra's assigned destination and the gods' announced return punishment in the source account.

**New places:** `greek-troy-womens-tent`, `greek-troy-shield-ground`. **New items:** `greek-troy-names`, `greek-troy-message-a`, `greek-troy-message-b`, `greek-troy-hector-shield`, `greek-troy-child-cloth`, `greek-troy-crew-pledge`, `greek-troy-berth-token`.

Andromache starts at the existing Trojan Camp Landing for her departure
agreement. Hecuba’s source path reaches the shield ground and waits there
for the actual dressing before it continues to the vessel. Each woman holds
her separate letter through the actual voyage and Myrto’s published arrival
record. The family path pays its token at the landing and reserves one actual
leg of the shared ship. Its giver waits ashore and can make a later crossing.
Astyanax’s rescue care follows Andromache’s actual place. The later household
keys are written after the mother and her cloth reach the harbor refuge.

Three physical beats:

1. Hear the women and write their names, destinations, and kin messages onto the roll.
2. Carry Hector's shield and the cloth to the burial ground, or prepare an explicit earlier rescue with shelter and a consenting crew. The child's status precedes every action. Hector's shield has its own identity beside Ajax's shield.
3. Give two actual message copies to separate departing carriers. Choose the departure witness and settle berth custody.

**Chosen endings:** the city's witness, with the source losses and captivity; a child carried out, an invented rescue before the order takes effect, with later Andromache facts changed; a captive family together, with a paid cargo cost and the player left ashore after giving up the berth. Complete the physical ship handoff before closing a sailing claim. A name or message carries into Hecuba, Andromache, or the selected Helen account.

## 5. Hecuba — The Gold Beneath the Tide

Work `euripides-hecuba`; existing `greek-thrace`.

**Primary ending.** After revenge, Agamemnon judges that Polymestor killed his guest for gold. Polymestor foretells Hecuba's changed form and death, plus Cassandra's and Agamemnon's deaths. Agamemnon orders his exile and tells Hecuba to bury her two children as the wind rises. Burial remains a deed to complete. These prophecies belong to their speaker and account. See the [full play](https://classics.mit.edu/Euripides/hecuba.pl.txt).

**Actual table cast:** `greek-thrace-hecuba`, `greek-thrace-polyxena`, `greek-thrace-polymestor`. **Attributed voices:** Polydorus's ghost, Odysseus, Talthybius, Agamemnon, the servant, and the captive chorus. The two Hecuba roles share one person's earlier history through explicit account facts.

**New places:** `greek-thrace-summons-tent`, `greek-thrace-burial-ground`. **New items:** `greek-thrace-polyxena-cloth`, `greek-thrace-polydorus-shroud`, `greek-thrace-entrusted-gold`, `greek-thrace-gold-record`, `greek-thrace-case-papers`.

The source chapter uses the actual shared ship at the Thracian Shore. Hecuba
holds her case papers through her agreed local journey and both burials. She
signs them at the burial ground. A carrier then takes the actual papers, hears
her selected account and brings it to Dione. The hearing ending requires the
actual gold in Hecuba’s hand; the burial ending leaves the wealth with the king.

Three physical beats:

1. Hear Polyxena's own farewell and prepare her cloth. Record the source sacrifice and her expressed wishes.
2. Recover Polydorus on the shore through the shroud deed. Trace the entrusted gold with a witness and a written custody record.
3. Carry Hecuba's summons into the revenge trap or assemble a public charge. Complete both children's burials with separate receipts before the burial ending.

**Chosen endings:** revenge, with Polymestor's blinding and his sons' deaths explicit; a charge before witnesses, an invented hearing whose army may protect its ally while granting burial; burial and departure, with both burial deeds done, evidence given to another carrier, and the king's wealth retained. The final account preserves the two dead children's names. Atreid outcomes continue to follow their chosen author account.

## 6. Persians — The Broken Oar

Work `aeschylus-persians`; existing `greek-susa`.

**Primary ending.** Darius's ghost warns against further attack and foretells the remaining army's defeat at Plataea. Atossa leaves to fetch clothing for Xerxes. The final scene is Xerxes and the chorus naming losses and lamenting as they go toward his house. The proposed consolation scene is an adaptation. See the [full play](https://classics.mit.edu/Aeschylus/persians.html).

**Actual table cast:** `greek-susa-atossa`, `greek-susa-xerxes`. **Attributed voices:** the messenger, Darius's ghost, the elders' chorus, and named bereaved households. These last household voices are authored additions. Label this historical Salamis account at entry and in its carried record.

**New places:** `greek-susa-tomb`, `greek-susa-threshold`, `greek-susa-road`. **New items:** `greek-susa-broken-oar`, `greek-susa-dead-names`, `greek-susa-offering-water`, `greek-susa-cloak`. The fixed road replaces the long town-to-court approach; the tomb and threshold use direct local paths.

The implemented road has fixed ends at the Trojan Walls and Susa. Xerxes
agrees at his threshold, holds the actual cloak through the audience record,
and reaches court through Accompany. The private welcome also requires
Atossa’s actual journey from the tomb. The messenger’s roll names Artembares,
Dadaces and Tenagon in the [primary text](https://classics.mit.edu/Aeschylus/persians.html).
Each ending returns that actual roll to Dione with four earned stanzas.

Three physical beats:

1. Carry the broken oar to the court. Match the survivor's account with the messenger's named dead.
2. Fill the offering vessel and carry it to Darius's tomb. Add household names before Atossa's prayer. Keep the ghost's warning attributed.
3. Bring the cloak to Xerxes at the threshold. Choose the audience and write its account.

**Chosen endings:** shared mourning, a source-shaped public lament adapted to include ordinary losses; private consolation, an invented household scene with a later full disclosure duty; public reckoning, an invented civic record with appointed household messengers. Carry the dead names to a later Greek feast through a fresh choice. Keep Salamis and Plataea separate from the mythical Trojan war.

## Build order and proof

1. Use published capacity commit `d0eed59f437f05467839f287d93c867f9da9d2d7` and rules 21. Keep engines 2–20 and all 56 frozen verse definitions. Hold full JS and native suites while the combined release uses the test window.
2. Prove remembered scene endings and consenting ship passengers in focused changes. Save, reopen, erase checkpoints, and replay both features. Preserve old actor states and old journal interpreters.
3. Build Aulis, then Philoctetes, then Rhesus. Resolve the selected war history before Trojan Women. Build Hecuba from that departure account. Keep Persians as its own named court frame.
4. Give every chapter three physical beats, chosen endings, and an actual return account. Use published Talk for learned evidence. A stale cloth, bow, paper, name copy, or berth action must fail after custody changes. A second carrier can hear and carry the final account.
5. Check current actor/item/place counts after each addition against the ledger. Save and restore representative previous rules, earlier author choices, Ajax household/public/appeal endings, all verse receipts, and occupied docks. Run journal-only rebuilds from each chapter's middle and ending.
6. Play every ending at desktop and phone width. Verify local cards sit to the right of the avatar, fixed roads sit between their ends, artwork follows actual ship position by day and night, portraits face their scene partners, spoken lines stay readable, and cards fit a short phone view.
7. Add generated catalogs, optimized images, provenance, media hashes, and public assets in each versioned PR. Run the relevant Node, native, content, browser, and release gates. Report merged, deployed, and live results as separate facts.
