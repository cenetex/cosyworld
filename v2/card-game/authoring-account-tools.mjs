import { passkey, request } from "./shared-auth.mjs";

export function createAuthoringAccountTools({
  request: read = request,
  passkey: ceremony = passkey,
  onChange = () => {},
  onSignedIn = () => {},
} = {}) {
  let epoch = 0,
    recheck = false;
  const account = {
    known: false,
    authenticated: false,
    members_only: false,
    display_name: "",
    user_id: "",
    busy: false,
    error: "",
  };
  const state = () => ({ ...account });
  const changed = () => onChange(state());
  const canCreate = () =>
    account.known && !account.authenticated && !account.members_only;
  function failed(error, at) {
    if (at !== epoch) return;
    account.error =
      error?.name === "NotAllowedError"
        ? "The passkey step was closed. You can try again."
        : error?.message || "Check your connection, then try again.";
  }
  async function load(at) {
    const next = await read("/auth/account");
    if (at !== epoch) return;
    if (typeof next?.authenticated !== "boolean")
      throw new Error("Check your account again.");
    Object.assign(account, {
      known: true,
      authenticated: next.authenticated,
      user_id: next.authenticated && typeof next.user_id === "string" ? next.user_id : "",
      members_only: next.members_only === true,
      display_name:
        typeof next.display_name === "string" ? next.display_name : "",
    });
    recheck = false;
  }
  async function refresh() {
    if (account.busy) return state();
    const at = ++epoch;
    account.error = "";
    try {
      await load(at);
    } catch (error) {
      failed(error, at);
    }
    changed();
    return state();
  }
  async function signIn(register) {
    if (account.busy || (register && !canCreate())) return;
    const at = ++epoch;
    account.busy = true;
    account.error = "";
    changed();
    try {
      await ceremony(register);
      if (at !== epoch) return;
      recheck = true;
      await load(at);
      if (at === epoch && !account.authenticated)
        throw new Error("Sign in again to continue.");
    } catch (error) {
      failed(error, at);
    } finally {
      account.busy = false;
      changed();
    }
    if (at === epoch && account.authenticated) onSignedIn(state());
  }
  function tool(register) {
    const label = register ? "Create passkey" : "Sign in";
    return {
      id: register ? "create-passkey" : "sign-in",
      name: !register && account.authenticated ? "Your account" : label,
      describe: () => ({
        info: account.busy ? "Waiting for passkey" : "Account",
        note:
          account.error ||
          (account.authenticated
            ? `Signed in${account.display_name ? ` as ${account.display_name}` : ""}.`
            : register
              ? "Your device keeps the key. The server keeps its public half and your account number."
              : "Sign in with your passkey, then return to your world."),
        actions: [
          {
            label:
              !account.known || recheck
                ? "Check account"
                : account.authenticated
                  ? "Refresh account"
                  : label,
            disabled: account.busy,
            stays: true,
          },
        ],
      }),
      async run() {
        if (!account.known || recheck || account.authenticated) {
          await refresh();
          if (account.authenticated) onSignedIn(state());
        } else await signIn(register);
      },
    };
  }
  return {
    state,
    refresh,
    tools: () => [tool(false), ...(canCreate() ? [tool(true)] : [])],
    requireSignIn() {
      epoch++;
      account.authenticated = false;
      account.known = false;
      account.display_name = "";
      account.user_id = "";
      account.error = "Sign in to continue with your world.";
      changed();
      void refresh();
      return "sign-in";
    },
  };
}
