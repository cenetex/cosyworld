import { bookJourney } from "../helpers/greek-book-one.mjs";
import { encodeSave } from "../../v2/card-game/world.mjs";
import { dispatchShared } from "../../v2/card-game/shared-world.mjs";
import { knowsFact } from "../../v2/card-game/knowledge.mjs";

// A source-model journey supplies the seed. Every later command is replayed
// by the native host and compared with this independently computed result.
export function bookReplay(part) {
  const commands = [],
    claimed = part === "seven" ? ["vale", "mara"] : ["vale"];
  let world, trace;
  if (part === "seven")
    world = bookJourney(part, "two-name-vigil", { returnHome: false }).world;
  else {
    const ending =
      part === "tyrannus"
        ? "attributed-witnesses"
        : "local-gathering-agreement";
    const journey = bookJourney(part, ending);
    const choice =
      part === "tyrannus"
        ? "greek-tyrannus-compare-records"
        : "greek-bacchae-return-robe";
    world = journey.after[choice];
    trace = journey.trace.slice(
      journey.trace.findIndex((t) => t.action.choiceId === choice) + 1,
    );
  }
  world = dispatchShared({ op: "create", save: encodeSave(world) }).world;
  if (part === "seven") world.actors.mara.place = "greek-gate";
  const save = encodeSave(world);
  const request = (command) => {
    const result = dispatchShared({
      ...command,
      world,
      claimed,
      present: claimed,
    });
    if (!result.ok) throw Error(result.error);
    world = result.world;
    commands.push(command);
    return result;
  };
  const speech = (actor, context) =>
    request({
      op: "speech",
      actor,
      room: world.actors[actor].place,
      disclosures: context.disclosures,
      lines: [
        { actorId: actor, text: "I am listening to the account." },
        ...context.disclosures.map((d) => ({
          actorId: d.speaker,
          text: d.text,
        })),
      ],
    });
  const act = (actor, fields) => {
    const view = dispatchShared({
      op: "view",
      world,
      actor,
      claimed,
      present: claimed,
    });
    const action = view.actions.find((a) =>
      Object.entries(fields).every(([k, v]) => a[k] === v),
    );
    if (!action) throw Error(`Missing replay action ${JSON.stringify(fields)}`);
    return request({ op: "play", actor, action });
  };
  if (part === "seven") {
    act("mara", { kind: "take", item: "greek-seven-shield-tablet" });
    for (
      let i = 0;
      i < 24 && !knowsFact(world, "mara", "greek-seven-account-two-name-vigil");
      i++
    )
      speech(
        "mara",
        act("mara", { kind: "talk", target: "greek-guard" }).context,
      );
    act("mara", { kind: "move", target: "greek-courtyard" });
    act("mara", {
      kind: "choose",
      choiceId: "greek-seven-return-two-name-vigil",
    });
  } else
    for (const step of trace) {
      const result = request({
        op: "play",
        actor: "vale",
        action: step.action,
      });
      if (step.context) speech("vale", result.context);
    }
  return { save, commands, expected: world, claimed };
}
