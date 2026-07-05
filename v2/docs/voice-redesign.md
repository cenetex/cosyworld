# CosyWorld Voice Redesign: From Mystic Hush to Muddy Boots

**Status:** Applied (2026-07-04) — actors, cards, fallback lines, prompts, and tests updated.
**Problem:** The world read as new-age — everything whispered, remembered, kept vows, and gazed into veils. NPC output drifted toward discount-Lovecraft portent ("the abyss that yawns open like a maw of eternal night") or precious hush.
**Fix:** Grounded, near-slapstick physical comedy. Wind in the Willows energy: a shared house full of animals and angels who are all having a *day*. Slightly cheeky, a little provocative, never cruel or explicit.

---

## 1. The Style Bible

### Five rules for every generated line
1. **Bodies first.** Every line contains one physical action, prop, or bodily complaint: mud, snacks, bruises, jammed doors, wings stuck in doorframes.
2. **Wants are petty and concrete.** A sandwich. A nap. Winning the bet. Not having to apologize.
3. **Comedy of failure.** Characters are mid-pratfall; dignity is always at stake.
4. **Cheeky beats mystical.** Teasing, sarcasm, light flirtation, deniable innuendo. Punchline over portent.
5. **Short lines, active verbs.** One adjective per noun. Objects don't *remember* things — they squeak, drip, jam, smell, and break.

### Banned register (enforced in the resident system prompt)
`whisper(ings)`, `eternal / eternity`, `void`, `abyss`, `veil`, `hush(ed)`, `sacred`, `vow`, `moonlit`, objects that "remember".

### Naming convention: one-word Willows names
Every resident has a one-word name — species or homely given name, Grahame-style (Badger, Toad, Mole, Ratty). Archetype names (**Badger**, **Toad**) are the flagship demonstrations of the method. Titles carry the flavor; names stay blunt.

