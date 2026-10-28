// Place in v2/scripts/smoke-card-book-two.mjs.
// Run from the repository: node v2/scripts/smoke-card-book-two.mjs
// Optional arguments: repository-root output-directory
// Needs the repository's installed Playwright and Chromium. Uses its public
// card server and legal UI actions. Dialogue text is a bounded fixture.
// All screenshots and reports go to the output directory.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(
  process.argv[2] || fileURLToPath(new URL("../../", import.meta.url)),
);
const output = path.resolve(
  process.argv[3] || path.join(root, "output/card-book-two"),
);
const repoImport = (file) => import(pathToFileURL(path.join(root, file)).href);
const { chromium } = await repoImport("node_modules/playwright/index.mjs");
const { createServer } = await repoImport("v2/card-game/serve.mjs");
const W = await repoImport("v2/card-game/world.mjs");
const { profiles } = await repoImport("v2/card-game/memory.mjs");
const { selectCard, topicForChoice } = await repoImport(
  "v2/scripts/card-browser-helpers.mjs",
);
const { recitalPoem } = await repoImport("v2/card-game/pack-recital.mjs");
const { packDefinition } = await repoImport("v2/card-game/pack-registry.mjs");
const { openDoorStart } = await repoImport("test/helpers/open-door.mjs");
const { version } = JSON.parse(
  await fs.readFile(path.join(root, "package.json")),
);
const hash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(path.join(root, file)))
    .digest("hex");
const fingerprints = Object.fromEntries(
  await Promise.all(
    [
      "v2/card-game/packs.json",
      "v2/card-game/world.mjs",
      "v2/card-game/app.mjs",
    ].map(async (file) => [file, await hash(file)]),
  ),
);
const F = "greek-alcestis-",
  P = "greek-pherae",
  COURT = "greek-courtyard",
  C = F + "chloris";
