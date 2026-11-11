# Factions at the scale of a hearth

Status: the owner's vision, supplied as an essay on 2026-11-11 and added here
as its own page. It is a direction to design toward. Nothing is built. The
text below keeps the owner's phrasing for the load-bearing lines. Only the
second-person address is turned into plain statements about the game, and
short glosses are added on first use. The closing section is notes from the
session and is not part of the vision.

The outside references (the links below) were supplied with the essay. The
project has not checked them.

Terms the repo defines, used here:

- **Rhapsode**: the Bard, `greek-rhapsode`, a wandering singer in the Greek
  pack ([seed sentences](../../v2/docs/card-table/seed-sentences.md)).
- **Account items**: the story documents of the Greek pack, such as the Burial
  Account, the Pyre Account and the Marathon Record
  ([Greek document art](greek-document-art.md)).
- **The loom**: the Greek epic plan, 132 planned beats across 44 strands
  ([Greek epic loom](../worldpacks/greek-epic-loom/README.md)).
- **Dione's table**: the baker's common table in the Greek pack, where water
  and wheat become bread ([items and crafting](items-and-crafting.md)).
- **Rules 100**: residents wander, want, return home and sleep
  ([world life](rules-100-world-life.md)).
- **`absentReturn`**: an item that goes home at dawn from the hands of a
  traveler who is away ([items and crafting](items-and-crafting.md)).

Terms from the owner's essay, not yet defined in the repo: the **lock
director**, the **scale law**, the **mortality cosmology**, the **jagged-AGI
constitution** (the owner's words; the repo has only
[Designing past the jagged edge](jagged-agi-level-design.md)), and the
**poem's density**.

## The finding

