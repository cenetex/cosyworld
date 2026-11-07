// Three authored approaches give the editor a stable alternative-route case.
export function routeAlternativesFixture(input) {
  const source = structuredClone(input),
    base = source.pack.routes.find((route) => route.sealed);
  source.pack.routes = source.pack.routes.filter(
    (route) =>
      route === base || route.from !== base.from || route.to !== base.to,
  );
  for (const key of ["test-first-route", "test-second-route"])
    source.pack.routes.push({
      ...structuredClone(base),
      requires: [...base.requires, { kind: "flag", key, value: true }],
    });
  const indices = source.pack.routes.flatMap((route, index) =>
    route.from === base.from && route.to === base.to ? [index] : [],
  );
  return { source, from: base.from, to: base.to, indices };
}