let fixture = W.createWorld({ opening: true });
// Start after the earlier journey to Dione. Pherae still needs its invitation.
delete fixture.opening;
fixture.actors.vale.place = COURT;
fixture.actors.moth.place = "station";
fixture.items.lamp.holder = "pond";
fixture.packs["greek-drama"].met["greek-baker"] = 0;
const save = W.encodeSave(fixture);
function trachisCareStart() {
  let world = openDoorStart();
  const act = (kind, fields = {}) => {
    const action = W.legalActions(world).find(
      (a) =>
        a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
    );
    assert(action, `Trachis setup ${kind} ${JSON.stringify(fields)}`);
    const result = W.play(world, action, world.revision);
    assert.equal(result.ok, true, result.error);
    world = result.state;
  };
  const choose = (id) => act("choose", { choiceId: "greek-trachis-" + id });
  const move = (target) => act("move", { target });
  const take = (id) => act("take", { item: "greek-trachis-" + id });
  choose("invite");
  move(P);
  move("greek-trachis");
  choose("iole-silence");
  take("meal");
  choose("meal");
  choose("choose-source");
  choose("prepare-robe");
  for (const id of ["gift-casket", "plain-cloth", "treated-robe"]) take(id);
  choose("robe-ready");
  choose("dispatch");
  act("accompany", { target: "greek-trachis-lichas" });
  choose("arrive-canae");
  act("drop", { item: "greek-trachis-plain-cloth" });
  move("greek-trachis");
  take("wool-remnant");
  choose("wool-late");
  move("greek-trachis-canae-approach");
  choose("harm");
  world = W.decodeSave(W.encodeSave(world));
  move("greek-trachis");
  take("water-flask");
  take("wool-remnant");
  move("greek-trachis-canae-approach");
  return W.encodeSave(world);
}
const trachisSave = trachisCareStart();
await fs.mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let browser;
const report = {
  root,
  version,
  greekRevision: packDefinition("greek-drama").revision,
  fingerprints,
  viewports: [],
};
try {
  browser = await chromium.launch({ headless: true });
  report.chromium = browser.version();
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width < 700,
    });
    page.setDefaultTimeout(15_000);
    const table = `book-two-browser-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const errors = [],
      consoleErrors = [],
      assetErrors = [],
      networkErrors = [],
      responses = [],
      choices = [];
    let dialogueRequests = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) =>
      networkErrors.push({
        url: request.url(),
        error: request.failure()?.errorText,
      }),
    );
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (response.status() >= 400)
        responses.push({ status: response.status(), path: url.pathname });
      if (response.status() >= 400 && url.pathname.includes("/assets/"))
        assetErrors.push({ status: response.status(), path: url.pathname });
    });
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save, seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      dialogueRequests++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "book-two-browser-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text:
              input.disclosures?.find((fact) => fact.speaker === id)?.text ||
              `${profiles[id]?.name || id} considers the witnessed result.`,
          })),
        }),
      });
    });
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const ready = async () => {
      for (let i = 0; i < 375; i++) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(40);
      }
      throw Error(`Hand stayed busy at ${width}px: ${errors.join("; ")}`);
    };
    const playCard = async (id) => {
      await ready();
      await selectCard(page, id, { touch: width < 700 });
      await page.locator("#card-actions .card-primary").click();
      await ready();
    };
    const choose = async (id) => {
      await ready();
      const choiceId = id.startsWith("greek-") ? id : F + id;
      const before = await state();
      const action = W.legalActions(before).find(
        (action) => action.choiceId === choiceId,
      );
      assert(action, `Available ${choiceId} at ${width}px`);
      const topic = topicForChoice(choiceId);
      await selectCard(page, topic?.speaker || action.cards[0], {
        touch: width < 700,
      });
      const selector = topic
        ? '#card-actions [data-action="talk"]'
        : `#card-actions [data-choice="${choiceId}"][data-pack="greek-drama"]`;
      await page.locator(selector).click();
      await ready();
      assert(
        (await state()).packs["greek-drama"].receipts[choiceId] > before.turn,
        `${choiceId} has a real receipt`,
      );
      choices.push(choiceId);
    };
    const artReady = async () => {
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#backdrop, #cast img")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `Page fits ${width}px`,
      );
    };
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=${table}`,
      );
      await card("greek-baker").waitFor();
      await ready();
      assert.equal(await card(P).count(), 0, "Pherae awaits the invitation");
      await choose("invitation");
      await playCard(P);
      assert.equal((await state()).actors.vale.place, P);
      assert.equal(await page.textContent("#place-title"), W.places[P].name);
      await card(C).waitFor();
      await artReady();
      const character = page.locator(`#cast [data-avatar="${C}"]`);
      await character.waitFor({ state: "visible" });
      assert(
        await character
          .locator("img")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
        "Chloris portrait loaded",
      );
      await page.screenshot({
        path: path.join(output, `pherae-entry-${width}.png`),
        fullPage: true,
      });
      for (const id of ["hear-bargain", "hear-wishes", "hear-death"])
        await choose(id);
      await playCard(F + "loaf");
      assert.equal(
        (await state()).items[F + "loaf"].holder,
        "vale",
        "The loaf is carried first",
      );
      await choose("prepare-loaf");
      assert.equal(
        (await state()).items[F + "loaf"].holder,
        P,
        "The first placement leaves the loaf at Pherae",
      );
      await playCard(F + "cup");
      assert.equal((await state()).items[F + "cup"].holder, "vale");
      await choose("set-cup");
      const before = await state();
      assert.equal(before.items[F + "cup"].holder, P);
      assert.equal(
        before.packs["greek-drama"].recitals[F + "set-cup"].actor,
        "vale",
      );
      const verses = recitalPoem(
        before,
        packDefinition("greek-drama"),
      ).stanzas.filter((row) => row.id.startsWith(F));
      assert.equal(verses.length, 1);
      assert.equal(verses[0].id, F + "set-cup");
      await artReady();
      await page.screenshot({
        path: path.join(output, `pherae-table-${width}.png`),
        fullPage: true,
      });
      await page.reload();
      await card(C).waitFor();
      await ready();
      await artReady();
      const reloaded = await state();
      for (const field of [
        "turn",
        "revision",
        "eventSeq",
        "items",
        "packs",
        "knowledge",
        "quests",
      ])
        assert.deepEqual(
          reloaded[field],
          before[field],
          `Reload preserves ${field}`,
        );
      assert.equal(reloaded.actors.vale.place, P);
      assert.deepEqual(
        recitalPoem(reloaded, packDefinition("greek-drama")),
        recitalPoem(before, packDefinition("greek-drama")),
      );
      await character.waitFor({ state: "visible" });
      await page.screenshot({
        path: path.join(output, `pherae-reload-${width}.png`),
        fullPage: true,
      });
      await playCard(COURT);
      assert.equal((await state()).actors.vale.place, COURT);
      assert.equal((await state()).items[F + "loaf"].holder, P);
      assert.equal((await state()).items[F + "cup"].holder, P);
      const alcestisChoices = [...choices];
      const T = "greek-trachis-",
        HERO = T + "heracles",
        OETA = "greek-oeta",
        CANAE = T + "canae-approach",
        WATER = T + "water-flask";
      await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
        key,
        save: trachisSave,
      });
      await page.reload();
      await card(HERO).waitFor();
      await ready();
      await playCard(OETA);
      assert.equal(
        (await state()).actors[HERO].place,
        CANAE,
        "Heracles still waits at Canae",
      );
      assert.equal(
        W.legalActions(await state()).some(
          (a) => a.choiceId === T + "care-ending",
        ),
        false,
        "Care waits for Heracles at Oeta",
      );
      assert.equal(
        await page.locator(`[data-choice="${T}care-ending"]`).count(),
        0,
      );
      await playCard(CANAE);
      await choose(T + "agree-oeta");
      await ready();
      await selectCard(page, HERO, { touch: width < 700 });
      await selectCard(page, OETA, { touch: width < 700 });
      await page.locator('#card-actions [data-action="accompany"]').click();
      await ready();
      assert.equal((await state()).actors.vale.place, OETA);
      assert.equal((await state()).actors[HERO].place, OETA);
      await selectCard(page, WATER, { touch: width < 700 });
      await selectCard(page, OETA, { touch: width < 700 });
      await page.locator('#card-actions [data-action="drop"]').click();
      await ready();
      assert.equal((await state()).items[WATER].holder, OETA);
      assert.equal(
        W.legalActions(await state()).some(
          (a) => a.choiceId === T + "care-ending",
        ),
        false,
        "Care needs carried water",
      );
      await selectCard(page, HERO, { touch: width < 700 });
      assert.equal(
        await page.locator(`[data-choice="${T}care-ending"]`).count(),
        0,
      );
      await selectCard(page, HERO, { touch: width < 700 });
      await playCard(WATER);
      await choose(T + "care-ending");
      let cared = await state();
      assert.equal(cared.items[WATER].holder, OETA);
      assert.equal(cared.packs["greek-drama"].choices[T + "ending"], "care");
      await artReady();
      await page
        .locator(`#cast [data-avatar="${HERO}"]`)
        .waitFor({ state: "visible" });
      await page.screenshot({
        path: path.join(output, `trachis-care-${width}.png`),
        fullPage: true,
      });
      await page.reload();
      await card(HERO).waitFor();
      await ready();
      await artReady();
      const careReload = await state();
      assert.deepEqual(careReload.packs, cared.packs);
      assert.deepEqual(careReload.items, cared.items);
      assert.equal(careReload.actors[HERO].place, OETA);
      for (const destination of ["greek-trachis", P, COURT])
        await playCard(destination);
      await choose(T + "return-care");
      const returned = await state();
      assert.equal(returned.actors.vale.place, COURT);
      assert.equal(returned.items[T + "wool-remnant"].holder, "vale");
      assert.equal(returned.items[WATER].holder, OETA);
      assert.equal(
        returned.packs["greek-drama"].flags[T + "return-care"],
        true,
      );
      assert(
        recitalPoem(returned, packDefinition("greek-drama")).stanzas.some(
          (row) => row.id === T + "return-care",
        ),
      );
      await artReady();
      await page.screenshot({
        path: path.join(output, `trachis-return-${width}.png`),
        fullPage: true,
      });
      const trachis = {
        setup:
          "source-shaped branch through legal model actions, before Oeta agreement",
        ui: "walk alone to Oeta, return, agree, accompany Heracles, drop/take water, place care, reload, return via Trachis and Pherae, report to Dione",
        choices: choices.slice(alcestisChoices.length),
        gateChecks: ["Heracles present at Oeta", "water carried by traveler"],
        ending: returned.packs["greek-drama"].choices[T + "ending"],
        woolHolder: returned.items[T + "wool-remnant"].holder,
        waterHolder: returned.items[WATER].holder,
        savedTurn: returned.turn,
      };
      const brokenImages = await page
        .locator("img")
        .evaluateAll((images) =>
          images
            .filter((img) => img.complete && img.naturalWidth === 0)
            .map((img) => img.src),
        );
      assert.deepEqual(errors, []);
      assert.deepEqual(assetErrors, []);
      assert.deepEqual(brokenImages, []);
      assert.deepEqual(responses, [], "All observed HTTP responses succeed");
      assert.deepEqual(consoleErrors, [], "The browser console stays clear");
      // Page reload can cancel an unused media request. Record such events.
      const failedLoads = networkErrors.filter(
        (row) => row.error !== "net::ERR_ABORTED",
      );
      assert.deepEqual(failedLoads, []);
      report.viewports.push({
        width,
        height,
        status: "passed",
        choices: alcestisChoices,
        trachis,
        dialogueRequests,
        savedTurn: before.turn,
        visibleCharacter: C,
        firstPlacement: F + "loaf",
        earnedVerse: verses[0].lines,
        errors,
        consoleErrors,
        assetErrors,
        networkErrors,
        responses,
        brokenImages,
      });
      console.log(JSON.stringify(report.viewports.at(-1)));
    } catch (error) {
      await page
        .screenshot({
          path: path.join(output, `failure-${width}.png`),
          fullPage: true,
        })
        .catch(() => {});
      await fs.writeFile(
        path.join(output, `failure-${width}.json`),
        JSON.stringify(
          {
            error: error.stack,
            errors,
            consoleErrors,
            assetErrors,
            networkErrors,
            responses,
            state: await state().catch(() => null),
            html: await page
              .locator("body")
              .innerHTML()
              .catch(() => ""),
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await page.close();
    }
  }
  for (const [file, expected] of Object.entries(fingerprints))
    assert.equal(
      await hash(file),
      expected,
      `${file} stayed stable during the smoke`,
    );
  report.status = "passed";
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      chromium: report.chromium,
      version,
      viewports: report.viewports.map(({ width, height }) => [width, height]),
      output,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
