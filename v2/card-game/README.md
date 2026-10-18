# Card world text and memory

Every avatar, item, and location has a profile in `entity-profiles.json` and a saved memory in the browser world. A memory holds the latest 16 witnessed events and the latest generated text. Card plays record events for the actors and objects present, the item used, and both places during travel. Generated speech and descriptions are marked as expressions, so the next prompt can distinguish them from game events.

After a card play, the browser sends the current local entities, their facts, avatar target hands, and eight recent memories to `POST /card-game/text`. The Rust service adds the shared profiles and calls the configured world-content model through the existing AI gateway. One request covers the scene. It returns one text for each local entity. Raising a card shows that entity's latest text. The place, played item, and chosen speakers also receive scene beats.

The card rules still commit movement, trades, quest progress and inventory. The text response updates memories and scene lines. Revision checks discard old replies. Fast plays share one active request and queue the latest scene. A failed request leaves cards playable; the next play tries again. A new game or a save update from another tab cancels the old request.

Schema 4 saves include entity memories. Schemas 1 through 3 migrate using their recorded history. Scene exports include entity memories and generated beats.

## Local play

Run the Rust server with `COSYWORLD_PRIMARY_GAME=cards` and the normal AI provider configuration. It serves both the game and the text route. For the lightweight card server, set `COSYWORLD_CARD_TEXT_ORIGIN` to the Rust server's origin before running `npm run play:cards`. Provider credentials stay in the Rust service.

The endpoint accepts at most 64 KiB, fixed entity IDs, eight local entities, and bounded facts and memories. It allows two model requests at once, 30 requests per peer per minute, and 1,200 requests per process per hour. Same-site browser requests pass the origin check. Model calls have a 25-second deadline. Responses contain validated text and the resolved model name.
