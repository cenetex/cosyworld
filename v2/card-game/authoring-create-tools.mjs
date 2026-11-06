import { transferAuthoringCreate } from "./authoring-create-transfer.mjs";

export function authoringCreateTools({ store, accounts, changed, chooseTool, transfer = transferAuthoringCreate }) {
  let key, life = 0, operation, controller, loading = false, error = "", phase = {};
  const refresh = () => changed();
  const signIn = () => chooseTool(accounts.requireSignIn());
  function open(status) {
    life++;
    controller?.abort();
    key = status.key;
    operation = controller = null;
    loading = false;
    error = "";
    phase = {};
  }
  async function read(owner, at) {
    const saved = await store.readCreate(key, owner);
    if (at !== life) return;
    operation = saved;
  }
  function select() {
    const account = accounts.state();
    if (operation || loading || controller || !account.authenticated || !account.user_id) return;
    const at = life;
    loading = true;
    void read(account.user_id, at).catch(failure => {
      if (at === life) error = failure.message;
    }).finally(() => { if (at === life) { loading = false; refresh(); } });
  }
  function send(at) {
    const active = new AbortController();
    controller = active;
    error = "";
    void transfer(store, operation, {
      signal: active.signal,
      progress(value) { if (at === life) { phase = value; refresh(); } },
    }).then(receipt => {
      if (at === life) operation = { ...operation, receipt };
    }).catch(failure => {
      if (at !== life) return;
      error = failure.name === "AbortError"
        ? "Transfer paused. Your saved Create is ready to retry."
        : failure.message;
      if (failure.status === 401) signIn();
    }).finally(() => {
      if (at === life) { controller = null; refresh(); }
    });
    refresh();
  }
  async function run(_action, context) {
    if (controller) { controller.abort(); return; }
    if (loading) return;
    const account = accounts.state(), at = life;
    if (!account.authenticated || !account.user_id) return signIn();
    if (operation && operation.owner !== account.user_id) {
      error = "Sign in to the account that started this saved Create.";
      refresh();
      return signIn();
    }
    loading = true;
    error = "";
    refresh();
    try {
      if (!operation) await read(account.user_id, at);
      if (at !== life) return;
      if (!operation) {
        const saved = await context.save();
        context.snapshot();
        const next = await store.beginCreate(key, account.user_id, saved.generation);
        if (at !== life) return;
        operation = next;
      }
      if (at !== life) return;
      if (!operation.receipt) send(at);
    } catch (failure) {
      if (at === life) error = failure.message;
    } finally {
      if (at === life) { loading = false; refresh(); }
    }
  }
  return {
    open,
    signedIn: () => chooseTool("create-private"),
    transientState: () => controller || loading ? JSON.stringify([key, life, operation?.requestKey]) : null,
    tools: () => [{
      id: "create-private",
      name: "Create private world",
      select,
      describe() {
        const account = accounts.state(), done = operation?.receipt;
        const note = error || (loading ? "Checking your saved world."
          : controller ? phase.phase === "upload"
            ? `Uploading files · ${phase.completed} of ${phase.total}.`
            : "Saving your private world."
          : done ? `${done.title} has a private saved copy.`
          : operation ? "Retry the saved copy. Your later local edits stay in this draft."
          : "Save this world and its files privately with your passkey account.");
        return { note, actions: [{
          label: controller ? "Pause transfer" : loading ? "Checking"
            : !account.authenticated || !account.user_id ? "Sign in"
            : done ? "Created privately" : operation ? "Retry Create" : "Create private world",
          disabled: loading || Boolean(done),
        }] };
      },
      run,
    }],
  };
}
