import { setupOpenRouter } from "./openrouter-settings.mjs";
import { setupLocalService } from "./local-service.mjs";
import { showBuildInfo } from "./build-info.mjs";
const local = await setupLocalService();
if (!local) await setupOpenRouter();
const params = new URLSearchParams(location.search);
if (local && (params.has("world") || params.has("shared"))) {
  params.delete("world");
  params.delete("shared");
  history.replaceState(null, "", `${location.pathname}?${params}`);
}
// The bare address resumes the avatar played last (avatar-world.mjs).
let resume = null;
try {
  if (!local && !params.size)
    resume = JSON.parse(localStorage.getItem("cosyworld.playing") || "null");
} catch {}
if (resume?.world)
  location.replace(`/?world=${encodeURIComponent(resume.world)}`);
else if (resume?.avatar && resume.avatar !== "vale")
  location.replace(`/?avatar=${encodeURIComponent(resume.avatar)}`);
else if (params.get("shared") === "1" && !params.has("world")) {
  const { openWorlds } = await import("./shared.mjs");
  await openWorlds();
} else {
  await import("./app.mjs");
}
document.body.inert = false;
showBuildInfo();
