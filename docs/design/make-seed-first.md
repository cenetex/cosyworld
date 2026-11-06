# Start a world from a seed

Owner request, 2026-11-06. This updates the first minute of
[world authoring](world-authoring-play.md). A fresh `/make` opens the seed
writing field. The existing Create card and context action draw a location,
an avatar and an item. Their text forms a small world. A starting quest asks
the avatar to find the item at that location.

The existing World, Avatars, Items and Locations stacks hold the result.
Each stack offers an Uncover card. Each generated card offers Regenerate
and Discard through its local cards and the single context action.
Advanced fields remain under Tools. Saved drafts reopen their saved cards.

## Generation and edits

- Generate the first three descriptions together so their purpose agrees.
- Build IDs, placement, links and quest rules in code from checked text.
- Keep each new location linked to an existing location.
- Keep an entity's ID and relationships when its text is regenerated.
- Derive quest captions from current names. Discarding a quest removes its
  authored `want`. Each avatar has one starting quest in the current model.
- Discard is one undoable edit. Dependent generated quests follow that edit.
  A place with contents or links needs those relationships moved first.
- Persist the accepted text and relations through the current draft store.
  The seed stays in memory, following the current generation policy. After
  reload, kept card text supplies context for further draws.
- A model request has one explicit user action and one provider attempt.
  Existing sign-in, origin checks and generation limits apply.

The seed is a starting idea. Saved outputs make reloads exact. Any future
table draws use separate type, slot and revision inputs so one reroll leaves
the other cards stable.

## Research

[Small Tables](https://www.bastionland.com/2018/06/small-tables.html) uses a
small set of common and unusual encounters to give a place a clear identity.
[Cairn Bonds and Omens](https://cairnrpg.com/second-edition/wardens-guide/bonds-and-omens/)
connect an item, a person and an action. Apply these ideas as a useful object,
one vivid detail and a clear need.

[The Theory of the Place](https://www.ludomotion.com/blogs/the-place/) connects
a site, its surroundings and inhabitants. Each further draw should extend
one kept card. [Repeatable Random Numbers](https://blog.runevision.com/2015/01/primer-on-repeatable-random-numbers.html)
supports independent random streams for later table generation.

[Storylets](https://emshort.blog/2019/11/29/storylets-you-want-them/) describes
small pieces of content with prerequisites and effects. The first quest uses
the existing item want; place and person wants become available as the world
grows. The maker derives these goals from reachable, available world facts.

## Work in flight

At review, #2414 supplies seed-to-avatar controls, #2400 supplies avatar idea
mode, #2413 supplies accepted item/location edits, and #2412 supplies private
Create recovery. This flow uses a separate bounded text endpoint and the
existing local source edit and save contracts. Private publication keeps its
own Create and receipt flow.

## Proof

Check fresh entry, all three draws, single-card regeneration, discard, Undo,
further reveals and exact reload at desktop and phone widths. Check stale
responses, failed saves and sign-in recovery. Verify each quest target and
each location link. Check server authentication, origin, bounds and provider
failure. Retain a small example seed and the observed output.
