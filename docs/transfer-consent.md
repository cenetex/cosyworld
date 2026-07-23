# Avatar transfer consent

Avatar mechanics do not depend on an NPC-versus-human distinction. The controller behind an
avatar determines who may supply a decision:

- An inference-controlled recipient may accept or refuse a gift or trade using its authored
  preference model.
- A direct-input recipient receives a durable pending offer. Inventory does not change until that
  recipient explicitly accepts.
- The proposer may withdraw a pending offer. Only the recipient may accept or decline it.
- Acceptance rechecks presence, location, item ownership, carrying capacity, and blocks while
  holding the world commit lock. Repeated acceptance is idempotent; competing stale offers cannot
  move the same item twice.

Pending offers expire after 24 world ticks. Offer status and per-avatar mute/block state are stored
in snapshots and action journals so replay cannot bypass authorization.

## Safety controls

Every visible avatar inspector exposes gift, trade, mute, block, and report controls. Incoming
offers expose accept and decline; outgoing offers expose withdraw.

Mute is local to the controlling avatar and filters that avatar's room transcript. Block is
bidirectional for authorization: it invalidates pending transfers between the pair and prevents
new transfers and targeted social actions. Declines, withdrawals, mute changes, and block changes
are returned only to the acting client rather than broadcast as public room events. Reports remain
available even when an avatar is blocked.

The same operations are available to text clients:

```text
offers
accept <offer-id>
decline <offer-id>
withdraw <offer-id>
mute <avatar>
unmute <avatar>
block <avatar>
unblock <avatar>
```
