import { setupOpenRouter } from "./openrouter-settings.mjs";
import { setupLocalService } from "./local-service.mjs";
const local = await setupLocalService();
if (!local) await setupOpenRouter();
const params = new URLSearchParams(location.search);
if (local && (params.has("world") || params.has("shared"))) {
  params.delete("world");
  params.delete("shared");
  history.replaceState(null, "", `${location.pathname}?${params}`);
}
if (params.get("shared") === "1" && !params.has("world")) {
  const { openWorlds } = await import("./shared.mjs");
  await openWorlds();
} else {
  await import("./app.mjs");
}
document.body.inert = false;
