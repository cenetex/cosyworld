import { loadGitHubSource } from "./authoring-github-source.mjs";
import { importLocalDraft } from "./authoring-local-import.mjs";
import { DRAFT_LIMITS, importPack, parseDraft } from "./authoring-draft.mjs";
import {
  importSourcePack,
  sourcePackCandidates,
} from "./authoring-source-import.mjs";

const pathOf = (entry) =>
  entry.path ?? (entry.webkitRelativePath || entry.name);
const need = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function selectedSource(files, path) {
  const file = files.find((entry) => entry.path === path).file;
  const size = file.size;
  need(size <= DRAFT_LIMITS.metadata, "Choose world JSON within 10 MiB.");
  const bytes = await file.arrayBuffer();
  need(
    bytes instanceof ArrayBuffer &&
      bytes.byteLength === size &&
      file.size === size,
    "Read the world file again; its size changed.",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const cached = { size, arrayBuffer: async () => bytes.slice(0) };
  return {
    text,
    data: JSON.parse(text),
    files: files.map((entry) =>
      entry.path === path ? { path, file: cached } : entry,
    ),
  };
}

// File picking stays with the page so the existing input keeps its user gesture.
export function authoringImportTools({
  store,
  chooseFiles,
  github = loadGitHubSource,
}) {
  let url = "",
    listed = [],
    serial = 0,
    note = "Choose a repository or a folder containing your world.";

  function list(files, origin) {
    files = files.map((entry) => ({
      path: pathOf(entry),
      file: entry.file ?? entry,
    }));
    const raw = sourcePackCandidates(files);
    const json = files
      .map(pathOf)
      .filter(
        (path) =>
          path.endsWith(".json") &&
          (!raw.length || path.split("/").at(-1) !== "card-bridge.json"),
      );
    const depth = json.reduce(
      (min, path) => Math.min(min, path.split("/").length),
      Infinity,
    );
    const paths = [
      ...new Set([
        ...raw,
        ...json.filter((path) => path.split("/").length === depth).sort(),
      ]),
    ];
    if (!paths.length)
      throw new Error(
        "Choose a folder with card-world.json or an exported draft.",
      );
    const names = new Set(files.map(pathOf));
    const batch = ++serial;
    listed = paths.map((path, index) => ({
      id: `import-pack-${serial}-${index}`,
      name: path.endsWith("/card-world.json")
        ? path.split("/").at(-2) || "World"
        : path.split("/").at(-1),
      describe: () => ({
        note: path,
        actions: [
          {
            label: "Import this world",
            run: "import",
            stays: true,
            opensDraft: true,
          },
        ],
      }),
      async run(_action, context) {
        need(batch === serial, "Choose a card from the current import list.");
        await context.save();
        const selected = await selectedSource(files, path);
        let result;
        if (Object.hasOwn(selected.data ?? {}, "pack")) {
          const manifest = parseDraft(selected.text);
          const prefix = path.slice(0, path.lastIndexOf("/") + 1);
          const wanted = new Set([
            path,
            ...manifest.assets.map((asset) => prefix + asset.path),
          ]);
          result = await importLocalDraft({
            files: selected.files.filter((entry) => wanted.has(entry.path)),
            manifestPath: path,
          });
          if (origin.kind === "github") {
            const provenance = { ...origin, path },
              sources = [...manifest.sources];
            if (
              !sources.some((s) =>
                Object.entries(provenance).every(
                  ([key, value]) => s[key] === value,
                ),
              )
            )
              sources.push(provenance);
            result.draft = importPack({ ...manifest, sources });
          }
        } else {
          need(
            ["places", "avatars", "items"].some((key) =>
              Object.hasOwn(selected.data ?? {}, key),
            ),
            "Choose a world pack or an exported draft.",
          );
          const match = path.match(
            /^(.*\/)?content\/([^/]+)\/card-world\.json$/u,
          );
          const mirrored =
            match && `${match[1] || ""}worlds/${match[2]}/card-bridge.json`;
          const adjacent = `${path.slice(0, path.lastIndexOf("/") + 1)}card-bridge.json`;
          const bridge = [mirrored, adjacent].find((candidate) =>
            names.has(candidate),
          );
          result = await importSourcePack({
            files: selected.files,
            packPath: path,
            bridgePath: bridge || null,
            origin,
          });
        }
        context.snapshot();
        need(batch === serial, "Choose a card from the current import list.");
        const key = crypto.randomUUID();
        const value = { draft: result.draft, launch: null };
        const generation = await store.write(key, value, 0, result.assets);
        await context.open({
          key,
          record: { ...value, generation, assets: result.assets },
        });
        listed = [];
        note = `Imported ${result.draft.title || "world"}. Choose its starting location.`;
      },
    }));
    note = "Choose a pack or draft JSON card to import.";
  }

  const local = (directory) => ({
    id: directory ? "import-folder" : "import-files",
    name: directory ? "Import folder" : "Import files",
    describe: () => ({
      note,
      actions: [
        {
          label: directory ? "Choose folder" : "Choose files",
          run: "choose",
          stays: true,
        },
      ],
    }),
    async run(_action, context) {
      const files = await chooseFiles({ directory });
      if (!files?.length) return;
      await context.save();
      context.snapshot();
      list(Array.from(files), { kind: "file" });
    },
  });

  return () => [
    {
      id: "import-github",
      name: "Import GitHub",
      describe: () => ({
        note,
        edit: {
          key: "authoring-repository-url",
          label: "GitHub repository",
          value: url,
          onInput: (text) => {
            if (url !== text) {
              listed = [];
              serial++;
            }
            url = text;
          },
        },
        actions: [{ label: "Open repository", run: "github", stays: true }],
      }),
      async run(_action, context) {
        const requested = url.trim();
        await context.save();
        const source = await github(requested);
        context.snapshot();
        list(source.files, source.origin);
      },
    },
    local(true),
    local(false),
    ...listed,
  ];
}
