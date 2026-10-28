import { setupOpenRouter } from "./openrouter-settings.mjs";
import { setupLocalService } from "./local-service.mjs";
if (!(await setupLocalService())) await setupOpenRouter();
const params = new URLSearchParams(location.search);
if (params.get("shared") === "1" && !params.has("world")) {
  const { openWorlds } = await import("./shared.mjs");
  await openWorlds();
} else {
  await import("./app.mjs");
}
document.body.inert = false;
