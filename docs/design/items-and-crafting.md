# Items and crafting

Owner decisions, 2026-11-04 (issue
[#2284](https://github.com/cenetex/cosyworld/issues/2284)). Built in rules 102;
see [rules 102](rules-102-eat-and-the-theban-decree.md) for the engine change
and the [Greek redesign](../../v2/docs/card-table/greek-redesign.md#the-theban-gate-greek-revision-20)
for the Theban data.

## The model

1. **Items are unique.** There is one of each thing, never a copy or a stack.
   A world holds the same records from its first turn to its last.
2. **A consumed thing goes home.** Eating, drinking or making something out
   of a thing takes it from whoever had it and puts it back at its `home`,
   at once, with no history, ready to fetch again. There is no dawn refill:
   the water jar is back at the well the moment Dione uses it. A thing a
   pack choice uses up goes home the same way: the burial's funeral cloth
   and oil are back at Eleusis and Colonus after the rite, or where they
   started while their home is not yet in the world. The libation wine
   does not regrow at dawn either.
3. **Crafting is a locked thing and its unlock quest.** A made thing has
   `locked: { by, consumes }`. Consumed, it goes home **locked**: the hand
   shows it there as the carved box with the iron keyhole, and the context
   button names its quest, "Dione the Baker consumes the Water Jar and the
   Sack of Wheat". It unlocks on a play: the one that gives the maker, or
   lays down at its home, the last thing it consumes, with every one in the
   maker's hands or lying loose there and the maker at home. Those are
   consumed (each goes to its own home) and the made thing unlocks where it
   waits. A thing in the player's own hands does not count. Nothing is
   spawned and there are no other recipes. (Unlock on a play rather than
   automatically: pending the owner, and easy to reverse.)
4. **Start with X, homed elsewhere.** A thing's starting holder and its home
   may differ. That seeds a loop: the first round is easy, every later round
   needs a trip. Dione starts holding the wheat, but its home is Piraeus.
5. **Eat** is one fixed verb with two labels. A thing tagged `food` reads
   **Eat**, one tagged `drink` reads **Drink**. Raised alone it is eaten
   alone; paired with a person here, as Give pairs, it is shared with them.
   A companion shares only as it consents to other social plays: awake, out
   of any fight, at peace, with no grudge, and either trusting the host or
   wanting that very meal. A refusal moves nothing and is voiced like a
   refused Give.
6. **Eat quests.** A want step `{ verb: "eat", with?, at? }` asks for any mix
   of the thing, a companion and a place: "eat the Courtyard Bread", "eat
   the provisions at Piraeus Quays", "drink the Wine Skin with Pip aboard the
   Charybdis". It is met only by that play, and a companion's own "with"
   quest is met by the same meal. A resident holding a thing its quest wants
   eaten eats it at once.
7. **Live, never latched.** A way a thing opens is a live condition. A
   route is a whole path between regions, not one gate edge. A gate is
   barred both ways. Only a voyage is directional: **outbound gated, return
   free.** The Charybdis needs the provisions aboard to sail from the
   harbour to Piraeus, and sails home with or without them, so eating them
   at Piraeus strands nobody.
8. **Combat is the pressure valve.** A thing can be eaten at the wrong
   moment and its makings be far away. A guard beaten in a standoff leaves
   his post a while (rules 100), so a locked gate is never a dead end.
9. **Absent travellers do not hold the loop.** Every thing of these loops is
   `absentReturn`: in a shared world, at dawn, it goes home from the hands of
   a traveller who is away.
10. **No match-3.**

## Worked example 1: the guard's bread

The Gate Guard guards the road to the battlefield: its card is locked and
reads "The Gate Guard is guarding this card". Talk with him: he wants to eat
Dione's bread. The bread starts locked at the Theban Courtyard. Return the
water jar to Dione's table: she holds her wheat, so she bakes, the jar goes
back to the well and the wheat home to Piraeus. Trade the bread to the guard
for the Burial Decree he holds; he eats it, and the bread goes home locked.
He still guards. Creon holds his writ and wants the decree back, so the
decree buys the writ. Give the guard the writ and he stands aside; if it
ever leaves him, he guards again.

## Worked example 2: the Charybdis's provisions

Myrto's crew will not sail without bread, figs and wine. Talk with her: she
wants to eat the provisions at Piraeus, and you take that quest. The Travel
Provisions wait locked at the Wine-Dark Harbor; Myrto makes them from the
three, given to her or laid down on the quay. The figs go home to the
sanctuary, the wine skin to the gate, and the bread home locked. Take the
provisions aboard and lay them down on deck, and the Charybdis sails to
Piraeus. Carried aboard they are not enough: Piraeus shows as a locked card,
and its context button reads "Put the Travel Provisions down on deck"
(the lane's `reason`). Sailing uses nothing:
the provisions stay aboard until someone eats them, by choice or for a
quest, and then go home locked to the harbour.

## Two routes, one bread

The guard (land) and the Charybdis (sea) each open a way toward Piraeus, and
both need the one bread. It can only be in one place at a time. The first bread opens one of them. To open the
second, go to Piraeus, bring the wheat back to Dione, fetch the water jar
from the well and bake a second bread. This is why things are unique and
go home: the world has one loaf, so a choice made with it shows, and the
loop asks for a journey rather than a wait.

The sea route reaches Piraeus directly. The land route reaches it only
through the rest of the Theban and Athenian story: the battlefield, the
Cithaeron road (after the burial), the Sacred Way (after the mothers'
petition) and the Long Walls (after the herald's truce). The draft keeps that
map; shortening it is an owner question. If the first bread is eaten and
the wheat is at Piraeus, the guard can be fought (the pressure valve), and
the sea home is always free.
