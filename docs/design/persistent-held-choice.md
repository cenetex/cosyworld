# Persistent held choice

Custody and the selected prop are separate. `actor.heldItem` is authoritative:
null is explicitly stowed, while missing legacy values retain stable repair.
Receiving an item still takes the hand. Holding cannot move an item, choose
another person's property, or choose a covering nested under another object.

A quiet `hold` command journals an authenticated avatar's choice with the
expected world revision. It changes neither turn, residents, fuel nor dialogue.
Old released rules remain immutable; the coordinator assigns the next version
when this stage is integrated. Source-only work is not deployment-ready.

The browser must send this command only for deliberate taps on carried items.
Folding the hand, selecting targets, or cleanup must not send a stow command.
Shared state must be adopted before another gameplay action can depend on it.
An uncertain network response needs a fresh view, not a blind retry. A stale
revision cannot overwrite a newer hold or an intervening custody change.

Lamp lighting consumes this choice: fueled and held or put down is lit; fueled
but stowed is dark. Initial held state comes from custody settlement. Lamp and
quest owners add lighting and crossing synchronization at the quiet command.
