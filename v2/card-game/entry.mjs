import { setupOpenRouter } from "./openrouter-settings.mjs";
import { setupLocalService } from "./local-service.mjs";
import { showBuildInfo } from "./build-info.mjs";
const local = await setupLocalService();
if (!local) await setupOpenRouter();
const params = new URLSearchParams(location.search);
// The old "Your worlds" address (`?shared=1`) is ☰ now (#1877).
if (params.has("shared") || (local && params.has("world"))) {
  params.delete("shared");
  if (local) params.delete("world");
  history.replaceState(null, "", `${location.pathname}?${params}`);
}
// The bare address resumes the shared world played last; otherwise it is
// Vale's local table (avatar-world.mjs, #1892).
let resume = null;
try {
  if (!local && !params.size)
    resume = JSON.parse(localStorage.getItem("cosyworld.playing") || "null");
} catch {}
if (resume?.world)
  location.replace(`/?world=${encodeURIComponent(resume.world)}`);
else await import("./app.mjs");
document.body.inert = false;
showBuildInfo();
