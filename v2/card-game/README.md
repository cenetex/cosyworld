# Card world text and memory

Every avatar, item, and location has a profile in `entity-profiles.json` and a saved memory in the browser world. A memory holds the latest 16 witnessed events and the latest generated text. Card plays record events for the actors and objects present, the item used, and both places during travel. Generated speech and descriptions are marked as expressions, so the next prompt can distinguish them from game events.

After a card play, the browser sends the current local entities, their facts, avatar target hands, and eight recent memories to `POST /card-game/text`. The Rust service adds the shared profiles and calls the configured world-content model through the existing AI gateway. One request covers the scene. It requests JSON-object output and validates one entry for each local entity. It returns one text for each local entity. Raising a card shows that entity's latest text. The place, played item, and chosen speakers also receive scene beats. Vale speaks first, followed by the local partner. The prompt includes the completed card play so their lines form a question and answer or a shared reaction.

The conversation shows generated text, with the prior spoken line and speaker portrait above the current line. The browser buffers each exchange until it passes validation, then reveals complete letters on a local clock with short pauses at punctuation. Vale speaks first. Tap the text to finish a line, then tap again to hear the partner. A blinking cursor marks the end. Earlier lines and card memories can be replayed. Each speaker has a soft, pitched voice sound; the menu toggles it. Reduced motion shows full lines at once. Hidden tabs and open menus pause playback. The browser saves complete text before playback begins. Fresh tables and older saves request an opening exchange. Action records remain in the saved world and scene export.

The card rules still commit movement, trades, quest progress and inventory. The text response updates memories and scene lines. Revision checks discard old replies. A new play cancels the active stream and requests the latest scene. A failed request leaves cards playable; the next play tries again. A new game or a save update from another tab cancels the old request.

Schema 4 saves include entity memories. Schemas 1 through 3 migrate using their recorded history. Scene exports include entity memories and generated beats.

## Local play

Run the Rust server with `COSYWORLD_PRIMARY_GAME=cards` and the normal AI provider configuration. It serves both the game and the text route. For the lightweight card server, set `COSYWORLD_CARD_TEXT_ORIGIN` to the Rust server's origin before running `npm run play:cards`. Provider credentials stay in the Rust service. `COSYWORLD_CARD_TEXT_MODEL` selects a registered world-content model for this card table. Both production sites use `openai/gpt-6-luna` with `COSYWORLD_CARD_TEXT_REASONING_EFFORT=none` for short scene text.

The endpoint accepts at most 64 KiB, fixed entity IDs, eight local entities, and bounded facts and memories. It allows two model requests at once, 30 requests per peer per minute, and 1,200 requests per process per hour. Same-site browser requests pass the origin check. Model calls have a 25-second deadline. Clients send `Accept: text/event-stream` for live text deltas followed by a validated `complete` event with all entries and the resolved model name. Other clients receive the full JSON response. Disconnects cancel the provider request and release its capacity.


## Threats and standoffs

Avatar cards offer Talk and Threaten. A threat opens a standoff between the two avatars and adds Guard and Attack to their cards. Each has four resolve. An attack removes two resolve between equal levels, three against a lower level, and one against a higher level. Guard softens the next hit by one, with a minimum of one damage, until that avatar's next play.

Talk and item trades stay available during a standoff. Travel ends it; releasing the disputed item settles it. At zero resolve, the losing avatar drops the disputed item (or an item the winner needs) and retreats along a normal path. Both avatars get three turns to recover before another threat. Quest programs still award levels.

The cast starts with a guard or a brave reply. It responds to attacks, and a challenger can press an item demand after two turns. In generated quest programs, two refused requests for an item both avatars need can lead to a threat. Every threat, guard, hit, release and retreat enters the witnesses' memories. Saves from earlier versions gain an empty standoff state.
