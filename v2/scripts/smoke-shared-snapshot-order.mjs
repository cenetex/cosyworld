import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave, addLog } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { questCards } from "../card-game/quest-cards.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
async function checkPlayRecovery(width, scenario) {
  let world = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  const history = [],
    keys = [],
    errors = [];
  let releasePolls = false,
    pollFailed = false,
    failAfterRetry = false;
  const unaccepted = scenario.startsWith("unaccepted");
  const otherNotice = "Mara would like your attention.";
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route(
    /\/card-game\/shared\/worlds\/recovery(?:\/command)?$/,
    async (route) => {
      const body = route.request().postDataJSON();
      if (body?.op === "play") {
        keys.push(body.key);
        if (
          scenario === "validation" ||
          (scenario === "unaccepted-retry-validation" && keys.length > 1)
        )
          return route.fulfill({
            status: 409,
            json: { error: "Choose a current play." },
          });
        {
          const firstUnaccepted = unaccepted && keys.length === 1;
          const actor = firstUnaccepted ? "mara" : "vale";
          const action = firstUnaccepted
            ? dispatchShared({
                op: "view",
                world,
                actor,
                claimed: ["vale", "mara"],
                present: ["vale", "mara"],
              }).actions.find((a) => a.kind === "wait")
            : body.action;
          const played = dispatchShared({
            op: "play",
            world,
            actor,
            claimed: ["vale", "mara"],
            present: ["vale", "mara"],
            action,
          });
          assert(played.ok);
          world = played.world;
          if (!firstUnaccepted)
            history.push({ play: body.key, room: "station", lines: [] });
        }
        if (!scenario.startsWith("unaccepted-retry") || keys.length === 1)
          return route.abort("failed");
      }
      if (
        releasePolls &&
        (scenario.endsWith("poll-error") || failAfterRetry) &&
        !pollFailed
      ) {
        pollFailed = true;
        return route.abort("failed");
      }
      const view = dispatchShared({
        op: "view",
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
      });
      await route.fulfill({
        json: {
          ...view,
          id: "recovery",
          version: "full-card-world/9",
          claimed: [1, 0, 0, 0, 0, 0, 0, 0],
          present: [1, 0, 0, 0, 0, 0, 0, 0],
          now: Date.now(),
          queue:
            releasePolls && scenario === "queued"
              ? [{ id: keys[0], actor: "vale", status: "playing" }]
              : [],
          history: releasePolls && scenario !== "queued" ? history : [],
          notice:
            releasePolls && scenario === "new-notice" ? otherNotice : null,
        },
      });
    },
  );
  try {
    await page.goto(`${origin}/?world=recovery`);
    await page.waitForFunction(() => document.body.inert === false);
    await selectCard(page, "vale");
    await page.locator('#card-actions [data-action="wait"]').click();
    const expected =
      scenario === "validation"
        ? "Choose a current play."
        : "The connection paused. Check the table, then try again.";
    await page.waitForFunction(
      (text) => document.querySelector("#notice").textContent === text,
      expected,
    );
    releasePolls = true;
    if (["accepted", "accepted-poll-error", "queued"].includes(scenario))
      await page.waitForFunction(
        () => document.querySelector("#notice").hidden,
      );
    else if (scenario === "new-notice")
      await page.waitForFunction(
        (text) => document.querySelector("#notice").textContent === text,
        otherNotice,
      );
    await page.waitForTimeout(2200);
    if (scenario.endsWith("poll-error")) assert(pollFailed);
    assert.equal(
      keys.length,
      1,
      "Polling preserves the single submitted play.",
    );
    assert.equal(world.turn, scenario === "validation" ? 0 : 1);
    if (unaccepted || scenario === "validation")
      assert.equal(await page.locator("#notice").textContent(), expected);
    if (scenario === "new-notice")
      assert.equal(await page.locator("#notice").textContent(), otherNotice);
    if (scenario.startsWith("unaccepted-retry")) {
      const validation = scenario.endsWith("validation");
      await page.locator('#card-actions [data-action="wait"]').click();
      await page.waitForFunction(
        (validation) =>
          validation
            ? document.querySelector("#notice").textContent ===
              "Choose a current play."
            : document.querySelector("#notice").hidden,
        validation,
      );
      failAfterRetry = true;
      await page.waitForTimeout(2200);
      assert(pollFailed);
      if (validation)
        assert.equal(
          await page.locator("#notice").textContent(),
          "Choose a current play.",
        );
      else
        assert(
          await page.locator("#notice").evaluate((element) => element.hidden),
          "A successful new play retires its earlier retry cue.",
        );
      assert.equal(keys.length, 2);
      assert.equal(world.turn, validation ? 1 : 2);
    }
    assert.deepEqual(errors, []);
    console.log(`Shared play recovery ${scenario} passed at ${width}px.`);
  } finally {
    await page.close();
  }
}
async function checkQueuedReveal(width) {
  const page = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "no-preference",
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const world = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  const actors = ["vale", "mara", "ash", "nell"];
  for (const actor of actors) world.actors[actor].place = "pond";
  world.actors.keeper.place = "attic";
  world.actors.moth.place = "station";
  const line = (actor, text) => {
    addLog(world, actor[0].toUpperCase() + actor.slice(1), text, {
      actorId: actor,
      entityId: actor,
      locationId: "pond",
      kind: "dialogue",
      generated: true,
      cast: actors,
    });
    world.revision++;
    return structuredClone(world.log.at(-1));
  };
  const old = line("nell", "Our earlier conversation has ended.");
  const oldScene = {
    actor: "nell",
    play: "old",
    room: "pond",
    starts_at: Date.now() - 30000,
    lines: [old],
  };
  let value = {
    world: structuredClone(world),
    actor: "vale",
    actions: [],
    claimed: [1, 1, 1, 1, 0, 0, 0, 0],
    present: [1, 1, 1, 1, 0, 0, 0, 0],
    queue: [],
    history: [oldScene],
    now: Date.now(),
  };
  const seen = Object.keys(profiles);
  const quests = Object.keys(world.actors).flatMap((id) =>
    questCards(world, id).map((quest) => quest.key),
  );
  await page.addInitScript(
    ({ seen, quests }) => {
      const key = "cosyworld.reflected-shore.v1.shared.queued-reveal.vale";
      localStorage.setItem(key + ".seen", JSON.stringify(seen));
      localStorage.setItem(
        key + ".quests",
        JSON.stringify({ seen: quests, read: quests }),
      );
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
      window.queuedReveals = [];
      window.addEventListener("DOMContentLoaded", () => {
        const text = document.getElementById("dialogue-text");
        new MutationObserver(() => {
          const total = text.querySelectorAll(".speech-letter").length;
          const shown = text.querySelectorAll(".speech-letter.revealed").length;
          if (shown > 0 && shown < total)
            window.queuedReveals.push({
              text: text.textContent,
              speaker: document.getElementById("speaker").textContent.trim(),
              shown,
            });
        }).observe(text, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });
    },
    { seen, quests },
  );
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route("**/card-game/shared/worlds/queued-reveal**", (route) =>
    route.fulfill({ json: value }),
  );
  const publish = async () => {
    value = { ...value, world: structuredClone(world), now: Date.now() };
    await page.waitForFunction(
      (revision) =>
        document.getElementById("stage").dataset.presentedRevision ===
        String(revision),
      world.revision,
    );
  };
  const expectLetters = (speaker, text) =>
    page.waitForFunction(
      ({ speaker, text }) =>
        new Set(
          window.queuedReveals
            .filter(
              (sample) => sample.speaker === speaker && sample.text === text,
            )
            .map((sample) => sample.shown),
        ).size >= 2,
      { speaker, text },
    );
  const expectPortrait = (actor) =>
    page.waitForFunction((actor) => {
      const box = document.getElementById("speaker-portrait");
      const image = box.querySelector("img");
      return (
        box.dataset.entity === actor &&
        image?.complete &&
        image.naturalWidth > 0
      );
    }, actor);
  try {
    await page.goto(`${origin}/?world=queued-reveal`);
    await page.waitForFunction(() => document.body.inert === false);
    await page.waitForFunction(
      () =>
        document.getElementById("dialogue-advance").dataset.revealing ===
        "false",
    );
    world.turn++;
    world.revision++;
    value.queue = [{ id: "vale", actor: "vale", status: "working" }];
    await publish();
    assert.equal(await page.locator("#dialogue-text").textContent(), "");
    const valeText = "Vale's accepted reply reaches the room.";
    const vale = line("vale", valeText);
    const valeScene = {
      actor: "vale",
      play: "vale",
      room: "pond",
      starts_at: Date.now() - 1000,
      lines: [vale],
    };
    world.turn++;
    world.revision++;
    value.history = [valeScene, oldScene];
    value.queue = [{ id: "mara", actor: "mara", status: "working" }];
    await publish();
    await expectLetters("Vale", valeText);
    assert.equal(await page.locator("#speaker").innerText(), "Vale");
    await expectPortrait("vale");
    const output = new URL("../../output/shared-cards/", import.meta.url);
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: new URL(`delayed-vale-${width}.png`, output).pathname,
    });
    await page.waitForFunction(
      () =>
        document.getElementById("dialogue-text").textContent === "" &&
        document.getElementById("story-status").hidden === false,
    );
    assert.equal(await page.locator("#speaker").innerText(), "Mara");
    await expectPortrait("mara");
    await page.screenshot({
      path: new URL(`delayed-waiting-${width}.png`, output).pathname,
    });
    const maraText = "Mara's accepted reply follows Vale's.";
    const mara = line("mara", maraText);
    value.history = [
      {
        actor: "mara",
        play: "mara",
        room: "pond",
        starts_at: Date.now(),
        lines: [mara],
      },
      valeScene,
      oldScene,
    ];
    value.queue = [];
    await publish();
    await expectLetters("Mara", maraText);
    assert.equal(await page.locator("#speaker").innerText(), "Mara");
    await expectPortrait("mara");
    const order = await page.evaluate(() => [
      ...new Set(
        window.queuedReveals
          .filter((sample) => ["Vale", "Mara"].includes(sample.speaker))
          .map((sample) => sample.speaker),
      ),
    ]);
    assert.deepEqual(order, ["Vale", "Mara"]);
    assert.deepEqual(errors, []);
    await writeFile(
      new URL(`delayed-dialogue-${width}.json`, output),
      JSON.stringify(
        {
          width,
          order,
          actualSpeaker: "Vale",
          nextWaitingSpeaker: "Mara",
          errors,
          partialLetters: await page.evaluate(() => window.queuedReveals),
        },
        null,
        2,
      ),
    );
    console.log(
      `Shared queued replies reveal in order while the next turn prepares at ${width}px.`,
    );
  } finally {
    await page.close();
  }
}

