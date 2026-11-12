// An open page keeps the account revision it loaded. A cookie changed by
// another tab must not authorize this page's older game or maker operations.
const changed = () =>
  Object.assign(new Error("Your account changed. Reload before continuing."), {
    code: "account_reset",
    status: 409,
  });
export function createAccountRevision() {
  let account;
  return {
    observe(value, replace = false) {
      const next = value?.authenticated
        ? { user: value.user_id, revision: value.account_revision ?? 0 }
        : null;
      if (
        next &&
        (typeof next.user !== "string" ||
          !next.user ||
          !Number.isSafeInteger(next.revision) ||
          next.revision < 0)
      )
        throw changed();
      if (
        !replace &&
        account !== undefined &&
        (account?.user !== next?.user || account?.revision !== next?.revision)
      )
        throw changed();
      account = next;
      return value;
    },
    headers() {
      return account
        ? {
            "X-Account-User": account.user,
            "X-Account-Revision": String(account.revision),
          }
        : {};
    },
  };
}
export const accountRevision = createAccountRevision();
