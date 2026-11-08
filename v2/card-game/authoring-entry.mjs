import { createAuthoringVisualTools } from "./authoring-visual-tools.mjs";
import { createAuthoringAccountTools } from "./authoring-account-tools.mjs";
import { authoringSeedTools } from "./authoring-seed-tools.mjs";
import { openAuthoringStore } from "./authoring-local-store.mjs";
import { createSampleWorld } from "./authoring-sample.mjs";
import { emptySeedWorld } from "./authoring-seed-world.mjs";
import { createSeedMaker } from "./authoring-seed-maker.mjs";
import { authoringCreateTools } from "./authoring-create-tools.mjs";
import { installWorldDesigner } from "./authoring-designer.mjs";
import { authoringImportTools } from "./authoring-import-tools.mjs";
import { renderCardDescriptor } from "./card-descriptor.mjs";
import { showActionBeatNote } from "./action-beat-note.mjs";

const $ = (id) => document.getElementById(id);
const panel = $("action-beat"),
  descriptor = document.querySelector(".dialogue"),
  style = document.documentElement.style;
let designer,
  missingDraft = false;
function measure() {
  style.setProperty(
    "--tree-descriptor-height",
    `${Math.max(150, Math.ceil(innerHeight - panel.getBoundingClientRect().top + 8))}px`,
  );
}
const actionBeat = {
  show(beat) {
    renderCardDescriptor(beat, { showNote: showActionBeatNote });
    panel.hidden = descriptor.hidden = false;
    descriptor.dataset.action = "true";
    document.body.dataset.handExpanded = "true";
    document.body.dataset.dialogueOver = "true";
    requestAnimationFrame(measure);
  },
  clear() {
    panel.hidden = true;
  },
};
new ResizeObserver(measure).observe(descriptor);
new ResizeObserver(([entry]) => {
  style.setProperty(
    "--dock-height",
    `${entry.target.getBoundingClientRect().height}px`,
  );
}).observe(document.querySelector(".play-dock"));
addEventListener("resize", measure);
visualViewport?.addEventListener("resize", measure);

// Keep the existing file input inside the click that opens the native picker.
function chooseFiles({ directory }) {
  const input = $("local-import");
  input.value = "";
  input.multiple = true;
  input.accept = "";
  input.webkitdirectory = directory;
  return new Promise((resolve, reject) => {
    const finish = (files) => {
      input.removeEventListener("change", change);
      input.removeEventListener("cancel", cancel);
      resolve(files);
    };
    const change = () => finish(Array.from(input.files));
    const cancel = () => finish([]);
    input.addEventListener("change", change);
    input.addEventListener("cancel", cancel);
    try {
      input.click();
    } catch (error) {
      input.removeEventListener("change", change);
      input.removeEventListener("cancel", cancel);
      reject(error);
    }
  });
}

const cache = new Map();
let activeAssets;
const assetKey = ({ key, generation }) => `${key}:${generation}`;
function pruneAssets(keep) {
  for (const [key, entry] of cache)
    if (entry !== activeAssets && entry !== keep) {
      for (const url of entry.urls.values()) URL.revokeObjectURL(url);
      cache.delete(key);
    }
}
function cacheAssets(key, generation, draft, assets) {
  const id = assetKey({ key, generation });
  if (cache.has(id)) return;
  const entry = {
    metadata: new Map(draft.assets.map((meta) => [meta.path, meta])),
    assets,
    urls: new Map(),
  };
  cache.set(id, entry);
  pruneAssets(entry);
}
function resolveArt(path, status) {
  const entry = cache.get(assetKey(status)),
    meta = entry?.metadata.get(path);
  if (!meta?.mime.startsWith("image/")) return null;
  if (!entry.urls.has(path)) {
    const bytes = entry.assets.get(path);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== meta.size)
      return null;
    entry.urls.set(
      path,
      URL.createObjectURL(new Blob([bytes], { type: meta.mime })),
    );
  }
  return entry.urls.get(path);
}
addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  for (const entry of cache.values())
    for (const url of entry.urls.values()) URL.revokeObjectURL(url);
});

