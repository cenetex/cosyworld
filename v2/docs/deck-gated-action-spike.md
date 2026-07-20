# Deck-gated ordinary actions — design spike

**Status:** prototype only; not selected, not compiled, and not authorized to
ship. Proposed identity: `cosyworld.variant/deck-gated-ordinary-actions/0`.

The default `cosyworld.srd5/1` mode remains a projection CCG: the server
computes every legal action and separately ranks a three-card suggestion hand.
This spike asks what would happen if a draw constrained ordinary actions as
well as prepared Magic cards.

## Prototype rules

- A constructed ordinary-action deck contains the twelve profile actions.
- The server shuffles from a committed seed and deals three cards at the start
  of an encounter or scene beat.
- Playing a card discards it. A refresh occurs after three plays or when every
  remaining card is contextually illegal.
- A card cannot create legality, ownership, a target, or a resolver. It can
  only expose an action already present in the authoritative legal superset.
- A dead hand offers **More** plus one free legal fallback chosen from the
  authoritative superset. Neither costs a turn, Orb, discard, or owned card.
- Communication, accessibility, leaving a scene, moderation/reporting, and
  account/deck management are never gated.
- AI and terminal clients receive the same committed deal and fallback. AI may
  describe a hand but cannot change it.

Card advantage is bounded to choice breadth: ownership cannot increase hand
size, refresh rate, action count, success chance, modifiers, turns, or maximum
power. Alternate art and labels may be collectible; all mechanical action
identities remain free.

## Scripted playtest

Run `npm run v2:spike:deck-gated`. The deterministic simulator executes 10,000
scene intents across all twelve actions. With a three-card hand, the projection
mode has a 0% initial miss rate and 0 selection delay. The current fixture's
gated prototype has a 74.47% initial miss/fallback rate, 0.745 mean additional
selection steps, and 0% lockout because of the mandatory free fallback.

That miss rate is the important result: even with perfect recovery, gating the
ordinary verbs adds friction to most specific intentions. A human playtest
would have to beat these shipping thresholds before reconsideration:

- shared-world/action lockout: exactly 0%;
- fallback use for an intended legal action: below 10%;
- abandonment after a dead hand: below 2%;
- median extra selection steps: 0;
- browser/terminal payload and deal parity: 100%; and
- no accessibility task may require a randomized draw.

## Decision boundary

This spike changes no default profile, worldpack, endpoint, snapshot, journal,
or existing replay. Shipping requires a new ADR, balance and accessibility
plan, human playtest evidence, explicit variant/extension identity, protocol
version, migration policy, and conformance fixtures. Completing this document
authorizes none of those changes.
