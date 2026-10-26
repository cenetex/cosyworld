const shared = new URLSearchParams(location.search);
if (shared.has("world") || shared.get("shared") === "1") {
  await import("./shared.mjs");
} else {
  await import("./app.mjs");
  const button = document.createElement("button");
  button.id = "shared-worlds-button";
  button.textContent = "Share";
  button.setAttribute("aria-label", "Share a world");
  button.onclick = () => {
    location.href = "/?shared=1";
  };
  document.querySelector(".top-actions")?.prepend(button);
}
document.body.inert = false;
