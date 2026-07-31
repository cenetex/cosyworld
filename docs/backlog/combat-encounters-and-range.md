# Combat, Encounters, And Range — Backlog

**Epic**: Make combat read as a continuation of the shared room conversation,
with compact status in the avatar rail and a deterministic server-owned rules
model. The card hand remains for player choices; timing and status chrome must
not crowd it out.

**Status**: Groomed 2026-07-27, folded into this document 2026-07-30. The
chat-first half has largely shipped; the three-band spatial layer is direction,
not committed scope.

**Prior execution backlog**: epic
[#460](https://github.com/cenetex/cosyworld/issues/460) and children
[#467](https://github.com/cenetex/cosyworld/issues/467),
[#468](https://github.com/cenetex/cosyworld/issues/468), closed into this
document.

| Ticket | Prior issue | State |
| --- | --- | --- |
| Timing/status banner above the hand | [#461](https://github.com/cenetex/cosyworld/issues/461) | ✅ shipped |
| Keep the shared transcript mounted | [#463](https://github.com/cenetex/cosyworld/issues/463) | ✅ shipped |
| Authoritative equipped attack method | [#462](https://github.com/cenetex/cosyworld/issues/462) | ✅ shipped |
| CB-1 — truthful avatar-rail combat tracker | [#465](https://github.com/cenetex/cosyworld/issues/465) | **open issue** |
| CB-2 — pace automated actions one per reply beat | [#466](https://github.com/cenetex/cosyworld/issues/466) | **open issue**, partially shipped |
| CB-3 — one-line fate tags for RPG checks | [#464](https://github.com/cenetex/cosyworld/issues/464) | **open decision** |
| CB-4 — authoritative three-band range protocol | [#467](https://github.com/cenetex/cosyworld/issues/467) | direction |
| CB-5 — render and operate three zones in the rail | [#468](https://github.com/cenetex/cosyworld/issues/468) | direction |

Knockout presentation and identity moved to
[Avatar Lifecycle And The Rescue Run](avatar-lifecycle-and-rescue.md) — LC-0
and LC-1 own what #385 and #382 previously covered.

**Related architecture**:

- [CosyWorld RPG System Bible](../systems/09-cosyworld-rpg-system.md)
- [Combat system contract](../../v2/docs/combat-system.md)
- [Writing style](../../v2/docs/writing-style.md) — governs how chance reads in
  the transcript, which is the crux of CB-3.

---

## Product contract

- The shared room transcript stays mounted throughout combat.
- Ordered-combat timing is a clean red-accent banner above the card hand, never
  a wide pseudo-card.
- The avatar rail becomes the encounter tracker: current actor, target/status
  affordances, and compact Knockout/rescue representation.
- A knocked-out linked traveler is observably distinct from a generic inactive
  actor and does not receive ordinary actions that cannot commit.
- Attacks resolve from an authoritative equipped method supplied by the server.
- Automated combat advances one public action per room-reply beat so the
  transcript stays legible.
- RPG checks use compact one-line fate tags — **pending the CB-3 decision.**
- The later spatial layer has exactly three authoritative range bands and
  replays deterministically.

### Epic acceptance

A deterministic combat fixture can be refreshed and reconnected without
changing actor identity, available actions, timing state, attack method,
Knockout/rescue representation, or replay result. The transcript remains
readable, and neither the timer nor knocked-out avatars displace the actionable
card hand.

### Production evidence (2026-07-27)

At Flooded Barrow the linked traveler was reported unable to act while one
`Notice` choice remained visible and ten full-size portraits filled the rail, a
stale-choice rejection also visible. That screenshot establishes a
truthful-state and priority problem, but does **not** by itself prove every
other actor was knocked out. The lifecycle regressions must assert
authoritative lifecycle state, never infer it from the UI.

---

## CB-3 — The fate-tag decision (unresolved, blocking)

Recorded here because it is a live contradiction between two landed decisions,
and the implementation work has already been written and reverted once.

The contract as originally written wants `🎲 6 + 3 − 1 · Heart = 8` in the
transcript. A landed browser rule forbids exactly that:

```js
// v2/scripts/smoke-browser.mjs:4402
assert(!/d20|modifier|total|\bdc\b|>9<|>12</i.test(result.rollMarkup),
  `chance feedback should not expose dice arithmetic: ${JSON.stringify(result)}`);
```

It is not incidental. Neighbouring assertions say the same thing from other
angles: *"Check feedback should end with a plain outcome"*, *"chance feedback
should use the narrative card shape"*, *"Check feedback should offer one vivid
lead instead of an inventory"*.

An implementation attempt tripped the guard verbatim (`🎲 9 + 3 = 12 vs 10`) and
was reverted rather than deleting the assertion, since deleting it would
silently reverse a deliberate product decision about how chance reads in this
game.

**Three options; one must be chosen before any code:**

1. **Reverse the rule** — dice arithmetic becomes visible, `smoke-browser.mjs:4402`
   is removed or narrowed, and `writing-style.md` records the new stance.
2. **Keep the rule, move the tag** — arithmetic lives only in the
   developer-facing Log and the transcript stays prose-only. *Most consistent
   with the existing design, and the smaller change.*
3. **Close as won't-do** — the qualitative cards are the intended feel.

### Prerequisites, independent of the choice

- **Landed:** `apply_ability_check` never set `event->ability`, so every
  projected ability check reported Strength regardless of what was rolled.
  Fixed; the projection now sends the resolved attribute for ordinary checks,
  with a regression proving a Wisdom check is not mislabeled Strength.
- **Outstanding:** `roll_mode` exists on `cw_action` (`kernel.rs:389`) but is
  **not on `cw_event` at all**. The kernel rolls twice and reports only the
  surviving `raw_roll`, so advantage/disadvantage is not derivable from the
  emitted event. Any requirement that roll mode come from authoritative state
  needs `roll_mode` appended to `cw_event` and a `CW_KERNEL_VERSION` bump,
  populated in `apply_ability_check` and the combat attack path.

---

## CB-4 — Authoritative three-band combat range

**Priority**: P2 — direction
**Scope**: C kernel + ABI + persistence + offers
**Depends on**: CB-2

Add a minimal versioned spatial combat contract with exactly three stable
bands: `side_one_range`, `close`, and `side_two_range`. Historical
`cosyworld.combat/5` remains non-spatial.

### Rules

- Melee requires attacker and target in `close`.
- Ranged attacks may cross zero or one band; opposite outer ranges cannot
  attack directly.
- Move travels between a participant's own outer range and `close` and consumes
  the one-action activation.
- Support, recovery, items, and Magic gain no new range rule unless their
  authored method declares one.

### Contract

- Persist authoritative zone per active participant.
- Put legal target IDs and movement destinations into offers and views.
- Emit append-only `combat.zone.changed` events.
- Validate stale offers after movement.
- Authored encounters choose starting bands; the compatibility fallback is
  explicit.
- **Never synthesize zones into `combat/5` replay.**

### Acceptance

- [ ] The kernel rejects illegal opposite-range and melee-out-of-`close`
      attacks.
- [ ] Move changes the persisted band, consumes activation, emits once, and
      advances initiative.
- [ ] Restart, snapshot, and replay preserve zones and movement.
- [ ] Late join, Knockout, encounter resolution, stale offer, and every range
      pair are covered.
- [ ] `combat/5` fixtures remain byte-for-byte compatible.

---

## CB-5 — Render and operate three zones in the avatar rail

**Priority**: P2 — direction
**Scope**: browser rail
**Depends on**: CB-1, CB-4

Render authoritative three-band combat in the existing top rail as
`Left Range | Close | Right Range`, without introducing a second roster or a
full-screen board.

### Contract

- Place portraits solely from the authoritative zone field.
- Preserve health, current-turn, urgent-condition, legal-target,
  selected-target, and rescue-row behaviour.
- Attack emphasizes only server-offered legal targets; illegal actors remain
  visible with a reason.
- Move exposes the one legal destination without drag-and-drop and commits
  through the normal confirmation flow.
- Animate only after authoritative state arrives, and respect reduced motion.
- Narrow layouts collapse spacing and labels, never participants.

### Acceptance

- [ ] Zones and portraits remain correct after refresh, reconnect, movement,
      join, Knockout, and resolution.
- [ ] Opposite-range illegality is visible before confirmation and still
      enforced on forged requests.
- [ ] Keyboard and screen-reader users can discover zone, HP, status, current
      actor, targets, and movement.
- [ ] Desktop and mobile fixtures keep the transcript dominant and the tracker
      contained in the existing rail.
- [ ] Leaving combat restores the ordinary room rail with no stale zone
      decoration.
