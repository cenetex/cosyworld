import { createWorld, legalActions, play } from "../../v2/card-game/world.mjs";

export const HELEN = "greek-helen-accounts";
export const act = (w, kind, test = () => true) => {
  const action = legalActions(w, "vale").find((a) => a.kind === kind && !a.sleep && test(a));
  if (!action) throw new Error(`vale cannot ${kind}`);
  return play(w, action).state;
};
export const wait = (w) => act(w, "wait");
export const greek = (place = "greek-harbor") => {
  const w = createWorld({ packScopes: { "greek-drama": "full" } });
  w.crossings["pond-greek-harbor"].discovered = true;
  w.actors.vale.place = place;
  return w;
};
export const committed = (value) => {
  const w = wait(greek());
  w.packs["greek-drama"].choices["greek-helen-account"] = value;
  w.packs["greek-drama"].receipts[`greek-helen-${value}`] = w.turn;
  return wait(w);
};
export const witnessed = (value) => {
  const [at, subject] =
    value === "egypt" ? ["greek-harbor", "greek-shipmaster"] : ["greek-well", "greek-elder"];
  const w = greek(at);
  w.items[HELEN].holder = "vale";
  const after = act(w, "give", (a) => a.item === HELEN && a.target === subject);
  after.actors.vale.place = "greek-harbor";
  return wait(after);
};
