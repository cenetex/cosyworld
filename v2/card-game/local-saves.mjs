export function createLocalBackups({
  slot,
  storage = globalThis.localStorage,
  fetcher = globalThis.fetch,
  validate,
  onError = () => {},
}) {
  const url = `/card-game/local/saves/${encodeURIComponent(slot)}`;
  const key = `${slot}.local-backup`;
  let revision = 0,
    pending = null,
    running = null,
    stopped = false;
  function remember() {
    storage.setItem(key, JSON.stringify({ revision, pending }));
  }
  async function restore() {
    const meta = JSON.parse(storage.getItem(key) || "null");
    const response = await fetcher(url);
    if (!response.ok)
      throw new Error("The local save needs another try. Restart the app.");
    const saved = await response.json();
    revision = saved.revision;
    const browser = storage.getItem(slot);
    if (saved.save) validate(saved.save);
    if (
      meta?.pending &&
      meta.pending !== saved.save &&
      meta.revision === revision
    ) {
      validate(meta.pending);
      storage.setItem(slot, meta.pending);
      pending = meta.pending;
    } else if (saved.save) {
      if (browser && browser !== saved.save)
        storage.setItem(`${slot}.before-restore`, browser);
      storage.setItem(slot, saved.save);
    } else if (browser) {
      validate(browser);
      pending = browser;
    }
    remember();
    if (pending) await flush();
  }
  async function flush() {
    if (running) return running;
    if (stopped) return false;
    running = (async () => {
      while (pending !== null) {
        const value = pending;
        const response = await fetcher(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision, save: value }),
        });
        if (response.status === 409) {
          stopped = true;
          storage.setItem(`${slot}.conflict`, value);
          pending = null;
          remember();
          throw new Error(
            "Another window saved this table. Save a backup of this copy, then reload.",
          );
        }
        if (!response.ok)
          throw new Error(
            "The local backup needs another try. Your browser has this save.",
          );
        const saved = await response.json();
        revision = saved.revision;
        if (pending === value) pending = null;
        remember();
      }
      return true;
    })()
      .catch((error) => {
        onError(error.message);
        return false;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  function queue(value) {
    pending = value;
    remember();
    return flush();
  }
  return { restore, queue, flush };
}

export function installBackupControls({
  slot,
  backups,
  getSave,
  validate,
  storage = localStorage,
  doc = document,
  reload = () => location.reload(),
}) {
  const section = doc.getElementById("local-settings");
  if (!section) return;
  section.hidden = false;
  const status = doc.getElementById("local-save-status");
  doc.getElementById("local-export").onclick = () => {
    const blob = new Blob(
      [
        JSON.stringify({
          format: "cosyworld.local-save.v1",
          slot,
          save: getSave(),
        }),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = `cosyworld-${slot}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  doc.getElementById("local-import").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Choose a CosyWorld save under 2 MiB.");
      const text = await file.text();
      const value = JSON.parse(text);
      const save =
        typeof value.save === "string" &&
        (value.format === "cosyworld.local-save.v1" ||
          Number.isInteger(value.revision))
          ? value.save
          : text;
      validate(save);
      const previous = storage.getItem(slot);
      if (previous) storage.setItem(`${slot}.bak`, previous);
      storage.setItem(slot, save);
      if (await backups.queue(save)) reload();
      else
        status.textContent =
          "The backup needs another try. Keep this window open.";
    } catch (error) {
      status.textContent = error.message;
    }
    event.target.value = "";
  };
}
