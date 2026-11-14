# Keep existing Open Door saves readable

Greek content revision 25 replaces the Open Door's active story choices with
item locks and wants. Saves from revision 24 can already contain those choices,
their flags, learned topics, earned verses and residents away from home.

Keep the old choice IDs as archived records. They retain only their historical
flag and choice effects, remain valid for saved receipts and cannot be played.
Keep their earned recital records and words. Removed items use the existing
custody and quest cleanup. The existing content reconciliation updates topics
and returns newly locked, unmet residents to their authored places.
It clears a held-item selection only when that item was removed, and drops
an old journey record only for a reworked pack's resident whose journey ended.

Rules 138 finishes that reconciliation by advancing a valid older pack revision
afterwards. Invalid, current and future revision values are not migrated.
All earlier released rule bundles remain unchanged. No saved world is retired.

Regression coverage plays revision 24 content and checks local reload, shared
upgrade, repeated reload, old receipts, knowledge, removed items and residents.
