import { it, expect } from "vitest";
import { createLocalBackups } from "../v2/card-game/local-saves.mjs";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
const validate = (text) => {
  if (!JSON.parse(text).schema) throw Error("Invalid save");
};

it("restores a file into a fresh browser and retries an interrupted backup", async () => {
  const disk = { revision: 1, save: '{"schema":7,"turn":4}' };
  const local = storage();
  let fail = false;
  const fetcher = async (_url, options) => {
    if (options) {
      if (fail) throw Error("Offline");
      const data = JSON.parse(options.body);
      expect(data.revision).toBe(disk.revision);
      disk.revision++;
      disk.save = data.save;
    }
    return Response.json(disk);
  };
  const first = createLocalBackups({
    slot: "table",
    storage: local,
    fetcher,
    validate,
  });
  await first.restore();
  expect(local.getItem("table")).toBe(disk.save);
  fail = true;
  const next = '{"schema":7,"turn":5}';
  local.setItem("table", next);
  expect(await first.queue(next)).toBe(false);
  fail = false;
  const afterRestart = createLocalBackups({
    slot: "table",
    storage: local,
    fetcher,
    validate,
  });
  await afterRestart.restore();
  expect(disk.save).toBe(next);
  expect(disk.revision).toBe(2);
});

it("keeps a conflicting copy and reports the stale write", async () => {
  const local = storage();
  const errors = [];
  const backups = createLocalBackups({
    slot: "table",
    storage: local,
    validate,
    onError: (message) => errors.push(message),
    fetcher: async (_url, options) =>
      Response.json(
        { revision: 2, save: '{"schema":7}' },
        { status: options ? 409 : 200 },
      ),
  });
  await backups.restore();
  const text = '{"schema":7,"turn":9}';
  expect(await backups.queue(text)).toBe(false);
  expect(local.getItem("table.conflict")).toBe(text);
  expect(errors[0]).toContain("Another window");
});

it("validates a saved file before replacing the browser copy", async () => {
  const local = storage();
  local.setItem("table", '{"schema":7}');
  const backups = createLocalBackups({
    slot: "table",
    storage: local,
    validate,
    fetcher: async () => Response.json({ revision: 1, save: "{}" }),
  });
  await expect(backups.restore()).rejects.toThrow("Invalid save");
  expect(local.getItem("table")).toBe('{"schema":7}');
});