One finding dominates everything else, and it is the spine of the vision:
**none of these games author their factions.** Dwarf Fortress's tantrum
spirals, Stellaris's pop factions, CK's succession crises, Diplomacy's
betrayals: in every case the "story" is a *process running over agents with
wants*, and the design work went into the couplings, not the scenes. The games
that fail the way the owner fears, becoming scripted lists, are the ones that
author outcomes instead of authoring materials. Tarn Adams's formulation in
[his chapter on emergent narrative in Dwarf Fortress](https://www.degruyterbrill.com/de/document/doi/10.1515/9783839453452-007/html)
is that DF stories work because the simulation has no opinion about which
story should happen; [dwarves are "allowed to make bigger mistakes"](https://tech.yahoo.com/articles/dwarf-fortress-dwarves-more-human-192954956.html)
than authored characters. The moment the world *wants* Antigone's strand to
resolve beautifully, it is a scripted scene with extra steps.

## The lessons

| Game | The law | CosyWorld translation |
|---|---|---|
| Dwarf Fortress | Simulate agents + needs + grudges; stories are byproducts ([Adams](https://www.degruyterbrill.com/de/document/doi/10.1515/9783839453452-007/html)) | Residents already roam, eat, sleep (rules 100). Give them want-pursuit through the *same* legal verbs players use: no privileged AI path. |
| RimWorld | The storyteller decouples pacing from simulation | One is needed, but domesticated: it places **locks**, never events (below). |
| Factorio | Logistics is drama; the graph is the game | The provisions web (bread/figs/wine, one-of-each, `absentReturn`) is a tiny supply graph. Make rival wants depend on the same nodes. |
| Stellaris | Factions emerge from pop beliefs ([Game Developer](https://www.gamedeveloper.com/design/the-ethical-decisions-and-factional-politics-of-i-stellaris-i-)); but pure emergence reads as noise without legible anchoring ([Vice critique](https://www.vice.com/en/article/storytelling-in-stellaris-leaves-too-much-to-the-imagination/)) | Trust-graph clusters are the factions; the rhapsode and the accounts are the legibility layer that Stellaris lacked. |
| Crusader Kings | Character drives plot: opinions, stress, vices | The trust ladder (0-3 per pair) is a cleaner CK opinion system. Factions = clusters in that graph. |
| Diplomacy | Speech is commitment; the board is small and legible ([the honesty problem is literally a research field now](https://static-content.springer.com/esm/art%3A10.1038%2Fs41467-022-34473-5/MediaObjects/41467_2022_34473_MOESM1_ESM.pdf)) | Invert it: speech is free, acts bind. But keep the shape: small board, visible state, free-form negotiation. The shared worlds are already half-Diplomacy. |
| Civ | Agendas (some hidden) create readable rivals | A resident's desire is a hidden agenda learned by Talk. One want each, not ten modifiers. |
| Risk | Drama comes from the humans at the table, not the system | The multiplayer layer is the free dynamics. Factions give the shared table something to contest. |
| ADOM | Fixed world, permanent consequences across runs | Already true: a declined strand stays declined in that world. The world that remembers. |
| MUDs | The players were the content; wizards governed | The owner was one. The governance lesson is the constitution; the player layer is the shared avatars. |
| Versu / Prom Week | Drama from socially-situated agents enacting practices ([Evans 2013; McCoy et al.](https://scholar.tecnico.ulisboa.pt/api/records/rMxa63_rgxu9weNZH5UzjO4BhgmMg7O84ba6/file/36185d9ea87919658f51888f4be2fa057f0b01318cec7c0a20c54e52caf238e0.pdf)) | Social physics between residents with coupled wants: the academic version of what the rules engine already enforces. |

## The vision: factions at the scale of a hearth

The one move that would break CosyWorld is importing empire-scale factions.
The scale law (four places per district, three links per place, one road per
pair) is not a constraint on factions; it is their *protection*. A CosyWorld
faction is not a civ; it is **a house with a want**: Dione's courtyard, the
Theban court, the Argive mothers, the sanctuary. This is not a compromise
with the Greek material: it *is* the Greek material. Tragedy is faction
conflict at oikos (household) scale, household against household, household
against city. The reference implementation is already built: Dione's table.
Six laws:

**1. Wants interlock through the economy.** This is Factorio's gift,
domesticated. Pressure can't come from threat: no timers, no decay, no penalty
for absence. It comes from *rival wants needing the same one-of-each thing*:
the funeral cloth Antigone needs is the cloth the Eleusinian rite sent for;
the guard eats the bread Myrto needs for provisions. Scarcity with no clock.
The author pass here is small and precious: for each district, wire each
resident's want to consume or produce something another resident's want
needs. Interlocked wants in a one-of-each economy *are* faction tension; no
faction object is required yet.

**2. Residents pursue their want on the tick, through legal verbs.** The DF
law with the constitution applied: no privileged AI turn machinery. When the
world ticks, a resident may take one ordinary committed act toward their
want (fetch, carry, trade, lay) through the same `commit` path, journaled like
any act. Unwitnessed, they keep their hours (sleep, meals, roaming: the world
lives but doesn't lurch); witnessed, they act. The guard eating Dione's bread
is already this, hand-authored. Generalize it one verb at a time. The world
advances only through committed acts: that is the anti-script clause,
structurally enforced.

**3. Trust clusters are the faction substrate.** No authored rosters, no
faction flags. A faction exists when a cluster of the pair-trust graph shares
a place and a table. The Atreid tellings are already trust-topology variants.
Betrayal is a trust edge collapsing and an account changing hands. Faction
death is the table emptying, which ties straight into the mortality
cosmology: the graveyard fills with households, not just models.

**4. Memory stays physical.** Dwarf Fortress has Legends; Stellaris had
opinion modifiers floating nowhere; CosyWorld has something better and
stranger: **the account items and the rhapsode.** A faction's knowledge is
what is written on its table; a place's public opinion is literally what its
recital claims will sing. This is the Stellaris legibility fix
([the Vice critique](https://www.vice.com/en/article/storytelling-in-stellaris-leaves-too-much-to-the-imagination/)
named exactly this failure): emergence without readable anchoring is noise.
And it keeps "the world does not lie" intact: nothing is known that isn't
recorded somewhere a traveler can walk to.

**5. A lock director, not an event director.** RimWorld's real lesson is
separation of pacing from simulation. The domesticated version: the world
generator, already sanctioned for procedural expansion in the wants-and-arcs
decisions ([wants and arcs](wants-and-arcs.md)), becomes a **director of
locks**. It modulates which boxes are locked, which re-lock, and which rumors
the rhapsode surfaces, paced by the poem's density (a world dense with verse
gets quieter locks; a quiet world gets fresh boxes). It never spawns events,
never writes scenes, never times anything. A director that can only lock and
unlock is a storyteller that can't lie.

**6. No victory, only paperwork.** The anti-Civ clause, already half-true in
the data: every storyline in the greek pack resolves into a document on a
table: the writ, the truce, the account. Faction conflict doesn't end in
conquest; it ends in a record. That is also the tragic resolution and the
Diplomacy inversion in one: speech is free, acts bind, and settlements are
objects.

## What happens to the loom

The 132 authored beats are not the thing to abandon; they are the thing to
*unrail*. Authored strands become **stakes that factions contest**: the same
burial beat plays entirely differently depending on who holds the writ, whose
trust stands, and where the cloth went home to. Replayability through state,
not branches. Scripted *materials* in a systemic *process*: "scripted stakes
in an unscripted room." And the jagged-AGI constitution governs the whole
pipeline, exactly as written: generated possibilities, rules-verified
consequences, the owner's taste on what to Keep, the players conferring
meaning.

## Build order (groomable)

1. **Resident want-pursuit on the tick**: one verb, one resident, journaled
   (the guard's bread, generalized).
2. **District interlock pass**: author each resident's want into the local
   one-of-each web.
3. **Faction ledger as data**: trust-cluster + the table's account items;
   Dione's courtyard is the reference implementation, already shipped.
4. **The lock director**: a mode of the world generator gated by rhapsode
   repertoire, no event surface at all.
5. **Corpus faction context**: acts exported with cluster and account state,
   so the data carries which *relation system* the act happened inside. That
   is the dataset no strategy game can give: interpersonal faction dynamics at
   hearth scale, grounded by a rules engine, over months.

The one-line summary: Dwarf Fortress is a story generator because everything
in it is a process and nothing is a scene. CosyWorld can be the same machine
with the polarity reversed, a **poem generator**, where everything is a
committed act and nothing is an event, and factions at the scale of a hearth
are the coupling that turns a catalogue of beautiful strands into a world
that misbehaves.

## How this meets the other 2026-11-11 decisions

Notes from the session. This section is not part of the vision.

1. It agrees with reusable one-of-each items and live gates, as recorded in
   [companions and quests](companions-and-quests.md).
2. Law 2 (residents act through the same plays as players, journaled) is the
   target for the resident loop and for companions following.
3. One open tension for the owner: the essay has unwitnessed residents keeping
   hours ("sleep, meals"), while the owner decided the same day that
   residents sleep only at home to level.
4. A second open point: "unrail the authored beats" sits beside the owner's
   rule that authored text lives only in place, item and avatar descriptions.
5. The corpus items (pair trust on every act; acts exported with cluster and
   account state) have no schema in the repo yet.
