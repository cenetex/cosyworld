const params = new URLSearchParams(location.search);
if (params.get("shared") === "1" && !params.has("world")) {
  const { openWorlds } = await import("./shared.mjs");
  await openWorlds();
} else {
  await import("./app.mjs");
}
document.body.inert = false;
