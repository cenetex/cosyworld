const dir = "v2/orchestrator-rust/src/card_shared";

export const rulesName = (n) => `RULES_${n}`;

const swap = (text, from, to) => {
  if (typeof from === "string" ? !text.includes(from) : text.search(from) < 0)
    throw new Error(`Could not find ${from}.`);
  return text.replace(from, to);
};

export function wireRules(files, live, hash) {
  const name = rulesName(live);
  const prev = new RegExp(
    `const (\\w+)_VERSION: &str = "full-card-world/${live - 1}";`,
    "u",
  ).exec(files[`${dir}/engine.rs`])?.[1];
  if (!prev) throw new Error(`engine.rs does not name rules ${live - 1}.`);
  const edits = {
    [`${dir}/engine.rs`]: (t) =>
      [
        [
          `VERSION: &str = "full-card-world/${live}";`,
          `VERSION: &str = "full-card-world/${live + 1}";\npub(super) const ${name}_VERSION: &str = "full-card-world/${live}";`,
        ],
        [
          `const SOURCE: &str = include_str!("engine-v${live}.js");`,
          `const SOURCE: &str = include_str!("engine-v${live + 1}.js");\nconst ${name}_SOURCE: &str = include_str!("engine-v${live}.js");`,
        ],
        [
          `| ${prev}_VERSION\n`,
          `| ${prev}_VERSION\n            | ${name}_VERSION\n`,
        ],
        [
          `        ${prev}_VERSION => ${prev}_SOURCE,`,
          `        ${name}_VERSION => ${name}_SOURCE,\n        ${prev}_VERSION => ${prev}_SOURCE,`,
        ],
      ].reduce((text, [from, to]) => swap(text, from, to), t),
    [`${dir}/full_world.rs`]: (t) =>
      swap(
        t,
        new RegExp(`\\n(\\s*)engine::${prev}_VERSION,`, "gu"),
        (line, indent) => `${line}\n${indent}engine::${name}_VERSION,`,
      ),
    "v2/scripts/build-card-shared-engine.mjs": (t) =>
      swap(t, `engine-v${live}.js`, `engine-v${live + 1}.js`),
    "test/card-released-rules.test.mjs": (t) =>
      swap(
        t,
        /(\n  \d+: "[0-9a-f]{64}",\n)(\};)/u,
        `$1  ${live}: "${hash}",\n$2`,
      ),
  };
  return Object.fromEntries(
    Object.entries(edits).map(([path, edit]) => [path, edit(files[path])]),
  );
}