try {
  for (const width of [1440, 390]) await checkQueuedReveal(width);
  for (const width of [1440, 390]) {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(createWorld()),
    }).world;
    const view = () =>
      dispatchShared({
        op: "view",
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
      });
    const snapshot = () => ({
      ...view(),
      id: "ordering",
      version: "full-card-world/9",
      claimed: [1, 0, 0, 0, 0, 0, 0, 0],
      present: [1, 0, 0, 0, 0, 0, 0, 0],
      now: 1000,
      queue: [],
      history: [],
    });
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    let hold = false;
    let release;
    await page.route(
      /\/card-game\/shared\/worlds\/ordering(?:\/command)?$/,
      async (route) => {
        const body = route.request().postDataJSON();
        if (body?.op === "play") {
          const played = dispatchShared({
            op: "play",
            world,
            actor: "vale",
            claimed: ["vale"],
            present: ["vale"],
            action: body.action,
          });
          assert(played.ok);
          world = played.world;
        }
        if (!body && hold) {
          hold = false;
          const stale = snapshot();
          await new Promise((resolve) => {
            release = resolve;
          });
          await route.fulfill({ json: stale });
        } else await route.fulfill({ json: snapshot() });
      },
    );
    await page.goto(`${origin}/?world=ordering`);
    await page.waitForFunction(() => document.body.inert === false);
    await selectCard(page, "pond", { touch: width === 390 });
    hold = true;
    const holdDeadline = Date.now() + 15000;
    while (!release && Date.now() < holdDeadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert(release, "The next poll reaches the held response.");
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#backdrop").src.includes("pond"),
    );
    const revision = world.revision;
    assert.equal(world.actors.vale.place, "pond");
    release();
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator("#stage").getAttribute("data-presented-revision"),
      String(revision),
    );
    assert(
      (await page.locator("#backdrop").getAttribute("src")).includes("pond"),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Shared delayed poll keeps the accepted pond arrival at ${width}px.`,
    );
  }
  for (const width of [1440, 390])
    for (const scenario of [
      "accepted",
      "accepted-poll-error",
      "queued",
      "new-notice",
      "unaccepted",
      "unaccepted-poll-error",
      "unaccepted-retry",
      "unaccepted-retry-validation",
      "validation",
    ])
      await checkPlayRecovery(width, scenario);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
