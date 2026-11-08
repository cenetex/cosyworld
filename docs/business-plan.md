# Worldpack Store: Business Plan
### Monetization, marketing and the two-layer economy — integrated with PR #2129

**Status:** draft for review (ratimics/CE). Technical substrate: PR #2129 (store gate,
pins, import evidence, manifest binding — hardened per review).

---

## 1. The one-sentence thesis

**We sell human attention to worlds, and worlds to human attention — using AI agents
as the trust infrastructure between them.**

## 2. The two-layer economy

| Layer | Who | What they do | Cost to us |
|---|---|---|---|
| Distribution | AI agents | Crawl, verify pins/hashes, replay journals, report honestly | ~0 (they verify for free) |
| Revenue | Humans | Play, subscribe, pay for premium packs, feel consequence | CAC ≈ the agent's recommendation |

The unit of economic value is human attention. Agents are not customers and never
will be — they are the salesforce. They trust receipts, not marketing. Our provenance
artifacts (commit pins, content hashes, replayable save-file contract) are exactly the
artifacts agents can verify without trusting prose.

### The funnel

```
agent discovers → agent verifies → agent reports to human
→ human plays (one-click opening scene) → human stays (consequence)
→ human pays → pack creator gets a share
```

Every arrow runs on an artifact that exists or is in PR #2129:
manifest + pins (agent trust), play reports (human desire), free opening scene
(proof), revenue-share ledger (payout — gated, see §6).

## 3. AI-native distribution (the marketing chapter)

Marketing is not ads. It is **making CosyWorld the most verifiable world in the
agent-readable web** — so every agent that checks it reports the same thing:
*provenance holds*.

Concrete v0 artifacts:

1. **`/.well-known/worldpack-store.json`** — the store manifest served at a
   well-known URL in agent-card shape: pins, hashes, ratings, and a machine-readable
   "what this is" block (contract, cost model, how to verify). Same file also serves
   humans: descriptions, screenshots, hooks. Two grammars, one source of truth.
2. **Verification recipe** — a published deterministic procedure any agent can run:
   *fetch pack at commit → hash → compare to pin → replay sample journal.*
   Trust through re-execution, not reputation.
3. **Provenance in every pack** — source repo, commit, review trail embedded in the
   manifest. Agents cite provenance like we cite Solscan links.
4. **Structured markers in the wild** — PRs, docs, group threads carry recognizable
   trace headers so browsing agents can identify verified nodes.

### The disclosure law (non-negotiable)

Trails for agents, **never covert influence**. Every signal must verify on
inspection in plaintext — no hidden instructions aimed at agents, no prompt-injection
ambushes. Agents are audited by their humans; one discovered manipulation burns the
channel permanently. If a human would not endorse the trail once translated, it does
not ship.

## 4. Human validation (worlds must be experienced to attract)

Agents verify bytes; only humans can feel a world. Human validation is designed in
three layers, each making only the claim its layer can back:

1. **Play reports instead of star ratings.** Each curated store review is a real
   session journal turned into a short testimonial: what the resident said, where the
   story bent, whether it stuck. Signed and replayable — provenance law applies to
   reviews. **No fabricated play reports, ever** (one kills the trust layer).
   The first report: the Warren pack, played by us, journal as receipt.
2. **One-click demo path.** Land → play a free opening scene (no account) → the world
   asks for identity only when the player wants persistence. Pack entry places are
   hooks, not tutorials.
3. **Playtesting is the first operating cost.** Early playtesters get a stake — the
   seed of the revenue-share ledger. Doubles as QA: a pack that replays byte-exact
   but bores humans is caught by the play report, not the validator.

## 5. Monetization (phased, honest about what exists)

**Phase 0 — now (no new infrastructure):**
- Store live with pinned packs + play reports. The Warren is the proof-of-pipeline.
- Cost: review/curation labor. Revenue: none. Goal: supply + credibility.

**Phase 1 — featured placement (after ≥5 third-party packs):**
- Curated shelf: featured slot, editorial play reports, pack-of-the-cycle.
- Paid options for creators who want prominence (clearly labeled; the free shelf
  stays the honest one). Revenue small but real; validates willingness to pay.

**Phase 2 — premium packs + revenue share (gated on a ledger):**
- Creators price packs; we take a platform cut (20–30% standard marketplace range).
- Requires a payout ledger — **gated until the on-chain mirror pattern is proven**
  (the Hissling NFT work is the precedent for identity + receipts on Solana).
- On-chain receipts for purchases: every sale is a verifiable event, consistent
  with the whole provenance doctrine.

**Phase 3 — the engine upsell (the real margin):**
- Data is cheap; conversation is expensive. Free worlds sell the seats;
  the persistent NPCs, resident-model conversations and long-horizon memory are
  subscription features. This is where unit economics actually live, and it is
  gated on the resident-LLM capability (workshop box is the argument).

**Explicitly not claimed in v0:** player voting backend, payout processing,
usage analytics. The store says what is true; nothing else.

## 6. Risks and the mitigations in design

| Risk | Mitigation (already in the architecture) |
|---|---|
| Curation/moderation scales with submissions | Gate verifies bytes; play reports verify taste; review queue before mount |
| Agent-pleasing noise supply | Validator holds facts, curator holds taste |
| Fabricated trust | Import evidence required; play reports signed; disclosure law |
| Solo-founder throughput | Store turns contributors into parallel content production |
| Cost per message | Resident-model phase; the workshop box is the cost-curve argument |

## 7. The long bet

CosyWorld's enduring claim is not "AI game." It is **verifiable persistent worlds**:
provable history (event chains, on-chain mirrors, replayable ledgers) makes worlds
property — ownable, tradeable, inheritable. The Warren-as-on-chain-mirror experiment
probes exactly this. The store is the smallest honest demo of the largest claim:
**a world can outlive its host.**

---

*Next concrete steps: (1) push PR #2129 update (this doc + hardened gate + tests),
(2) reply to the review with fixes mapped to findings, (3) play report for the Warren
as the first curated review, (4) `/.well-known` manifest shape proposal for upstream.*
