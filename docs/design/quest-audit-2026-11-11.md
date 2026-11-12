# Quest and gate audit, 2026-11-11

Status: audit findings for the owner and for agents fixing gates. Read-only
work; it changed no pack data. Companion to
[companions and quests](companions-and-quests.md).

**Since this audit:** PR [#2698](https://github.com/cenetex/cosyworld/pull/2698)
removed the Athens and Long Walls gate. That covers G1 for Athens and the Long
Walls, and G2 and G3. The rest of the Open Door section is unchanged, so the
other rows still stand as written.

**Fixed after that, in the Greek pack data:** G1, G5, G15 and G16 (nothing
opens the Open Door; Attica, its residents and its things are there from the
start, and the burial no longer sets `greek-open-door-open`), G18 (Dione's last
card no longer needs Marathon) and G11 (only the Travel Provisions on deck open
harbor to Piraeus). G6 stays as written: the owner wants the Talk with the
shade before the Hollow. The Libation Wine (G23) is removed; the Household
Token and the Shelter Blanket stay, because residents value the token and the
blanket is still read by Marathon's chain. Patroclus, the Ajax section and the
Truce and Sacred Way latches are unchanged.

**Then:** the RATi Radio entrance, Dispatch Window and Listening Room (R1 to
R3) now follow their items, the Willows mist crossing needs only night and mist
(W1), and the canoe outlives the Swede (W4, question 10). The Booth and Raven
(R4, R5), the scatter pool (R7, question 8) and the items (R8, W6) are
unchanged; the scatter pool is set in `pack-items.mjs`, so it needs a rules
change.

**Since then:** PR [#2706](https://github.com/cenetex/cosyworld/pull/2706)
rebuilt the Open Door as [interlocking puzzles](open-door-rework.md). Its flag
chain (G17), its report props and the Sacred Way gate (G4) are gone; the
truce and the petition are things from the start (G22); each Attica resident
(G15, G16) opens on its own present thing and has a want; the herald's truce
also opens the City Gate (G7). G6 and G14 stay as the owner kept them. The
Ajax invitation no longer reads the deleted chain's flags.

Audited `origin/main` at `fb5d5afbe` (package 1.2.127, rules 133; pack
revisions: greek-drama 24, lonely-forest 3, ratiradio 3, willows 2,
hoppycat-archive 4, badger-forest 1).

How it was done:

- A dependency graph was built from `v2/card-game/packs.json` (checked identical to every authored `card-world.json` and `card-bridge.json`), `forest.json` and `world-life.json`: 353 gates, 16 starter wants, 86 items and 160 flags. For each gate it recorded the direct conditions and the transitive prerequisites: every fact whose removal makes the gate impossible to open from a new single-player world.
- The important findings were run on the real rules (`v2/card-game/world.mjs`) in nine scripts, r1 to r9. "Reproduced" means a script played or queried a real world. "Graph only" means the graph shows it and no script ran it. "Read only" means it was read in data or docs. The graph and scripts are not in the repo.
- A "new world" is the opening scope: 25 Greek places, 19 residents, 25 items, 30 choices. The other 48 Greek choices and 32 places (Troy, Argos, Marathon, Ajax, Helen, the Atreids) are not in new worlds. That is the breadth freeze and is not reported as a fault.

Limits: single-player only. Fights were not run; "the guard can be fought past" was taken as given. Hoppy Cat is listed, not judged. Burial-state worlds were played with `test/helpers/greek-funeral.mjs`; other scripts set Vale down at a place and then used real plays or queries.

## 1. Summary: the worst findings

1. **All of Attica is chained behind one linear run through Thebes.** Athens, Colonus, Eleusis, the Sacred Way, the Long Walls and the Cithaeron road, with 6 residents and 9 items, appear only when `greek-open-door-open` is set, and only the Bury rite sets it. The chain to see any of it: water jar, bread, decree, writ, gate, a Talk with the shade between midnight and dawn, oil, cloth, shovel, three rites. The locked box on the Piraeus quay asks the player to bring the Funeral Cloth to Polynices' Hollow. Harder. Reproduced (r1, r8).
2. **The sea route does not reach Athens even after the burial.** The Long Walls out of Piraeus also need the plea registered with Theseus and the Herald's Truce in the Agora. Both are in Athens, so the quay road can only be opened by someone who already walked to Athens by land. Harder. Reproduced (r1).
3. **Any Hoppy Cat thing replaces the Travel Provisions.** With the Red-Thread Spool in a pocket, Vale sailed harbor to Piraeus by ordinary plays with no provisions ever made. The provisions must be laid on deck; the spool only needs to be carried. The spool shows at the Empty station as soon as the keeper's oil leaves it. Easier. Reproduced (r2, r3, r9).
4. **Patroclus waits for the burial.** Docked at Piraeus with provisions on deck but Polynices unburied, he is not there and his locked card asks for the Funeral Cloth at the Hollow. Harder than the owner's quote. Reproduced (r3).
5. **The Hollow opens only after the midnight Talk with the shade.** With the gate open and all three burial things in hand, the Hollow stayed shut and Antigone stayed at the gate until the Talk at 00:00. Harder. Reproduced (r4).
6. **The Open Door cannot be finished in a new world.** `greek-open-door-return-dione` needs the Marathon flag and the Marathon Record. Impossible. Reproduced (r8).
7. **The Cithaeron road is hidden until the burial.** The route has no condition, but the place is listed in the Open Door section. Harder than [the Cithaeron page](greek-cithaeron-open-road.md). Reproduced (r4, r8).
8. **The Willows need Greek cargo.** Harder, and a cross-pack gate. Reproduced (r9).
9. **RatiRadio never closes again.** After everything was open, the key and beanie were dropped, the Thermos pocketed, the figurine put down, and Vale walked out with nothing; every door was still open. This follows the pack's contract, not the owner's later words. Reproduced (r6).
10. **Ten released items do nothing**: Libation Wine, Household Token, Burial Account, Shelter Blanket (its only use is at Marathon), Request Slip, Portable Radio, River Map, Stew Pot, Wooden Spoon, the Swede's Pipe. Graph only.

| Verdict | Rows |
| --- | --- |
| Harder than design | 7 |
| Easier than design | 1 |
| Latches open where the owner asked for live gates | 5 |
| Impossible in a new world | 1 |
| Items with no purpose | 3 rows (10 items) |
| Matches design | 19 |
| Design silent (recommendation given) | 14 |

Right and worth keeping: the Theban gate (live on the guard holding the Writ), bread and provisions as made things, provisions laid on deck, free lanes home, the shade's hours, Antigone's home at the Hollow, the three rites with oil and cloth going home and the shovel kept, the Oak's live trail, the Willows canoe following the kit, the hub's lamp gates.

## 2. Tables

File short names: **G** = `v2/content/greek-drama/card-world.json`, **GB** = `v2/worlds/greek-drama/card-bridge.json`, **R** = `v2/content/ratiradio/card-world.json`, **RB** = `v2/worlds/ratiradio/card-bridge.json`, **W** = `v2/content/willows/card-world.json`, **WB** = `v2/worlds/willows/card-bridge.json`, **F** = `v2/content/lonely-forest/card-world.json`, **FB** = `v2/worlds/lonely-forest/card-bridge.json`, **H** = `v2/content/hoppycat-archive/card-world.json`, **hub** = `v2/card-game/forest.json`. Line numbers are those of the audited commit.

Every fix is pack data unless it says rules. A data change still needs the compiled outputs rebuilt (`packs.json`, the shared engine content) and a pack revision.

### Greek drama

Intended chains beside the authored ones:

- **Gate.** Intended: bread to the guard, he gives the Decree; Decree to Creon for the Writ; the guard holding the Writ stops guarding. Authored: the same. Matches.
- **Burial.** Intended: Antigone is the clue; once the guard stands aside she walks to the Hollow; lay oil, cloth and shovel there; anoint, shroud, bury. Authored: the same, plus a mandatory midnight Talk with the shade, plus the burial opening Attica. Harder.
- **Sea to Athens.** Intended: make the provisions, lay them on deck, sail to Piraeus, go on to Athens, independent of gate and burial. Authored: sail with provisions or any Hoppy thing; at Piraeus nothing and nobody until the burial; the road inland also needs the plea and Truce from the Athens side. Easier at sea, much harder on the quay.
- **Patroclus.** Intended: appears aboard when docked at Piraeus with the provisions aboard, trust 3. Authored: the same, only after the burial. Harder.
- **Open Door.** Design silent on its steps. Authored: about 19 flag steps in order, ending in one that cannot be met.

| # | Thing gated | Authored condition (transitive) | Where | Intended (source) | Verdict | Evidence | Smallest fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | Athens, Colonus, Eleusis, Sacred Way, Long Walls, Cithaeron road (section `greek-open-door`) | flag `greek-open-door-open`, set only by `greek-bury-polynices`. Needs gate chain, shade Talk, oil, cloth, shovel, three rites | G:7071 (section), G:5767 (the rite) | "there should be NO requirement to bury polynices to unlock the road to athens" (owner, 2026-11-11). The burial setting this flag was an agent's recommendation in [Polynices' funeral](polynices-funeral.md), "Open questions", never an owner decision | Harder | Reproduced r1, r8 | Delete the section's `requires` (or the section) and the `set_flag greek-open-door-open` effect |
| G2 | Long Walls from the Piraeus quay | `greek-open-door-plea-registered` and the Truce near the Agora; latches. Needs G1 plus Aethra, Adrastus, the petition carried to Theseus in Athens | G:2822 | "getting travel provisions and going to piraeus is one way to reach athens" (owner) | Harder | Reproduced r1 | Remove `requires` from the Piraeus-side route. Question 1 |
| G3 | Long Walls from Athens | same two conditions; latches | G:2800 | Design silent. Companions and quests proposes making it live on the Truce; a proposal only | Design silent | Graph only | Decide with G2. If kept, mark `live` and drop the flag |
| G4 | Sacred Way from Eleusis | `greek-open-door-mothers-heard` and the petition near Eleusis or Athens; latches; from Athens it is a plain exit | G:2768 | Design silent. The map-scale decision allows district gates conditioned on a thing held | Design silent | Graph only | Mark `live`, drop the flag, keep only the petition's presence |
| G5 | Cithaeron road from the battlefield | route has no condition; the place is in the Open Door section | G:7081, route G:2764 | "Burial progress, writ custody, and the guard's tablet do not control this geography" | Harder | Reproduced r4, r8 | Remove `greek-cithaeron` from the section |
| G6 | Polynices' Hollow from the battlefield | any of `greek-polynices-heard`, anointed, veiled, buried; latches. In practice: Talk with the shade, present only 00:00 to 06:00 | G:2596 | "Antigone's want is the main clue; the midnight shade is a bonus clue"; "she just can't get there while the gate is locked" (owner) | Harder | Reproduced r4 | Remove the route's `requires` and `sealed`. Question 4 |
| G7 | Battlefield from the City Gate | live: the guard holds Creon's Writ | G:2584 | The owner's gate chain | Matches | Reproduced | None |
| G8 | The guard's bar, both ways | resident guard at his post | `v2/card-game/world-life.json` | Any blocker can be fought | Matches | Read only | None |
| G9 | Courtyard Bread | made by Dione from Water Jar and Wheat; the wheat then goes home to Piraeus, so there is one loaf until someone reaches Piraeus | G:2090, G:2110 | Items unique, reset home; "Two routes, one bread" in [items and crafting](items-and-crafting.md) | Matches | Reproduced r5 | None. After G11 is fixed, a player who feeds the guard first reaches Piraeus only by land |
| G10 | Travel Provisions | made by Myrto from bread, figs, wine skin; open the lane only when lying on deck | G:2191 | "they must be put down" (owner) | Matches | Reproduced r2 | None |
| G11 | Lane harbor to Piraeus | any of: provisions lying on deck; any Hoppy Cat item aboard, carried or lying | GB:267 (alternative at GB:280) | Provisions only (owner). The older ship design gave a Hoppy thing the Jetty lane, not this one | Easier | Reproduced r2, r3 | Delete the `pack_item_present` alternative |
| G12 | Lane Piraeus to Signal Jetty | any of: provisions aboard, carried counts (`item_present`, looser than G11); any Hoppy item | GB:295, GB:308 | [Ship voyages](ship-voyages-and-scattered-things.md); Hoppy Cat is paused | Design silent | Graph only | Leave while paused; later use `item_at` as G11 does |
| G13 | Lanes home | none | GB | "the return is free" (owner) | Matches | Graph only | None |
| G14 | Patroclus aboard the Charybdis | `requires` burial performed; appears when docked at Piraeus with provisions on deck; stays once met | G:2004 | Owner's quote has no burial. "Polynices must also be buried" in companions and quests, decision 7, stands outside the quotation marks | Harder | Reproduced r3 | Delete his `requires`. Question 3 |
| G15 | Thaleia, Clean Burial Cloths, Quay Basket, Shelter Blanket at Piraeus | flag `greek-open-door-open` | G:1774 and items | Follows G1: before the burial the quay holds nobody and nothing | Harder | Reproduced r3 | Remove the flag from their `requires` |
| G16 | Aethra, Adrastus, Theseus, the Grove Keeper; later the Argive Mother, Iphis, Myrine | `greek-open-door-open`; the later three also wait on story flags | G:1643 to G:1846 | "if residents need to be at specific places they should have quests associated" (decision 15) | Design silent | Graph only | Drop the open-door flag; leave the story flags until the presence design lands |
| G17 | The Open Door's 19 released steps | each a flag set by Meet, Wait or Give, read by the next | G:3700 to G:4334 | "Pack stories keep NO authored quest chains" (owner 2026-10-30); the burial was the stated exception | Design silent | Graph only | None proposed. Question 7 |
| G18 | "Tell Dione what welcome has cost" | needs `greek-open-door-marathon-done` and the Marathon Record at the courtyard | G:4334 | Finishable stories; Marathon is a rumour | Impossible | Reproduced r8 | Remove the two Marathon requirements |
| G19 | Polynices' Shade | on the battlefield from turn 36 to dawn while unburied; Talk only | G:1965 | Owner design | Matches | Reproduced r4 | None |
| G20 | Antigone | starts at the gate, home is the Hollow, wants the three things laid there | G avatars | Decision 22 | Matches, held back by G6 | Reproduced r4 | None beyond G6. She does not carry the things herself; that needs rules |
| G21 | Anoint, Shroud, Bury | oil goes home to Colonus, cloth to Eleusis, shovel stays | G:5678, 5725, 5767 | Owner's burial chain | Matches (apart from G1's flag) | Reproduced r8 | None |
| G22 | The Truce and the Petition as items | exist only after story flags | G:2212, G:2298 | Design silent | Design silent | Graph only | None now |
| G23 | Libation Wine, Household Token, Burial Account; Shelter Blanket | nothing reads the first three; the blanket's only reader is a Marathon step | G:2159, 2184, 2508, 2418 | "every item... has a purpose" (owner) | No purpose | Graph only | Reader or removal |
| G24 | Myrto's want: eat the provisions at Piraeus | resets the provisions home, locked | G avatars | Open question 11 in companions and quests | Design silent | Read only | None |
| G25 | Troy, Argos, Marathon, Ajax's camp, Helen, the Atreids | not in new worlds | G | Breadth freeze; mystery over reachability | Matches | Graph only | None |

### The hub, Lonely Forest and Badger

| # | Thing gated | Authored condition | Where | Intended (source) | Verdict | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | Black pond from the attic | lamp in the attic and not lit; live | hub:13 | Owner, 2026-11-10 | Matches | Graph only | None |
| H2 | Attic from the pond | lamp lit at the pond; live | hub:22 | Same | Matches | Graph only | None |
| H3 | Calling the Charybdis to the pond | lamp set down and lit at the pond, Black cloth in hand | GB:22 | Bridge description only | Design silent | Graph only | None |
| H4 | Stairs to the cottage | lit uncovered lamp in the attic, and the Black cloth there or any scarf carried | FB:16 | [Cosmetic upgrades](cosmetic-upgrades.md) | Matches | Graph only | None |
| H5 | Badger's clearing | two bell rings at the pond; open while a bell sounds | `v2/worlds/badger-forest/card-bridge.json`:24 | None found | Design silent | Graph only | None |
| H6 | Pip wants the lit Lamp; the keeper wants the Bell | starter wants | hub | "Pip's lamp stay as starter wants" | Matches | Read only | None |
| F1 | Moonlit Trail from the garden | flag `forest-path-cleared`, set by a Wait after RATi's welcome; latches | F:453 | Garden fork undecided | Design silent | Graph only | Later: a live condition on a thing |
| F2 | Moonlit Trail from the Oak | live: Wolfprint Charm near the Oak | F:435 | Named a live example | Matches | Graph only | None |
| F3 | The watch story | five flags in order; the last, `forest-watch-kept`, is read by nothing | F:472 to F:673 | Same tension as G17 | Design silent | Graph only | None now |
| F4 | Vale's button and scarf | meeting RATi hides the button anywhere; give it back; hold the scarf | F | Cosmetic upgrades | Matches | Graph only | None |

### RATi Radio

| # | Thing gated | Authored condition | Where | Intended (source) | Verdict | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Staff entrance | flag `station-open` or the Station Key in hand; flag set on first arrival, never cleared | RB:16, R:286 | "Gates should open and close based on item and avatar presence not stay permanently open" (decision 9) | Latches | Reproduced r6 | Remove the flag alternative |
| R2 | Dispatch Window | flag `dispatch-open`, set once while holding the Red Beanie | R:233 | Same; open question 13 recommends re-locking | Latches | Reproduced r6 | Route `live` on the beanie held |
| R3 | Listening Room | flag `listening-open`, set once while the Thermos lies at Dispatch | R:250, R:340 | Same | Latches | Reproduced r6 | Route `live` on the Thermos lying there |
| R4 | Broadcast Booth | flag `booth-open`, set by Talk with RATi holding the figurine | R:267 | Same | Latches | Reproduced r6 | Live on RATi needs the proposed "resident is at place" condition (rules); or live on the figurine held |
| R5 | Raven | flag `raven-awake`, set once when the three keepsakes lie in the Listening Room | R:107, R:428 | Owner lean: taking one away "relocks the door and scatters the request slip" | Latches | Graph only | Next rules batch |
| R6 | RATi himself | flag `rati-awake`, set on first arrival | R:47 | None found | Design silent | Reproduced r6 | None |
| R7 | Where the four keepsakes start | scattered into other packs by run seed. Over 400 seeds: 65% of worlds put one in Hoppy Cat's tea garden, 71% at the Willows landing, 94% one or the other; the beanie itself in 42% | R (`scatterOutside`) | "scattered through the other worlds, never inside RatiRadio" ([cross-world keepsakes](radio-cross-world-keepsakes.md)) | Matches | Reproduced r7 | None. Consequence: RatiRadio usually cannot be finished without the Greek ship and its cargo. Question 8 |
| R8 | Request Slip, Portable Radio | nothing reads either | R:216, R:223 | The slip "should have the 'quest' written on it" (owner lean) | No purpose | Graph only | Next batch for the slip |
| R9 | RATi's three staged wants; Raven's want | lay beanie, figurine, glass at home | R | [Pack contract](ratiradio.md) | Matches | Read only | None |

In a world with no run seed (tests, authoring) the Thermos starts on the Dispatch plate, so the Listening Room opens on arrival with no play (r6). Real games carry a seed.

### The Willows

| # | Thing gated | Authored condition | Where | Intended (source) | Verdict | Evidence | Fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W1 | Mist crossing, ship to River Landing | night, mist, ship at the pond or at sea, and provisions aboard or any Hoppy item aboard | WB:30 (cargo at WB:54) | "only night and mist open the way" (Willows README, [Willows at sea](willows-at-sea.md)) | Harder | Reproduced r9 | Delete the cargo `any` |
| W2 | Mist crossing back | night, mist, ship at the pond or at sea | WB:68 | None found | Design silent | Graph only | None |
| W3 | Canoe, pond and landing | live: the four kit things near the camp; Swede not gone | WB:90, WB:129 | [Willows kit and signs](willows-kit-and-signs.md) | Matches | Graph only | None |
| W4 | The Swede's departure | flag `willows-swede-gone`, never cleared; removes him and closes the canoe for good | W:590 | Open question 12 | Design silent | Graph only | Question 10 |
| W5 | The Swede may travel | while his kit is near the camp | W:211 | Willows kit and signs | Matches | Graph only | None |
| W6 | River Map, Stew Pot, Wooden Spoon, the Swede's Pipe | nothing reads them | W:311, 342, 350, 358 | "every item... has a purpose" | No purpose | Graph only | Reader or removal |

### Hoppy Cat (paused; listed only)

- Reached only by ship, Piraeus to the Signal Jetty, with provisions or a Hoppy thing aboard. The garden's thread to the pond is one-way out (GB:295; `v2/worlds/hoppycat-archive/card-bridge.json`:35).
- 14 of 52 choices sit at the retired Open-Record Cathedral and can never fire (`hoppycat-welcome` through `hoppycat-signal`).
- The Red-Thread Spool (H:459) shows at the Empty station whenever the keeper's oil is not there. Its only story use, `hoppycat-thread` (H:821), is one of the dead choices, so today its only effect is opening Greek lanes and the Willows mist.
- 4 of 10 places are retired; each seed draws 2 of the other 4 pool places.
- The 38 tea-table choices are a flag chain; five residents appear on a flag or a first meeting.
- Glim wants the Place Ring, which shows only if the Goldfish Tank was drawn or the ring has moved.

### Rules-level quests (brief)

- **Box quest** (`v2/card-game/world/offers.mjs`, `world/lock-goals.mjs`): a shut box offers a quest read from its lock. It reports wrong gates faithfully: the Piraeus box asked for the Funeral Cloth at the Hollow (r1).
- **Resident quest**: offered by a resident who told you their want. Matches the 2026-11-10 picks.
- **Home quest**: another avatar's home door asks for their item brought inside. Shared worlds only; not run.
- **Level quest** (`v2/card-game/want.mjs`): "Sleep at home" at the next level's XP. The owner's playtest note that Vale "shouldn't get a level until he has left the attic" was not checked.
- **Accepting**: every offer reads "Accept quest". The owner's 2026-11-11 playtest superseded this (quests accept themselves; the one button is Discard).

## 3. Tests and docs that encode a wrong gate

These describe the mistakes; they are not evidence for them.

- **Burial opens Attica (G1, G5, G15).** `test/helpers/open-door.mjs:75-85` throws if the flag is not set after the burial, and every Open Door suite starts from it. Also `test/card-greek-drama.test.mjs:381-477`, `test/card-polynices-funeral.test.mjs:135`, `test/card-open-door.test.mjs:196`, `test/card-ship-port-roads.test.mjs:396`, `test/card-show-every-lock.test.mjs:122-193`, `test/card-greek-boxes.test.mjs:97`; the Greek README (lines 112-115, 183, 270-272), `OPEN-DOOR.md`, Polynices' funeral ("Bury opens the Open Door") and items and crafting ("the Cithaeron road (after the burial)").
- **Long Walls need the Truce from the quay (G2).** `test/helpers/greek-travel.mjs:20`; the Greek README (lines 204, 283). `test/card-greek-lane-items.test.mjs:30` likely does too; only its title was read.
- **Hoppy cargo (G11, W1).** `test/card-ship-lanes.test.mjs:201`, `test/card-hoppycat-jetty.test.mjs:88-151`, `test/card-ship-port-roads.test.mjs:330-361`, `test/card-item-cycle.test.mjs:26`, `test/card-stuck-ship.test.mjs:3`; `v2/docs/card-packs.md` (lines 336, 822), both bridge descriptions and the Greek README (lines 257-262).
- **Patroclus after the burial (G14).** `test/card-greek-patroclus.test.mjs:65-74`; the Greek README (lines 50-54, 103); companions and quests, decision 7 and "No companion class".
- **The Hollow's shade lock (G6).** [The Hollow lock page](polynices-hollow-lock.md), `test/card-polynices-lock.test.mjs`, `test/helpers/greek-funeral.mjs:67-72`. `test/card-greek-antigone-home.test.mjs:53-66` may rely on it; only its titles were read.
- **Other.** The Greek README (lines 157-171) says the City Gate "stays open after" with two routes; the data has one live route. It also repeats the Antigone and Patroclus paragraphs several times. `test/card-ratiradio.test.mjs:162` and the RatiRadio page ("Opened routes remain open") encode R1 to R5. The Rust shared engine embeds the pack data, so its suites carry the same gates.

## 4. Questions only the owner can answer

1. **Should the road from the Piraeus quay to Athens be plain?** Recommended: yes. Let the Truce gate something that is about the Truce, not the road.
2. **By "the road to piraeus and the gate" as good live gates, did you mean the sea lane with the provisions aboard?** Recommended reading: yes; those are the two gates that already open and close on presence. Companions and quests read it as the Long Walls with the Truce; if this reading is right, strike that proposal.
3. **Does Patroclus wait for the burial?** Recommended: no. Docked at Piraeus with the provisions on deck, nothing else.
4. **Should the Hollow be a lock at all?** Recommended: no. A plain way off the battlefield, so the guard is the only thing between Antigone and her brother.
5. **Once the burial no longer opens the Open Door, should anything?** Recommended: nothing. Attica is there; Dione's story starts when you meet Aethra.
6. **May a Hoppy Cat thing open any lane while Hoppy Cat is paused?** Recommended: remove it from harbor to Piraeus and from the Willows mist now; leave it on Piraeus to the Jetty.
7. **Is the Open Door's 19-step flag chain acceptable under "no authored quest chains"?** Recommended: keep it for now, fix its ending (G18), rework it with the locks-and-slips batch.
8. **Should RatiRadio's keepsakes be able to start in Hoppy Cat's garden or at the Willows landing?** Recommended: leave both out of the scatter pool for now.
9. **RatiRadio's doors: close again when the thing is carried off?** Recommended: yes for the entrance, Dispatch and Listening now (data only); the Booth and Raven wait for the next rules batch.
10. **May the Willows canoe outlive the Swede's departure?** Recommended: yes; keep the canoe on the kit alone.
11. **One loaf, two routes.** After the Hoppy alternative goes, a player who feeds the guard first reaches Piraeus only by land. Recommended: accept it; with G1 and G2 fixed the land road is short.
12. **The ten items with no purpose.** Recommended: make the Burial Account the "burial rites" book and the Request Slip the radio's quest slip; give the Libation Wine a use at the second burial; remove the rest.
