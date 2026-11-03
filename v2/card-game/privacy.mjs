// What a passkey keeps (#2052): the full notice before a passkey is made,
// one line at sign-in, both linking the Privacy page (privacy.html).

const PASSKEY_NOTICE = [
  "We collect your passkey so you can log in and keep your avatars on our shared servers, which use our shared AI on our domain. Your device keeps the key; we keep only its public half and an account number. While you're signed in, we keep your avatars, shared worlds and their play history, and any credits. Character dialogue and voices are made by AI providers such as OpenRouter from the game's own state. Nothing you type is sent, because the game has no typing. We count plays without knowing who you are; turn that off in Settings. If you want to play the game without sharing your passkey data with us, download, modify, and play the game yourself for free from ",
  ["lonelyforest.com/download", "/download"],
  ". ",
  ["Privacy", "/privacy"],
];
const SIGN_IN_NOTICE = [
  "Signing in keeps your avatars and worlds with your passkey. ",
  ["Privacy", "/privacy"],
];

function notice(parts) {
  const text = document.createElement("p");
  text.className = "privacy-notice";
  for (const part of parts) {
    if (typeof part === "string") {
      text.append(part);
      continue;
    }
    const link = document.createElement("a");
    [link.textContent, link.href] = part;
    link.target = "_blank";
    link.rel = "noopener";
    text.append(link);
  }
  return text;
}
export const passkeyNotice = () => notice(PASSKEY_NOTICE);
export const signInNotice = () => notice(SIGN_IN_NOTICE);