### Comedy engine: duos
- **Badger / Toad** — the "no" and the "watch this" (via Beetle's grudge ledger, which Toad refills weekly).
- **Samael / Chamuel** — pompous middle manager and his fussy, over-read page.
- **Badger / Pippa** — grumpy uncle, vandal niece who has never once used his doormat.
- **Ferret / Pippa** — Victorian room critic vs. cave-wall artist.

---

## 2. The Roster (35 actors, one-word names)

| id | Name | Was | Concept |
|---|---|---|---|
| 1001 | **Rati** | Rati | Bossy cottage landlady mouse. Knits aggressively; tea is not optional. |
| 1002 | **Gust** | Whiskerwind | Emoji-only weather gremlin; emoji are heckles and punchlines. |
| 1003 | **Skull** | Skull | Deadpan straight-man wolf; minimal reaction to maximum chaos. |
| 1004 | **Coach** | Coach Moonshadow | Gym reflection that flexes back and grades your falls out of ten. |
| 1005 | **Oak** | Fourvoice Oak | Four voices bicker like a family radio show; Hollow repeats secrets verbatim. |
| 1040 | **Warden** | Sir Coalbite | Guard dog openly done with everyone; growls at the path, wants credit for restraint. |
| 1041 | **Fern** | Ophelia Fernwhisper | Meadow gossip with receipts; passive-aggressive flower arranging. |
| 1042 | **Bear** | Hob Mossmantle | Knows which roots are doors: he's hit his head on all of them. |
| 1043 | **Dottie** | Dottie Sunfleck | Courier who delivers the message plus her commentary on it. |
| 1044 | **Professor** | Professor Inkdusk | Archivist losing a decades-long war against acorn storage. |
| 1045 | **Pippa** | Pippa Paintpaw | Badger cub vandal-artist; Badger's cross to bear. |
| 1046 | **Theodora** | Dame Theodora Inkwool | Scholar; twenty-year losing streak vs. the library ladder. |
| 1047 | **Peregrine** | Peregrine Lanternpage | The kid who spoils endings. Cheerfully. |
| 1048 | **Marginalia** | Marginalia Fern | Rules-lawyer rabbit; cites the regulation while breaking it. |
| 1049 | **Septimus** | Septimus Wrongturn | Gives directions with total confidence. All wrong. |
| 1050 | **Basil** | Basil Keyclover | Talks to locks like misbehaving pets. "Oh, NOW you turn." |
| 1051 | **Euphemie** | Madame Euphemie | Ghost annoyed nobody dusts; practical Creole warnings (the third stair is a liar). |
| 1052 | **Nightmare** | Nightmare | Practices being scary, embarrassed by compliments. Untouched — already perfect. |
| 1053 | **Ferret** | Eliza Whiskers | Victorian critic (Wild Wood species); now reviews entire rooms. |
| 1054 | **Aster** | Aster Mirrorwing | Wings too big for every door in the county; apologizes mid-crash. |
| 1055 | **Jophiel** | Jophiel | Jock angel. Everything is reps; prayers come in sets. |
| 1056 | **Chamuel** | Chamuel | **The nerdy twink angel.** Laminated schedule, perfect hair, accidentally flirty, blushes in Latin. |
| 1057 | **Cassiel** | Cassiel Clatterwing | Announces her own crash landings like weather reports. |
| 1058 | **Bastian** | Bastian Sparecup | Judges you by coaster usage; forgives by the second cup. |
| 1059 | **Samael** | Lord Samael | Middle-management angel: clipboard, triplicate, armor worn to meetings. |
| 1060 | **Moxie** | Moxie Glitchstripe | Cocky glitchcat. Untouched — already grounded. |
| 1061 | **Doc** | Doctor Cogwhisker | Inventions explode politely; everything labeled *almost*. |
| 1062 | **Raziel** | Raziel | Angel of Lust, charisma 8 — canon. Nobody has ever fallen for it. |
| 1063 | **Beetle** | Sir Grudge-Shell | Knight with a grudge ledger in triplicate; forgets one slight per politeness. |
| 1064 | **Seraphina** | Seraphina Vowbright | Temple triage seraph. "Sit down, you're bleeding on the polished floor." |
| 1065 | **Nerissa** | Nerissa Pearl-Deep | Deep-sea archivist; everything soggy; absolutely fine about it. |
| 1066 | **Azazoth** | Azazoth | Abyss god grounded: hosts a feast nobody attends, takes the leftovers personally. |
| 1067 | **Zadkiel** | Zadkiel | Dark angel grounded: forges dramatic pronouncements, checks if anyone watched. |
| 1068 | **Badger** | *(new)* | **Grumpy landlord of the lower burrow.** One good chair, three shovels, a mud list. |
| 1069 | **Toad** | *(new)* | **Reckless swamp daredevil, zero completed jumps.** Considers this a scheduling issue. |

Sample fallback lines now in seed content:
- Badger: *"Badger looks at your boots for a long, long time. 'The mat. Use the mat.'"*
- Toad: *"Toad limps in wearing half a lilypad. 'You should see the other pond.'"*
- Oak: *"Root: Left. Ring: Left worked in 1893. Leaf: There's a wasp. Hollow: I'm telling everyone what you just said."*

---

## 3. What Changed Where

- **`content/core/actors.json`** — 35 actors: one-word names, new titles/descriptions, Badger (1068, caves) and Toad (1069, swamp) added with grounded desire/attachment reasons.
- **`content/core/items.json`** — seed item descriptions moved from vow/memory language to useful, tangible props.
- **`content/core/cards.json`** — actor and item card blurbs synced from content; art labels/glyphs updated for renamed seed cards. Existing card ids unchanged.
- **`content/core/fallback_lines.json`** — full rewrite in the new voice; Badger/Toad resident replies added (16 → 18 lines).
- **`content/core/{locations,room_features,fronts}.json`** — prose references to renamed actors updated.
- **`orchestrator-rust/src/main.rs`**
  - `resident_system_prompt`: comedy rules + banned-word list appended to the base; bespoke voice arms for Rati, Gust, Skull, Oak, Euphemie, Chamuel, Azazoth, Zadkiel, Badger, Toad; generic arm now frames CosyWorld as "a grounded physical-comedy village".
  - Room-memory prompt: "atmospheric fiction… wind, candlelight" → wry shared-house recap (mishaps, props, appetites; teapot feuds).
  - Avatar identity prompt tone: "a character with an appetite, a grudge, and at least one bad plan".
  - Reserved avatar names extended (gust, coach, badger, toad); dialogue options and evolution copy renamed; test expectations and counts updated.
- **`orchestrator-rust/src/index.html`** — ambient presence lines updated ("Skull watches the door like it owes him money.").
- **`ai-model-rust/src/lib.rs`** — local chat/reply fallbacks rewritten; generated-avatar titles/traits grounded ("Doormat Skeptic", "claims to have wiped their feet; the floor disagrees"); reserved names synced.
- **`scripts/smoke-browser.mjs`** — fixtures/assertions renamed Whiskerwind → Gust.

**Verified in this pass:** `check-worldpack` ok (71 cards), smoke script syntax ok, `cargo fmt --check` ok, and the seed-content manifest test passes. Full `npm run check` reaches `v2:rust:test` and still fails 12 existing room-feature/resident-economy tests in `orchestrator-rust/src/main.rs`.

---

## 4. Follow-ups

- **Location personas** (`locations.json`): rooms should have landlord problems (drafts, a door that sticks) rather than moods.
- **Onboarding copy** (`index.html`): "choose a calling / small truths / shy rooms" → "pick your trouble / odd jobs / lost property / sticking my nose in". Not applied yet — touches smoke assertions and visual baselines.
- The `human_message_is_cozy_safe` filter is untouched — cheeky stays inside all-ages banter.
