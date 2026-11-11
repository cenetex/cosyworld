import {
  createWorld,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import { newWant } from "../../v2/card-game/want.mjs";

// Pip demands the lamp from Vale at the station: an actual Ask, then Threaten,
// played on today's rules. The Rust shared-world test continues from here.
function act(s, kind) {
  const a = legalActions(s).find((a) => a.kind === kind && !a.sleep);
  const result = play(s, a);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
export function pressuredHandover() {
  const s = createWorld({ seed: 7 });
  s.actors.moth.place = "station";
  s.actors.keeper.place = "pond";
  s.items.lamp.holder = "vale";
  s.items.cloth.holder = "attic";
  s.actors.moth.want = { ...newWant("item", "lamp", 0), refusals: 1 };
  s.actors.keeper.want = null;
  delete s.actors.moth.metTurn;
  return act(act(s, "wait"), "wait");
}
