# Card actions

Tap a card to select it. Tap it again to lower it. Select up to two cards,
then press a named button in the row below the hand. Each accepted play
advances the world by one turn. Selection is free.

Items sit behind their holder. Select the person to reveal their items
immediately after their card. Revealed items stay open while making a pair.
A play, Escape, or a tap on the scene folds them back. Loose items appear
after the people. A cloth covering an item follows that item within its
holder's group. Transfers move the cards into the new holder's group.

| Selection                                 | Available plays                              |
| ----------------------------------------- | -------------------------------------------- |
| Person                                    | Talk; story choices fire from it             |
| Vale                                      | Wait; Brace during a standoff                |
| Vale + person                             | Threaten; Brace and Strike during a standoff |
| Loose item                                | Take                                         |
| Someone's item                            | Ask the named owner for it                   |
| Carried lamp or bell                      | Light, Put out, or Ring                      |
| Vale + item                               | The item's single-card play                  |
| Food or drink you hold                    | Eat or Drink, alone or with someone here     |
| Your item with its verb                   | Use (the verb on its card)                   |
| Destination, or Vale + destination        | Travel or Board                              |
| Destination with a ship's course card     | Set course                                   |
| Quest card (see below)                    | Take, Accept or Take level up quest          |
| Your quest card                           | Discard, with the XP cost in its label       |
| Current place                             | Wait and local actions                       |
| Person + destination                      | Invite that person along; your companion just Travels with you; a resident who cannot says why |
| Own item + person                         | Give to that person                          |
| Their item + person                       | Ask them for it                              |
| Own item + their item                     | Trade the named items                        |
| Cloth + lamp or bell                      | Cover or Uncover                             |
| Carried item + current place              | Put down                                     |
| Carried item + destination                | Carry there                                  |
| Lamp or bell resting here + current place | Light, Put out, or Ring in place             |

Oil and the lamp have no pair play. When one avatar holds both while the lamp
is empty, the flask fills the lamp to twelve and returns full to the station.

The world rules decide which plays are available. Give is offered whenever
the person here has room for the item, and Trade whenever both sides have room.
The other side's answer is the outcome: a refused offer still takes the turn,
nothing changes hands, and they say why. Invitations can be accepted or
declined. Threats name the item chosen by the world rules.
Story choices use supplies already in the inventory.

Every avatar holds at most one quest. A quest is an item to hold, a place to
reach or a person to talk with, and meeting it earns one experience on the
play that meets it, with nothing to claim. Your one quest is one card; choosing
it gives one button, its next step or, when it has none, Discard. Discard sets
yours down; a level quest costs experience.
The residents use these same plays for their own quests, so they also ask,
trade, threaten and get refused. Talk is how you learn what someone is after.
See [one want per avatar](README.md#one-want-per-avatar).

Quest cards (rules 133). When a shut box, someone you have talked with, your
own home's door, or your own experience offers a quest, it lies in the hand
as a card of its own. Select it and the one button takes the quest, with no
turn spent: Take quest on a locked box and on your home's door, Accept quest
on a resident who told you their want and offers it (after Talk, by a chance
rolled once per visit; certain if they trust you), Take level up quest when
your experience reaches the next level. You are never given a quest by draw
or push. While you hold one, the card's button is disabled and its label is
the reason ("Finish or discard your quest first"). The level-up quest is
Sleep at home: a long rest at your own home (Vale's is the Mirror attic)
raises your level and pays no experience. Discarding it costs the experience
that leaves you just under the threshold, so its card does not come back at
once. Discarding any other quest is free. The rules enumerate the offers
(`questOffers`, `world/offers.mjs`) and the `take` play has an `offer` id.
The table draws every offer as a quest card in the hand's row, after the
place's cards; selecting one replaces any other choice and shows exactly one
button (the play's label, or the disabled reason). The card you hold lies
behind your avatar's stack and offers its next step or Discard.

Pairs work in either order. Arrow keys move between visible cards. Enter
and Space toggle selection. Tab from a selected card reaches its action
row. Shift+Tab from the first action returns to the last selected card.
