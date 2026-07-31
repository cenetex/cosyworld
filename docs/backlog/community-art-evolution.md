# Community Art Evolution

Status: first vertical slice shipped in the Rust/browser implementation; production hardening remains.

The follow-on epic — [Reference-Composed World
Scenes](#follow-on-epic-reference-composed-world-scenes) — was groomed
2026-07-26 and folded into this document 2026-07-30 from issues
[#396](https://github.com/cenetex/cosyworld/issues/396),
[#399](https://github.com/cenetex/cosyworld/issues/399),
[#400](https://github.com/cenetex/cosyworld/issues/400),
[#401](https://github.com/cenetex/cosyworld/issues/401),
[#402](https://github.com/cenetex/cosyworld/issues/402), and
[#335](https://github.com/cenetex/cosyworld/issues/335). It is direction, not
committed scope.

## Product decision

Orbs exist to help the community make shared images. They do not pay for Chat or any other world verb.

Every eligible generated collectible has one community generation available at each authoritative level. The pooled Orb price is exactly the level. A level-3 location therefore needs three community contributions in total, not three from every player. Funding never changes ownership, access, mechanics, rarity, success, or level.

The generated image belongs to the public card. Its prompt uses the card identity and public event history through the funding sequence. When the collectible later reaches a new level, the newly unlocked image can evolve in response to the history accumulated since its previous image.

## Implemented slice

- Chat and repeat Listen/Notice have no Orb affordability check, debit, or refund path; Chat's separate cost is one banked advancement point.
- `community_image_generation` is the only negative Orb reason emitted by new player actions.
- Eligible subjects are cards whose art is still pending or generated: avatars,
  locations, and items from mounted packs, plus familiar generated pathway
  locations. Authored final and on-chain art remain ineligible.
- Card state exposes `level`, `required_orbs`, `funded_orbs`, `remaining_orbs`, `status`, and `history_through_seq`.
- `POST /actions/fund-image` accepts one Orb per request, journals the contributor and funding mutation atomically, caps the pool at the level, and does not advance the room turn.
- Provider absence fails before debit. Fully funded failures/retries do not debit again.
- Replicate generation is asynchronous. A committed ready result swaps the card to the shared generated asset with a level cache key.
- Avatar image briefs include the persisted physical description plus current
  species, origin, class/classless state, level, calling, location, and up to
  eight carried or equipped items. Item and location briefs include their
  authoritative world details as well as public history.
- Funding and status survive snapshots and action-journal replay. In-flight job de-duplication is currently process-local.
- The existing keepsake modal shows pooled progress and provides the contribution/retry action; no separate currency UI was added.

## Groomed backlog

### P0 — production safety

- Move generation into a durable `media_jobs` queue with leases, retries, dead-letter state, and startup recovery for fully funded jobs.
- Store assets in durable object storage and retain immutable `{subject, level, revision}` provenance instead of replacing one local file.
- Add an automated invariant/alert: every new negative Orb ledger row must have reason `community_image_generation` and a matching accepted funding mutation.
- Add moderator reject/replace controls. Rejection and replacement must never charge the community again.
- Record provider/model/prompt version, history range, contributor totals, source funding event, output digest, and moderation status in the media asset record.

### P1 — complete the collectible model

- Make level authoritative for generated items and locations, not just avatars. Define the gameplay event that advances each type; Orb funding must never advance it.
- Decide whether one level unlock applies per card identity, per shard-local instance, or per canonical collectible. Default: canonical shared subject for locations/avatars; instance for materially distinct crafted items.
- Add history-delta prompt construction so level N emphasizes events since level N-1 while retaining stable visual identity.
- Add optional reference-image composition from the prior ready level to preserve recognizability across evolution.
- Let contributors inspect the public history summary and cost before contributing, without exposing raw prompts or private/moderation data.

### P2 — community and operations

- Show contributor attribution and funding completion in the public Journal/chronicle without turning the room transcript into a transaction feed.
- Add operator views for funding funnels, provider failures, generation latency, retry count, cost per ready image, and abandoned partial pools.
- Establish refund policy only for permanently cancelled card identities. Provider failure alone is retryable and should not refund/recollect.
- Consider contribution amounts greater than one only if the one-Orb press becomes burdensome; preserve exact pooled cap and idempotency.

## Acceptance invariants

1. A zero-Orb avatar can Say, Listen, Help, travel, fight, grow, and manage cards; it can Chat whenever banked advancement makes that friendship action available.
2. For subject `S` at level `L`, accepted contributions total at most `L` Orbs and at most one image becomes ready.
3. Concurrent/replayed contribution requests cannot overfund, double-debit, or create multiple generation jobs.
4. A provider outage, invalid subject, invisible card, completed level, or retry after full funding debits zero Orbs.
5. The prompt is derived only from committed public history through a recorded sequence.
6. A ready image changes presentation only; mechanics and ownership are byte-for-byte unaffected.
7. Reaching level `L+1` creates a fresh pool of `L+1` Orbs while preserving the prior level's provenance.

---

## Follow-On Epic: Reference-Composed World Scenes

**Outcome**: treat every approved avatar, item, and location image as a
reusable, immutable reference asset, then compose bounded world scenes from
those references instead of regenerating from prompts alone.

| Ticket | Prior issue | Priority |
| --- | --- | --- |
| Version-pinned provider/reference capability registry | [#398](https://github.com/cenetex/cosyworld/issues/398) | ✅ shipped |
| CA-1 — immutable reference asset graph | [#399](https://github.com/cenetex/cosyworld/issues/399) | P2 |
| CA-2 — canary FLUX.2 single-reference evolution | [#400](https://github.com/cenetex/cosyworld/issues/400) | P2 |
| CA-3 — bounded scene composition | [#401](https://github.com/cenetex/cosyworld/issues/401) | P2 |
| CA-4 — per-generation visual publication gate | [#402](https://github.com/cenetex/cosyworld/issues/402) | P2 |
| CA-5 — worldpack-scoped unexplored art lifecycle | [#335](https://github.com/cenetex/cosyworld/issues/335) | P2 |

### Problem

CosyWorld generates avatar, item, and location bases through Replicate FLUX.1
LoRA recipes. Those images are useful final assets today, but they are not a
durable visual vocabulary that later generations can reference. As the world
begins to illustrate encounters and shared scenes, prompt-only regeneration
will drift identities, invent absent actors, omit authoritative items, and lose
worldpack art direction.

FLUX.2 adds reference-image generation and editing, but changing the default
model everywhere would mix four separate decisions: base quality, identity
preservation, scene composition, and provider migration. Keep them separate.

### Architecture

> Authoritative world snapshot + approved immutable reference assets + frozen
> versioned media recipe → stored candidate image → visual publication gate →
> approved asset, or withheld for audit.

**Reference images are evidence for appearance, never authority for world
facts.** The journal/world projection decides who and what is present.
Generated media changes presentation only.

### Migration stages

- **A — Preserve the current base layer.** Keep FLUX.1 LoRA recipes available
  for base generation. Promote approved outputs to immutable, hashed reference
  assets with provenance. Do not re-render existing canonical art merely to
  change providers.
- **B — Reference-preserving evolution.** Add a version-pinned FLUX.2
  capability for one-reference edit/evolution, using the prior approved level
  as the primary identity reference.
- **C — Bounded scene composition.** Compose location + actor(s) + item from
  indexed references and an authoritative scene snapshot. Freeze reference
  order/roles; reject jobs exceeding a model version's declared limits. Never
  silently drop a subject.
- **D — Re-evaluate base generation.** Run FLUX.2 base generation against the
  incumbent per media profile. Migrate a profile only when evidence shows a win
  and rollback remains possible.

### Invariants

- Every request pins provider, model/version, capability, prompt version, seed,
  input asset hashes, reference roles/order, subject/event boundary, and
  worldpack media profile.
- Provider reference limits are capabilities of a pinned model version, not
  hard-coded assumptions.
- No candidate becomes public before approval.
- A failed or misleading image cannot mutate actors, inventory, topology,
  history, funding, or ownership.
- Retry is idempotent and never recollects Orbs; policy-service failure retains
  the candidate instead of buying another generation.
- Secrets and arbitrary provider request bodies remain host-owned; packs select
  only allowlisted media profiles.
- Authored/on-chain art is never converted into a model input unless its
  rights/provenance policy permits it.

### Delivery order

1. Capability recipes (#398, shipped) establish the provider boundary.
2. CA-1 makes current approved FLUX.1 art reusable without regeneration.
3. CA-4 may proceed beside CA-1, but **no new media intent publishes before it
   lands.**
4. CA-2 runs shadow evaluation and canary first.
5. CA-3 starts with one location, up to two actors, and one item.
6. FLUX.2 base generation is evaluated only after these slices expose real
   quality, cost, latency, and rollback data.

---

### CA-1 — Make approved art an immutable reference asset graph

Approved card art is currently treated mainly as a display result. Reference-based
generation needs stable, permissioned inputs whose identity survives cache keys,
replacement, provider retries, pack upgrades, and later scene composition. **A
mutable URL is not sufficient provenance.**

**Asset and lineage contract.** Record: immutable asset ID, content digest,
dimensions, MIME type, stable object-storage location, creation time; subject
kind/ID, level/revision, pack provenance, approval/moderation state; source kind
(authored, on-chain, imported, generated, derived); whether reference reuse is
permitted and its rights basis; provider/model/version, prompt version, seed,
prediction ID, source event boundary; parent asset IDs plus reference slot,
order, crop/mask, and transformation for each derived asset; supersession
without mutating or deleting historical lineage.

**Deterministic resolution.** Given an authoritative media intent and world
snapshot, resolve required typed slots in a stable order, preferring the
currently approved canonical revision. If a required asset is missing,
unapproved, inaccessible, or unlicensed for derivation, the job is ineligible —
never fall back to an unrelated visual. When a scene exceeds the recipe's
reference budget, return an explicit composition-plan requirement.

**Acceptance**

- [ ] Existing approved FLUX.1 LoRA outputs backfill as immutable reference
      assets without re-generation.
- [ ] Replacing public art preserves the old asset and lineage while moving the
      canonical pointer to a new approved revision.
- [ ] References resolve deterministically across restart, replay, pack mount
      order, and cache eviction.
- [ ] Every derived asset exposes complete parent/reference lineage by digest
      and role.
- [ ] Authored/on-chain/imported assets default to non-derivable until policy
      explicitly permits use.
- [ ] Unapproved, rejected, private, deleted, or rights-ineligible images cannot
      enter provider requests.
- [ ] Over-budget and missing-reference fixtures fail without provider spend.
- [ ] No asset mutation changes subject ownership, level, inventory, location,
      or journal state.

---

### CA-2 — Canary FLUX.2 single-reference art evolution

Later-level community art should reflect new history while remaining
recognizably the same avatar, item, or place. Prompt-only generation cannot
reliably preserve identity; switching all base generation to FLUX.2 before
measuring it risks degrading established pack styles or raising cost and
latency.

**The evolution brief** freezes: subject identity and persisted visual
description; the prior approved asset digest as a required `prior_level`
reference; the public history delta since that asset plus the committed cutoff
sequence; stable traits that must not change and a bounded list of requested
changes; worldpack media profile, target level/revision, aspect/crop, negative
constraints; the exact resolved recipe and lineage fields. The prompt may
describe appearance and public events. It cannot infer mechanics, possessions,
relationships, or location beyond the authoritative snapshot.

**Evaluation gate.** Build a reviewed corpus spanning avatars, items, locations,
multiple pack profiles, dark/light subjects, and small/large history deltas.
Compare incumbent and candidate on subject recognizability, stable-trait
retention, requested-change accuracy, pack fidelity, absence of invented
actors/items/text/logos, composition usability, safety pass rate, cost,
latency, provider error rate, and retry spend. Store blind human preferences
alongside automated signals. Choose thresholds per media intent and profile —
one global score must not hide a weak subject class.

**Rollout.** Shadow-only, then canary a small percentage of eligible level
evolutions. Keep the prior approved image public until the new candidate passes
review. Rollback changes routing only; it does not mutate funding or lineage.

**Acceptance**

- [ ] A prior approved asset is required and frozen into the job by digest.
- [ ] History prompts use only the committed public delta and preserve declared
      stable traits.
- [ ] A reviewed incumbent-vs-candidate corpus reports quality, safety, cost,
      latency, and error metrics per subject kind and profile.
- [ ] Canary thresholds and an automatic disable/rollback condition are
      explicit.
- [ ] A rejected or failed evolution leaves the prior approved asset public and
      charges no additional Orbs.
- [ ] At least one avatar, item, and location fixture preserves recognizability
      while incorporating a legitimate later-level change.
- [ ] Base generation remains on its existing recipe until its own
      profile-specific comparison wins.

---

### CA-3 — Compose bounded scenes from authoritative references

A composed image can imply world facts more strongly than prose: an absent
person, missing carried item, wrong location, or invented relationship becomes
visible canon to players. Passing several references to a model is not enough —
the composition request must be a truthful, replayable projection of one
committed scene boundary.

**First supported template**: exactly one authoritative location plate; one or
two present actors; zero or one selected important item; one committed
scene/event boundary; one resolved worldpack media profile. The model
illustrates this scene but cannot choose its cast, inventory, location,
outcome, or relationship facts.

**The frozen scene brief** records room identity and committed projection
sequence; ordered actor IDs with approved reference digests, poses/attention
only when grounded by the event; selected item ID, owner/holder, and digest;
location reference digest and environmental facts; the public beat to
illustrate; intended media use, aspect/crop/safe areas, payer policy,
visibility; forbidden subjects/facts and pack constraints; typed indexed
reference order and exact resolved recipe.

The **scene projector, not the image model, resolves the cast.** A prompt phrase
such as "image 1 is the location; image 2 is actor A" is generated from typed
slots and covered by adapter tests.

**Reference budgeting.** Resolve all required subjects before generation. If the
model version cannot accept the full set: select another compatible allowlisted
recipe; or create an explicit, separately reviewable multi-pass composition
plan; or leave the scene unillustrated. Never silently drop, merge, or replace a
required subject. Multi-pass outputs retain full intermediate lineage.

**Acceptance**

- [ ] A fixture composes a location, two distinct actors, and one held item
      from immutable references.
- [ ] The job is byte-for-byte traceable to a committed scene projection and
      exact reference order.
- [ ] Removing an actor or item from the authoritative snapshot removes it from
      the required composition set; provider output cannot add it back to state.
- [ ] Missing, rejected, or rights-ineligible references make the job
      explicitly ineligible before provider spend.
- [ ] Over-budget reference sets use a declared fallback or remain
      unillustrated; no subject is silently omitted.
- [ ] Replays and retries reuse the same logical job and do not publish
      duplicate scene assets.
- [ ] The existing location image or deterministic fallback remains public
      until the candidate passes review.
- [ ] Tests cover swapped reference order, duplicate actors, absent item, stale
      snapshot, pack boundary, and provider timeout.
- [ ] Arbitrary crowds and unconstrained combat tableaux are explicitly out of
      scope for this slice.

---

### CA-4 — Gate every generated image before publication

Reference-capable models can still drift identity, duplicate or omit subjects,
invent people, render text, or violate safety constraints. A model-level
allowlist alone cannot make a particular image truthful. Conversely, one bad
output should not permanently exclude a useful model.

CosyWorld already withholds misleading generated location art. Scene
composition needs that rule generalized to every candidate and every media
intent.

Every provider output is stored as an **untrusted candidate** and evaluated
against its frozen brief before any public pointer changes:

- **pass** — approve and atomically publish the candidate revision;
- **content fail** — retain the candidate and reasons for audit, leave the
  previous truthful asset visible, retry only under bounded policy;
- **reviewer/infrastructure unavailable** — keep the candidate pending and
  retry review without buying another generation;
- **repeated operational provider failures** — cooldown or reroute the recipe
  without mutating world state.

A failed candidate informs routing quality but does not permanently ban the
model family.

**Gate checks**, cheap deterministic first, then bounded visual review:
decodable image and expected format/dimensions/aspect; safety and moderation
policy; no prohibited text, logos, watermarks, prompt leakage, or UI artifacts;
expected subject count and no extra people or creatures; identity/reference
similarity per subject within intent-specific thresholds; required item presence
and ownership when visually asserted; location match; crop usability;
near-duplicate detection against recent revisions; pack-specific negative
constraints.

The reviewer receives the frozen brief and approved reference thumbnails — not
secrets or raw provider payloads. Its verdict is structured, versioned, and
bounded; **it cannot publish or mutate state directly.**

**Retry and routing.** Bound attempts and total spend per logical job. Never
debit or recollect Orbs on moderation or provider retry. Prefer review retry
over generation retry when review fails operationally. Record pass/fail by model
version, profile, intent, and failure reason. Use canary weights and cooldowns
to favour reliable recipes while continuing bounded exploration. Escalate
terminal or ambiguous candidates to moderator review, preserving the truthful
fallback.

**Acceptance**

- [ ] No provider response can update a public asset URL before a persisted
      passing verdict.
- [ ] The gate generalizes the existing location-art truthfulness contract
      without regressing it.
- [ ] A fixture catches an extra actor, missing required actor, wrong item,
      identity drift, text/logo, blank image, unsafe content, and
      near-duplicate.
- [ ] Policy or reviewer outage retains one candidate and retries review
      without another provider prediction.
- [ ] Retry budgets are durable and idempotent across process restart and
      replay.
- [ ] Every verdict records checker versions, signals, reasons, references,
      candidate digest, and final disposition.
- [ ] Dashboards expose pass rate, failure taxonomy, cost per approved asset,
      review latency, retry spend, and model/profile/intent slices.
- [ ] Operators can inspect, approve, reject, replace, or disable a recipe
      without charging contributors or changing mechanics.
- [ ] A rejected candidate never becomes a reference input for later
      generations.

---

### CA-5 — Worldpack-scoped unexplored art lifecycle (Holy Land first)

The 31 authored Holy Land cards have a pack-specific art pipeline pinned to
`ratimics/b43l` with trigger `B43L`, but Orb-funded runtime art does not inherit
that profile. The live `cosyworld` Fly configuration routes every community-art
subject through the global `black-forest-labs/flux-dev-lora` +
`immanencer/mirquo` profile and prefixes prompts with `MRQ`.

Generated pathway locations also reveal a deterministic scene SVG before
community art exists. That is mechanically safe, but it weakens the feeling that
a newly discovered place is still visually unexplored.

**Lifecycle**: `hidden` → `discovered_unillustrated` → `funding` → `generating`
→ `ready`, where `generating` may transition to `failed` with a free retry while
the funding threshold remains satisfied.

**Contract**

- The 31 authored Holy Land WebPs are permanent base art and never require Orb
  funding.
- A hidden generated location leaks no card or bespoke scene art.
- A discovered but unillustrated location projects a stable, nonrepresentational
  **Unexplored** placeholder plus its level-1 Orb image contract.
- Funding and generation keep the placeholder visible; a committed ready event
  atomically swaps in the shared generated image.
- Failed or restarted jobs return to a recoverable state without a broken image.
- Worldpacks may declare a bounded media profile: provider/model identifier and
  pinned version, trigger/prompt prefix, aspect policy, negative constraints.
- A generated location inherits its media profile from the canonical
  route/worldpack that owns it. Cross-pack routes use an explicit resolver and
  deterministic host fallback; they never silently borrow an endpoint style.
- Holy Land generated location prompts use `ratimics/b43l` version
  `2846199bda89a44676dc5da00bd02faa3f5183b1c1d3e124c966d656874f141f` and begin
  with `B43L`, not `MRQ`.
- The model creates visual prose only; authoritative ecology, actors, topology,
  access, rewards, and rules remain server-owned.

**Acceptance**

- [ ] A newly discovered Holy Land waypoint displays the common Unexplored
      placeholder, not its generated pathway SVG.
- [ ] Its modal exposes the level-1 Orb contract.
- [ ] A captured provider request for that waypoint uses the pinned B43L
      model/version and a prompt beginning with `B43L`.
- [ ] Core and default generated art continue using the configured default
      profile.
- [ ] Authored Holy Land base cards continue loading their existing 31 WebPs.
- [ ] Pending, failed, restarted, and ready transitions have projection and
      replay coverage.
- [ ] The placeholder never depicts people, structures, or biome facts not yet
      revealed.
- [ ] Pack validation rejects incomplete or unsafe media profiles.
- [ ] Browser coverage proves no broken-image or premature-scene-art state.
