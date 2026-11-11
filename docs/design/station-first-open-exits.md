# Station exits: first open, maximum three

- The owner clarified on 2026-11-08: at most three active exits, including permanent Black Pond. The first two other eligible ways stay until they close; later ways wait hidden.
- Simultaneous openings use authored order. Closed and reopened ways join the back of the saved queue.
- Train/home doors need their belonging nearby; BoardyAI also needs two humans present. Radio needs its physically present key carrier until its permanent entrance is earned; earned flags and item progress stay.
- Saved stationExitOrder includes waiters. Reads never mutate it. Creation, accepted plays, upgrades and journaled presence settle it; GET/view never does.
- Older saves initialize their currently eligible ways in authored order because no earlier admission history exists. Possessions and progress remain unchanged.
- Boardy revision4 restores the Station doorway and its safe return. Revision3 translates only learned Attic–Parlour edges; revision2 keeps Station knowledge. Positions, belongings, discovery, progress and history stay. A revision3 guest who left the opening through the Attic door keeps that departure in opening.leftHome; no encounter is invented.
- Rules126 settles journaled presence with the same recorded events during replay. Rules1–125 and their recorded content retain their original behavior and immutable bytes.
