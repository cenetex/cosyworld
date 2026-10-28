import { legalActions, play, exits } from "../../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { knowsFact } from "../../v2/card-game/knowledge.mjs";
import { openingFixture } from "./greek-opening.mjs";

export const bookState = (world) => world.packs["greek-drama"];
export const bookAction = (world, kind, fields = {}, actor = "vale") =>
  legalActions(world, actor).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
export function bookAct(world, kind, fields = {}, actor = "vale") {
  const action = bookAction(world, kind, fields, actor);
  if (!action)
    throw Error(
      `Missing Book I action for ${actor} at ${world.actors[actor].place}: ${kind} ${JSON.stringify(fields)}`,
    );
  const result = play(world, action, world.revision);
  if (!result.ok) throw Error(result.error);
  return result.state;
}
export function bookPath(world, target, actor = "vale") {
  const start = world.actors[actor].place,
    queue = [[start]],
    seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === target) return path.slice(1);
    for (const next of exits(world, here, actor))
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
  }
  throw Error(`No Book I path from ${start} to ${target}`);
}
export const bookWalk = (world, target, actor = "vale") =>
  bookPath(world, target, actor).reduce(
    (w, next) => bookAct(w, "move", { target: next }, actor),
    world,
  );
export function bookLearn(world, speaker, topic, actor = "vale", trace) {
  for (let i = 0; i < 24 && !knowsFact(world, actor, topic); i++) {
    const action = bookAction(world, "talk", { target: speaker }, actor);
    if (!action) throw Error(`Missing Talk at ${speaker}`);
    const result = play(world, action, world.revision);
    if (!result.ok) throw Error(result.error);
    const context = narrativeContext(result.state, action);
    const speech = {
      revision: context.revision,
      model: "book-one-fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text:
          context.disclosures?.find((d) => d.speaker === id)?.text ||
          "I am listening to the account.",
      })),
    };
    world = applyGeneratedText(result.state, context, speech);
    trace?.push({
      action,
      context,
      speech,
      pending: result.state,
      state: world,
    });
  }
  if (!knowsFact(world, actor, topic))
    throw Error(`Talk did not teach ${topic}`);
  return world;
}
const starts = new Map();
export function bookStart(branch = "refusal") {
  if (!starts.has(branch)) {
    let w = openingFixture(branch).closed;
    w = bookAct(w, "drop", { item: "lamp", target: "greek-courtyard" });
    w = bookAct(w, "choose", {
      choiceId: `greek-book-one-invitation-${branch}`,
    });
    starts.set(branch, w);
  }
  return structuredClone(starts.get(branch));
}
export const bookEndings = {
  seven: ["two-name-vigil", "state-remembrance", "survivors-care"],
  phoenician: ["family-remembrance", "living-households"],
  tyrannus: ["public-care", "household-first", "attributed-witnesses"],
  bacchae: ["family-memorial", "local-gathering-agreement"],
};
export const bookAccounts = {
  seven: "shield-tablet",
  phoenician: "truce-copy",
  tyrannus: "account",
  bacchae: "petition-copy",
};

export function bookJourney(
  part,
  ending,
  {
    world = bookStart(),
    returnHome = true,
    reverseAgreement = false,
    reload = (w) => w,
  } = {},
) {
  const trace = [],
    before = {},
    after = {};
  const act = (kind, fields) => {
    const action = bookAction(world, kind, fields);
    if (fields.choiceId) before[fields.choiceId] = world;
    world = bookAct(world, kind, fields);
    trace.push({ action, state: world });
    world = reload(world);
    if (fields.choiceId) after[fields.choiceId] = world;
  };
  const walk = (short) => {
    for (const target of bookPath(world, `greek-${short}`))
      act("move", { target });
  };
  const take = (short) => act("take", { item: `greek-${part}-${short}` });
  const choose = (short) =>
    act("choose", { choiceId: `greek-${part}-${short}` });
  const learn = (speaker, topic) => {
    world = reload(
      bookLearn(
        world,
        `greek-${speaker}`,
        `greek-${part}-${topic}`,
        "vale",
        trace,
      ),
    );
  };
  if (part === "seven") {
    walk("well");
    take("shield-tablet");
    take("water-skin");
    walk("gate");
    learn("guard", "shields");
    choose("set-shield-record");
    learn("guard", "inner-road");
    walk("courtyard");
    choose("stock-shelter");
    take("household-cloth");
    walk("gate");
    learn("guard", "brothers");
    if (ending === "state-remembrance") walk("palace");
    if (ending === "survivors-care") walk("courtyard");
  } else if (part === "phoenician") {
    take("care-basket");
    walk("palace");
    learn("melea", "truce");
    take("truce-copy");
    walk("gate");
    choose("lodge-truce-copy");
    walk("palace");
    learn("melea", "menoeceus");
    choose("deliver-care");
    learn("melea", "mourning");
    take("memorial-cloth");
    walk(ending === "family-remembrance" ? "gate" : "courtyard");
  } else if (part === "tyrannus") {
    walk("well");
    take("care-basket");
    walk("palace");
    learn("melea", "inquiry");
    walk("courtyard");
    choose("deliver-care");
    walk("palace");
    learn("melea", "messenger");
    take("messenger-record");
    walk("cithaeron");
    learn("melitta", "herdsman");
    take("herdsman-record");
    walk("palace");
    choose("compare-records");
    learn("melea", "truth");
    take("account");
    if (ending === "household-first") {
      walk("gate");
      choose("read-family");
      take("account");
    }
    if (ending === "attributed-witnesses") {
      choose("melea-approves");
      take("account");
      walk("cithaeron");
      choose("melitta-approves");
      take("account");
    }
    walk("well");
  } else if (part === "bacchae") {
    walk("cithaeron");
    learn("melitta", "worshippers");
    take("petition-copy");
    walk("well");
    choose("deliver-account");
    walk("cithaeron");
    learn("melitta", "robe");
    walk("palace");
    take("robe");
    walk("cithaeron");
    choose("return-robe");
    learn("melitta", "grief");
    if (ending === "family-memorial") {
      walk("courtyard");
      take("memorial-cloth");
      walk("cithaeron");
    } else {
      take("terms");
      for (const keeper of reverseAgreement
        ? ["melitta", "elder"]
        : ["elder", "melitta"]) {
        walk(keeper === "elder" ? "well" : "cithaeron");
        choose(`${keeper}-accepts`);
        take("terms");
      }
      walk("cithaeron");
    }
  }
  choose(ending);
  if (returnHome) {
    const speaker =
      part === "seven"
        ? {
            "two-name-vigil": "guard",
            "state-remembrance": "creon",
            "survivors-care": "baker",
          }[ending]
        : part === "phoenician"
          ? ending === "family-remembrance"
            ? "guard"
            : "baker"
          : part === "tyrannus"
            ? "elder"
            : "melitta";
    learn(speaker, `account-${ending}`);
    const item = `greek-${part}-${bookAccounts[part]}`;
    walk(world.items[item].holder.replace("greek-", ""));
    take(bookAccounts[part]);
    walk("courtyard");
    choose(`return-${ending}`);
  }
  return { world, before, after, trace };
}
