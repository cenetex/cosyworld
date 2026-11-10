# Quiet hand changes before the opening's first words

A successful local hand choice can change the lamp's light and the world's
revision while the first narration request is pending. Only an opening with
no published dialogue refreshes that active request. The existing narrator
cancels its transport, advances its ticket and builds the latest context;
revision and turn checks still reject old responses. Rapid hand choices
coalesce, and reset/replacement invalidation still fences late output.

Completed or failed openings and shared worlds do not start a local request.
Ordinary pending scenes and partially published streaming scenes are not fixed
by this change. Restarting those generically could reinterpret already stored
words or memories; their continuation policy requires a separate decision.
The browser regression keeps the first request delayed, changes the real lamp
selection repeatedly, rejects stale replies and persists Awake exactly once.
