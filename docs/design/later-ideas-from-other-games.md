# Later ideas from other games

Status: planning, 2026-11-01. Nothing here is built. The ideas come from
studying Fable, Diablo, Pokémon, Stardew Valley and Animal Crossing. Each one
uses generic rules and the fixed verbs, one want per avatar, and pack data
before engine changes. XP only goes up, and levels stay the only rarity.

Ideas with an owning guide live there:

| Idea | Where |
| --- | --- |
| Companion with a met want, shared XP, marriage | [Quest journeys](../../v2/docs/card-table/roaming-quests.md#later-company-that-stays) |
| A visit's length and stopping point | [Rest and sanctuary](../../v2/docs/card-table/rest-and-sanctuary.md#later-a-visits-length) |
| Cast ledger | [Avatar menu](../../v2/docs/card-table/avatar-menu.md#later-the-cast-ledger) |
| Found portrait variants | [Small worlds](small-worlds-alternates-specials.md#later-found-variants) |
| Collector, property, other worlds' items | [Recipes](../../v2/docs/card-table/recipes-and-item-economy.md#10-later-collectors-property-and-other-worlds) |
| What we avoid | [Product](../../PRD.md#what-we-avoid) |

The rest have no owner yet.

## Festivals and a pack calendar

Later idea (pack data, after an engine calendar condition). The owner cut
clock-driven production and seasons for now; this waits for them.

A pack would carry a calendar of named days on the world clock. A festival is
residents gathering at one place on a set day: for that day each named
resident's want points there, and a place's `makes` table may change. A
festival always recurs. A missed festival comes round again and costs
nothing.

## XP within a span

Later idea (UI only: a journal read view). A ranking that counts only the XP
earned between two points on the calendar, read from want-met events. XP
itself never resets, and levels never change. Waits for the calendar above.

## Temperament matchups

Planning (pack data plus a small engine change to the willingness tests).
A resident's temperament could tilt how a refusal turns: a proud resident
yields more to flattery in Talk, a timid one to a threat, a stubborn one to a
gift. The pack names the temperament; the rules read it as a modifier on the
existing grievance and favour tests and the refusal codes. No new verb.
Witnessed reputation, built separately as an engine change, feeds the same
tests.

## Stance cue

Planning (presentation only). A resident's card shows how it feels about you
now (warm, wary, cross), drawn from its current favours and grievances toward
your avatar. It shows the present, not a history, and changes no rule.