async function start() {
  const database = await openAuthoringStore();
  const store = {
    readCreate: (...args) => database.readCreate(...args),
    beginCreate: (...args) => database.beginCreate(...args),
    finishCreate: (...args) => database.finishCreate(...args),
    async read(key) {
      const record = await database.read(key);
      if (record)
        cacheAssets(key, record.generation, record.draft, record.assets);
      return record;
    },
    async write(key, value, generation, assets) {
      if (generation === 0 && assets === undefined)
        assets = cache.get(assetKey({ key, generation }))?.assets;
      const saved = await database.write(key, value, generation, assets);
      if (assets) cacheAssets(key, saved, value.draft, assets);
      else {
        const entry = cache.get(assetKey({ key, generation }));
        if (entry) cache.set(assetKey({ key, generation: saved }), entry);
      }
      return saved;
    },
  };
  const params = new URLSearchParams(location.search);
  const key =
    params.get("draft") ||
    (params.get("sample") === "1"
      ? `sample-${crypto.randomUUID()}`
      : "first-world");
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(key))
    throw new Error("Open a valid draft link.");
  let record = await store.read(key);
  if (!record && params.has("draft")) {
    missingDraft = true;
    throw new Error(
      "This local draft is unavailable. Open the sample world to start a new draft.",
    );
  }
  if (!record) {
    record = {
      ...(params.get("sample") === "1"
        ? await createSampleWorld()
        : emptySeedWorld()),
      generation: 0,
    };
    cacheAssets(key, 0, record.draft, record.assets);
  }
  const imports = authoringImportTools({ store, chooseFiles });
  const accountHome = () => designer.chooseTool("sign-in");
  const accounts = createAuthoringAccountTools({
    onChange: () => designer?.refresh(),
    onSignedIn: () => {
      const resume = resumeAccount;
      resumeAccount = accountHome;
      resume();
    },
  });
  let resumeAccount = accountHome;
  const seed = authoringSeedTools({
    requireSignIn() {
      resumeAccount = () => seed.signedIn();
      return accounts.requireSignIn();
    },
    changed: () => designer?.refresh(),
    chooseTool: (id) => designer.chooseTool(id),
  });
  const maker = createSeedMaker({
    accounts: {
      requireSignIn() {
        resumeAccount = () => maker.signedIn();
        return accounts.requireSignIn();
      },
    },
    changed: () => designer?.refresh(),
    choose: (id) =>
      id === "world" ? designer.chooseWorld() : designer.chooseTool(id),
  });
  const visuals = createAuthoringVisualTools({
    accounts: { requireSignIn() {
      resumeAccount = visuals.signedIn;
      return accounts.requireSignIn();
    } },
    changed: () => designer?.refresh(),
    choose: id => designer.chooseTool(id),
  });
  const creator = authoringCreateTools({
    store,
    accounts: { state: accounts.state, requireSignIn() {
      resumeAccount = creator.signedIn;
      return accounts.requireSignIn();
    } },
    changed: () => designer?.refresh(),
    chooseTool: id => designer.chooseTool(id),
  });
  const source = {
    id: "source",
    name: "World notes",
    describe(context) {
      const { key, draft } = context.snapshot();
      return {
        note: "These notes are saved with your world.",
        edit: {
          key: `${key}:document`,
          label: "World notes",
          value: draft.document,
          onInput: (document) => context.stage({ document }),
        },
        actions: [{ label: "Save notes", run: "save" }],
      };
    },
    run: (_action, context) => context.save(),
  };
  designer = installWorldDesigner({
    store,
    transientState: () => {
      const values = [seed.transientState(), maker.transient(), creator.transientState(), visuals.transient()];
      return values.some((value) => value !== null)
        ? JSON.stringify(values)
        : null;
    },
    actionBeat,
    resolveArt,
    tools: () => [
      source,
      ...imports(),
      ...accounts.tools(),
      ...(maker.detailed() ? seed.tools() : []),
      ...maker.tools(),
      ...creator.tools(),
      ...visuals.tools(),
    ],
    project: maker.project,
    onOpen(status) {
      seed.open(status);
      maker.clear();
      visuals.clear();
      creator.open(status);
      resumeAccount = accountHome;
    },
    onScene(place, source, status) {
      maker.sync(source, status);
      visuals.sync(source);
      activeAssets = cache.get(assetKey(status));
      pruneAssets();
      const next = new URL(location.href);
      if (status.generation > 0) {
        next.searchParams.set("draft", status.key);
        next.searchParams.delete("sample");
      }
      history.replaceState(null, "", next);
      const locationCard = source.pack?.places?.[place];
      const art = resolveArt(
        locationCard?.backdrop || locationCard?.art,
        status,
      );
      $("place-title").textContent = locationCard?.name || "World editor";
      document.querySelector(".brand span").textContent =
        source.pack?.id === "made-world"
          ? source.pack.name
          : status.title || "Your world";
      for (const image of [
        $("backdrop"),
        document.querySelector(".settings-scene"),
      ]) {
        if (!image) continue;
        if (art) image.src = art;
        else image.removeAttribute("src");
      }
    },
    onClose() {
      designer.open();
    },
  });
  for (const [id, label, choose] of [
    ["history-button", "World", designer.chooseWorld],
    ["menu-button", "Tools", designer.chooseTools],
  ]) {
    const button = $(id);
    button.textContent = label;
    button.onclick = choose;
  }
  document.title = "Make a world · Lonely Forest";
  designer.open({ key, record });
  if (record.draft.pack?.id === "made-world" && !record.draft.pack.entry)
    designer.chooseTool("maker-seed");
  void accounts.refresh();
  if (!record.draft.pack) designer.chooseTool("source");
}
try {
  await start();
} catch (error) {
  actionBeat.show({
    name: "World editor",
    note: error.message,
    cards: [],
    buttons: [
      {
        label: missingDraft ? "Open sample world" : "Try again",
        run: () =>
          missingDraft ? location.assign("/make?sample=1") : location.reload(),
      },
    ],
  });
}
