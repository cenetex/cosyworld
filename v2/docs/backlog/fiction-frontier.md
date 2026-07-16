# The fiction frontier

Where CosyWorld meets the author's ML stable. This is a backlog design note,
not a commitment: each workstream below is sequenced *after* the #44 proof
world unless marked otherwise. The unifying test for everything here is canon
rule 5 — the machinery is the mythology — taken literally: every integration
must make something in the fiction *more true*, not just more efficient.

## The stable and the shared thesis

Three architectures, one discipline — how to use learning without letting it
lie to you:

| Project | Discipline | One-line shape |
| --- | --- | --- |
| `crlplrimes` | **Gate it** | Verifiers enumerate and ground candidates; a small learned scorer ranks the residual; certificates decide what any proposal may touch; every run emits replayable trace rows. |
| `nsrl` | **Replay it** | Integer-only deterministic training; models replay bit-exactly on CPU/WASM; falsifications preserved in history; judgment layers (Solomon Council) ship receipts and preserve dissent. |
| ZERO (`New project 4`) | **Account for it** | Language models built from the empty set upward, dependency-free C11, int8 WASM in-browser; the native corpus object is the *channel* (speakers, reply edges, roles, vibe, lossy memory, next act). |

CosyWorld's kernel already practices the same ethics ("clients cannot supply
roll results; the kernel derives everything from authoritative state and the
journal seed"). The frontier is extending that ethics upward from the dice to
the mind.

A structural fact worth stating once: **ZERO's channel is a CosyWorld room,
point for point.** Finite company of speakers → residents plus visitors.
Message and reply edges → the dialogue system. Local role, not permanent
identity → speech modes and personas. Shared atmosphere → room persona. A
changing, lossy account of what has happened → room memory. The next act that
alters the channel → the kernel action. The two projects specified the same
object independently.

## Workstream 1 — A resident whose mind is inspectable (ZERO / Moxie)

**Goal:** one resident whose entire cognition is a small deterministic
ZERO-family model running client-side (int8 WASM), seeded from the journal —
so that for one character, canon rule 5 is literally and verifiably true.

- Diegetic host: the Digital Realm; first candidate: Moxie (1060), the
  glitchcat. A mind made of doors, echoes, and code, living where the fiction
  already says such things live.
- Speech modes are decode constraints (emoji_only and emote_only residents are
  the cheapest first targets — tiny output alphabets).
- Corpus curation is register enforcement: train only on lines that pass the
  writing-register lint and NPC prompt contracts. The constitution becomes the
  training-data filter.
- Determinism contract: same journal prefix → same utterance. The generated
  line still enters the world through the normal kernel speech path
  (moderation and register guards unchanged).
- Honest-limits rule from the ZERO manifesto applies in-fiction: the model's
  small capacity is not hidden; it is Moxie's documented nature. Failure modes
  are characterization.

**Not before:** proof world has real players and the dialogue path is stable.
**First slice:** offline — export a channel corpus from journal
`message.created` history for one room, train, and evaluate register adherence
against the lint; no runtime integration.

## Workstream 2 — Memory that loses on purpose (channel-state)

#99 landed per-room dialogue retention (the ring buffer). ZERO's doctrine
("memory must lose — an endless transcript is storage, not memory") names the
next evolution: after an exchange, the room attempts to say *what the channel
has become* — a bounded, revisable, visibly-imperfect compressed state — while
exact turns fall out of the window and their pressure remains.

- Resident continuity notes (capped at 8, compressed, revisable) are already
  this shape at actor scope; this extends the same idea to room scope.
- The compressed room-state must be allowed to fail and must never be
  presented as a faithful archive (the SQLite journal remains the archive).
- Recall should be capable of abstention: if nothing aligns, the field stays
  silent — no invented continuity.
- Prompt integration replaces part of the raw recent-lines block (see the
  prompt-diet issue #60): identity + channel-state + freshest exchange.

**Sequencing:** after #60; design-sensitive (register of the compressed state
is authored surface — write the summarizer's register rules first).

## Workstream 3 — Certificate-gated resident actions (crlplrimes vignette)

CosyWorld already has the crlplrimes shape without the discipline:
`ResidentProposedAction` is a proposer; the kernel is the grounding operator.
The vignette formalizes it as a `cosyworld_resident` task schema:

- Candidates: legal kernel actions for the resident (enumerated, not sampled).
- Grounding: kernel legality plus room/turn constraints (already authoritative).
- Scorer: small deterministic ranker over desire/attachment/faction features —
  trained offline from journal traces, emitting replayable trace rows with
  matched baselines (random-legal, greedy-desire).
- Certificate grammar: predicates the fiction already states — never act
  against an attachment, prefer the active job's location, respect speech mode.
- Prize: routine NPC decisions become deterministic, auditable, and free;
  the expensive model is reserved for speech. Combined with Workstream 1,
  the *entire* mind of a background resident replays from the seed.

**Sequencing:** research-track; lives primarily in the crlplrimes repo as an
application-pressure vignette (like `signal_flight`); CosyWorld's only
obligation is a stable journal-trace export.

## Workstream 4 — Watch items (nsrl)

No integration yet; two triggers to watch:

- **Deterministic dialogue:** if nsrl's integer transformers reach
  channel-shaped output at acceptable quality, they replace the external LLM
  for replay-exact speech (the last non-deterministic component). Revisit
  after nsrl's successor-v2 line stabilizes.
- **Solomon Council as moderation:** a receipts-first judgment layer with
  preserved dissent maps cleanly onto moderation review. Blocked upstream:
  council promotion is unauthorized until nsrl's own evidence gate passes —
  respect their gate; do not adopt an unpromoted judge.

## Corpus notes (Left Sentences)

The ZERO manifesto is already in the sentences register. Candidates for a
future shelf expansion (subject to the author's pass, #55 register rules
apply):

- "Memory is not a transcript."
- "Fluency is not proof."
- "Recall should be capable of abstention."
- "The ground remains empty. The world does not."

## Sequencing summary

1. Proof world first (#44/#45) — nothing here gates it, nothing here precedes it.
2. Workstream 2 rides the prompt diet (#60).
3. Workstream 1 first slice (offline corpus/eval) any time after Left
   Sentences ships; runtime Moxie after real players exist.
4. Workstream 3 is upstream-repo research with a thin export obligation here.
5. Workstream 4 waits on upstream gates by design.
