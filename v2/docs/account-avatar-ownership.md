# Avatar ownership and passkey recovery

A CosyWorld account owns the avatars saved to it. Ownership is scoped to the
world and its epoch. Each avatar has one account owner. An account can retain
several avatars as its player completes tales.

`POST /auth/avatar` requires a valid account cookie. Supplying an avatar ID and
its live actor session saves that avatar to the account. The unique database
key protects the existing owner when claims arrive together. A repeated claim
by that owner succeeds.

The same endpoint recovers an owned avatar with a new actor session. An empty
request selects the most recently used avatar that the player can still
control. A stored rescue handoff carries recovery to its successor. Knockout
keeps recovery available. Terminal avatars and avatars released to resident
control stay in history; the player can begin a new tale. Suspension remains
an authority check on both the original avatar and a handoff target.

The browser saves an active avatar after passkey registration or sign-in and
after avatar creation. It recovers the saved avatar on a new device and on
reload. Registration requests a discoverable passkey so username-free sign-in
can find the account on that device. A storage error leaves the current
device's actor session available
for another save attempt. A historical avatar whose only session has already
expired needs an existing durable ownership proof for recovery.

Wallet links remain the ownership proof for external assets. Account recovery
and rescue use the passkey account and its durable avatar record. The creation
endpoint recovers an existing avatar for a signed-in account and saves newly
created avatars. Legacy wallet recovery remains available until an avatar is
saved to an account; its account then owns recovery. Development reset
clears avatar links with the world so reused IDs receive fresh ownership.

Router tests cover claims, conflicting owners, expired sessions, restart,
knockout, and released avatars. The browser gate runs an actual WebAuthn
registration and a sign-in from a second browser carrying only the synced
test passkey. Test credentials stay in memory during that run.
