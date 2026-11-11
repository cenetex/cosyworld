// Collect the authored text a browser scene may quote, per field kind. The
// story service accepts a scene's rules-built sentences only when they are
// made of these pieces (card_narrative/authored.rs).
//
// Each kind takes the strings and template literals of the code that builds
// that field (its roots below, and every function, constant and JSON file
// they reach), so a fact template cannot dress up an event and the reverse.
// Voice directions (speech.json), URLs and code identifiers are never
// authored scene text. Rebuild after changing any of those modules or packs;
// `--check` fails when the output is stale.
import { build } from "esbuild";
import * as acorn from "acorn";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = new URL(
  "../orchestrator-rust/src/card_narrative/authored-text.json",
  import.meta.url,
);
const NARRATIVE = "v2/card-game/narrative.mjs";
// Prompt wording, not scene text.
const EXCLUDED_SOURCES = new Set(["v2/card-game/speech.json"]);
// Modules that write rules sentences without calling addLog: an action's
// `text` becomes its log entry.
const LOG = { call: "addLog", property: "text" };
const KINDS = ["action", "events", "facts", "memories", "disclosures"];
// Roots: [module, top-level name, property path inside it or null].
const ROOTS = {
  action: [[NARRATIVE, "narrativeContext", "action"]],
  events: [],
  facts: [[NARRATIVE, "narrativeContext", "entities"]],
  memories: [["v2/card-game/scene-cast.mjs", "speechMemories", null]],
  // A disclosed fact is a witnessed log entry, a pack topic or a lane.
  disclosures: [["v2/card-game/knowledge.mjs", "*", null]],
};
// Fields built from the log: an action is a log entry, and an event memory,
// a witnessed fact and a disclosure quote one.
const FROM_LOG = new Set(KINDS);

const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: [NARRATIVE],
  bundle: true,
  write: false,
  metafile: true,
  platform: "neutral",
  format: "esm",
  logLevel: "silent",
});
const inputs = Object.keys(metafile.inputs).sort();

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== "string") return;
  if (visit(node, parent) === false) return;
  for (const value of Object.values(node))
    for (const child of Array.isArray(value) ? value : [value])
      if (child && typeof child.type === "string") walk(child, visit, node);
}

const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\.(com|org|net|io|ai|xyz)\b/iu;
// camelCase, snake_case, kebab-case, dotted or slashed paths, file names.
// Plain kebab-case words ("needs-it") are rules vocabulary a fact may quote.
const IDENTIFIER =
  /^(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z0-9]*[0-9_./][A-Za-z0-9_./-]*|[A-Za-z0-9]+(?:[_./][A-Za-z0-9]+)+|[A-Z0-9_]{2,})$/u;
const authoredString = (text) =>
  !URL_LIKE.test(text) && !(IDENTIFIER.test(text) && !text.includes(" "));
const authoredPart = (text) => !URL_LIKE.test(text);
// Pack fields that steer a voice or cite a source, never scene text.
const EXCLUDED_KEYS = new Set([
  "adaptation",
  "catalogue",
  "idiolect",
  "likes",
  "persona",
  "pleasure",
  "policy",
  "premise",
  "seed",
  "sore",
  "tone",
  "url",
  "use",
  "voice",
]);

/** A piece of code that holds strings and refers to other pieces. */
class Unit {
  constructor() {
    this.literals = new Set();
    this.templates = [];
    this.refs = new Set();
  }
}
const units = new Map(); // "module#name" -> Unit
const names = new Set();
const unit = (key) => units.get(key) ?? units.set(key, new Unit()).get(key);

// Pack text such as "{actor} spoiled Pip's light." is a template too.
function jsonStrings(into, value, key) {
  if (EXCLUDED_KEYS.has(key)) return;
  if (typeof value === "string") {
    if (key === "name") names.add(value);
    if (!authoredString(value)) return;
    into.literals.add(value);
    const parts = value.split(/\{[A-Za-z]+\}/u);
    if (parts.length > 1)
      into.templates.push([parts, "n".repeat(parts.length - 1)]);
  } else if (Array.isArray(value))
    value.forEach((v) => jsonStrings(into, v, key));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) jsonStrings(into, v, k);
}

const NAMING = new Set(["nameOf"]);
// Per module: whether each local name always holds a name (`what = nameOf(x)`).
const namedLocals = new Map();
let localNames = new Map();
// Per module: the one value of each local declared once, spelled out in
// templates that read it (`${origin} this …`).
const localValues = new Map();
let localInits = new Map();
/** Whether `node` reads as a name: nameOf(x), or a list of them. */
function naming(node) {
  if (node.type === "Identifier") return localNames.get(node.name) === true;
  if (node.type === "CallExpression" && NAMING.has(node.callee.name))
    return true;
  if (node.type === "ChainExpression") return naming(node.expression);
  // A log entry's speaker is a name or "World".
  if (node.type === "MemberExpression" && !node.computed)
    return ["speaker", "name"].includes(node.property.name);
  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression"
  ) {
    const method = node.callee.property.name;
    if (method === "map") return node.arguments.some((a) => NAMING.has(a.name));
    if (["join", "filter", "slice", "sort"].includes(method))
      return naming(node.callee.object);
  }
  return false;
}

const VARIANTS = 64;
const concat = (left, right) =>
  left.flatMap((a) =>
    right.map((b) => ({
      parts: [
        ...a.parts.slice(0, -1),
        a.parts.at(-1) + b.parts[0],
        ...b.parts.slice(1),
      ],
      slots: a.slots + b.slots,
    })),
  );
/**
 * The texts an expression can make, as templates: literals and the branches
 * of a choice are spelled out, and anything else is a slot, `n` when it
 * reads as a name and `a` otherwise.
 */
function shapes(node, depth = 0) {
  const slot = [{ parts: ["", ""], slots: naming(node) ? "n" : "a" }];
  let out = null;
  if (node.type === "Identifier" && localInits.has(node.name) && depth < 4) {
    const spelled = shapes(localInits.get(node.name), depth + 1);
    if (
      spelled.length > 1 ||
      spelled[0].slots !== slot[0].slots ||
      spelled[0].parts.some(Boolean)
    )
      out = spelled;
  } else if (node.type === "Literal" && typeof node.value === "string")
    out = [{ parts: [node.value], slots: "" }];
  else if (node.type === "TemplateLiteral") {
    out = [{ parts: [node.quasis[0].value.cooked ?? ""], slots: "" }];
    node.expressions.forEach((expression, i) => {
      out = concat(concat(out, shapes(expression, depth)), [
        { parts: [node.quasis[i + 1].value.cooked ?? ""], slots: "" },
      ]);
    });
  } else if (node.type === "ConditionalExpression")
    out = [...shapes(node.consequent, depth), ...shapes(node.alternate, depth)];
  else if (node.type === "LogicalExpression" && node.operator !== "&&")
    out = [...shapes(node.left, depth), ...shapes(node.right, depth)];
  else if (node.type === "BinaryExpression" && node.operator === "+")
    out = concat(shapes(node.left, depth), shapes(node.right, depth));
  return out && out.length <= VARIANTS ? out : slot;
}

/** The strings and references of `node`, added to `into`. */
function collect(into, node, scope) {
  walk(node, (n, parent) => {
    if (
      n.type === "TemplateLiteral" &&
      parent?.type !== "TaggedTemplateExpression"
    ) {
      for (const { parts, slots } of shapes(n)) {
        if (!slots) {
          if (authoredString(parts[0])) into.literals.add(parts[0]);
        } else if (
          // `${a} ${b}` would join any two pieces.
          (parts.some((p) => /\p{L}/u.test(p)) || slots.includes("n")) &&
          parts.every(authoredPart)
        )
          into.templates.push([parts, slots]);
      }
    } else if (n.type === "Literal" && typeof n.value === "string") {
      if (parent?.type === "ImportDeclaration") return;
      if (authoredString(n.value)) into.literals.add(n.value);
    } else if (n.type === "Identifier") {
      const target = scope(n.name);
      if (target) into.refs.add(target);
    }
  });
}

const modules = new Map(); // module -> {decls, imports, exports, locals}
const resolveImport = (from, spec) =>
  normalize(join(dirname(from), spec)).replaceAll("\\", "/");

for (const input of inputs) {
  if (EXCLUDED_SOURCES.has(input)) continue;
  const source = await readFile(root + input, "utf8");
  if (input.endsWith(".json")) {
    jsonStrings(unit(`${input}#default`), JSON.parse(source));
    modules.set(input, { json: true });
    continue;
  }
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const decls = new Map();
  const imports = new Map();
  const exports = new Map();
  for (const statement of ast.body) {
    const declaration =
      statement.type.startsWith("Export") && statement.declaration
        ? statement.declaration
        : statement;
    if (statement.type === "ImportDeclaration") {
      const from = resolveImport(input, statement.source.value);
      for (const s of statement.specifiers)
        imports.set(s.local.name, [
          from,
          s.type === "ImportSpecifier" ? s.imported.name : "default",
        ]);
    } else if (
      statement.type === "ExportNamedDeclaration" &&
      statement.source
    ) {
      const from = resolveImport(input, statement.source.value);
      for (const s of statement.specifiers)
        exports.set(s.exported.name, { from, name: s.local.name });
    } else if (
      statement.type === "ExportNamedDeclaration" &&
      !statement.declaration
    ) {
      for (const s of statement.specifiers)
        exports.set(s.exported.name, { name: s.local.name });
    }
    if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration"
    ) {
      decls.set(declaration.id.name, declaration);
      if (statement !== declaration)
        exports.set(declaration.id.name, { name: declaration.id.name });
    } else if (declaration.type === "VariableDeclaration") {
      for (const d of declaration.declarations) {
        const bound = [];
        walk(d.id, (n) => {
          if (n.type === "Identifier") bound.push(n.name);
        });
        for (const name of bound) {
          decls.set(name, d);
          if (statement !== declaration) exports.set(name, { name });
        }
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      decls.set("default", statement.declaration);
    }
  }
  modules.set(input, { ast, decls, imports, exports });
  const locals = new Map();
  walk(ast, (n) => {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init)
      (locals.get(n.id.name) ?? locals.set(n.id.name, []).get(n.id.name)).push(
        n.init,
      );
  });
  localNames = new Map();
  localInits = new Map();
  const named = new Map();
  for (const [name, inits] of locals)
    named.set(
      name,
      inits.every((init) => naming(init)),
    );
  namedLocals.set(input, named);
  localValues.set(
    input,
    new Map(
      [...locals]
        .filter(([, inits]) => inits.length === 1)
        .map(([k, [v]]) => [k, v]),
    ),
  );
}

/** The unit key a name in `input` refers to, or null. */
function target(input, name, seen = new Set()) {
  const module = modules.get(input);
  if (!module) return null;
  if (module.json) return `${input}#default`;
  if (seen.has(`${input}#${name}`)) return null;
  seen.add(`${input}#${name}`);
  if (module.decls.has(name)) return `${input}#${name}`;
  const imported = module.imports.get(name);
  if (imported) return exported(imported[0], imported[1], seen);
  return null;
}
function exported(input, name, seen) {
  const module = modules.get(input);
  if (!module) return null;
  if (module.json) return `${input}#default`;
  const entry = module.exports.get(name);
  if (entry?.from) return exported(entry.from, entry.name, seen);
  return target(input, entry?.name ?? name, seen);
}

for (const [input, module] of modules) {
  if (module.json) continue;
  localNames = namedLocals.get(input);
  localInits = localValues.get(input);
  for (const [name, node] of module.decls) {
    const key = `${input}#${name}`;
    collect(unit(key), node, (ref) =>
      ref === name ? null : target(input, ref),
    );
  }
}

/** Every unit reachable from `start`. */
function closure(start) {
  const seen = new Set();
  const stack = [...start];
  while (stack.length) {
    const key = stack.pop();
    if (!key || seen.has(key) || !units.has(key)) continue;
    seen.add(key);
    stack.push(...units.get(key).refs);
  }
  return seen;
}

// A root inside a function: one property of the object it returns, with the
// function's own locals that property reads.
function propertyUnit(input, name, property) {
  localNames = namedLocals.get(input);
  localInits = localValues.get(input);
  const fn = modules.get(input).decls.get(name);
  const locals = new Map();
  walk(fn.body, (n) => {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier")
      locals.set(n.id.name, n);
  });
  let found = null;
  walk(fn.body, (n, parent) => {
    if (
      n.type === "Property" &&
      parent?.type === "ObjectExpression" &&
      !n.computed &&
      (n.key.name ?? n.key.value) === property
    )
      found ??= n.value;
  });
  if (!found) throw new Error(`${input}: ${name} has no ${property}`);
  const into = new Unit();
  const pending = [found];
  const used = new Set();
  while (pending.length) {
    const node = pending.pop();
    collect(into, node, (ref) => {
      if (locals.has(ref) && !used.has(ref)) {
        used.add(ref);
        pending.push(locals.get(ref).init);
        return null;
      }
      return locals.has(ref) ? null : target(input, ref);
    });
  }
  const key = `${input}#${name}.${property}`;
  units.set(key, into);
  return key;
}

// The log: every function that adds a log entry or builds an action's text.
const logRoots = [];
for (const [input, module] of modules) {
  if (module.json || input === NARRATIVE) continue;
  for (const [name, node] of module.decls) {
    let writes = false;
    walk(node, (n, parent) => {
      if (n.type === "CallExpression" && n.callee.name === LOG.call)
        writes = true;
      if (
        n.type === "Property" &&
        parent?.type === "ObjectExpression" &&
        !n.shorthand &&
        (n.key.name ?? n.key.value) === LOG.property
      )
        writes = true;
    });
    if (writes) logRoots.push(`${input}#${name}`);
  }
}
const logUnits = closure(logRoots);

const catalog = { literals: new Map(), templates: new Map() };
KINDS.forEach((kind, bit) => {
  const keys = closure(
    ROOTS[kind].flatMap(([input, name, property]) =>
      property
        ? [propertyUnit(input, name, property)]
        : name === "*"
          ? [...modules.get(input).decls.keys()].map(
              (decl) => `${input}#${decl}`,
            )
          : [`${input}#${name}`],
    ),
  );
  if (FROM_LOG.has(kind)) for (const key of logUnits) keys.add(key);
  for (const key of keys) {
    const { literals, templates } = units.get(key);
    for (const text of literals)
      catalog.literals.set(
        text,
        (catalog.literals.get(text) ?? 0) | (1 << bit),
      );
    for (const [parts, slots] of templates) {
      const id = JSON.stringify([parts, slots]);
      const [, mask = 0] = catalog.templates.get(id) ?? [];
      catalog.templates.set(id, [parts, mask | (1 << bit), slots]);
    }
  }
});

// Earlier rules wrote this sentence into saves that players still import.
const earlierDrop = ["", " drops the quest."];
catalog.templates.set(JSON.stringify([earlierDrop, "n"]), [
  earlierDrop,
  (1 << KINDS.length) - 1,
  "n",
]);

const sources = inputs.filter((input) => !EXCLUDED_SOURCES.has(input));
const sorted = (map) =>
  [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const body = {
  generated: "node v2/scripts/build-card-authored-text.mjs",
  kinds: KINDS,
  sources,
  names: [...names].sort(),
  literals: sorted(catalog.literals).map(([text, mask]) => [text, mask]),
  templates: sorted(catalog.templates).map(([, entry]) => entry),
};
// One entry per line and sorted, so two branches that change different
// sources or sentences merge in git instead of conflicting on one long line.
const lines = (items) =>
  `[\n${items.map((item) => JSON.stringify(item)).join(",\n")}\n]`;
const text = `{\n${Object.entries(body)
  .map(
    ([key, value]) =>
      `${JSON.stringify(key)}: ${key === "generated" || key === "kinds" ? JSON.stringify(value) : lines(value)}`,
  )
  .join(",\n")}\n}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8").catch(() => "")) !== text)
    throw new Error(
      "Rebuild the authored text with node v2/scripts/build-card-authored-text.mjs.",
    );
} else await writeFile(output, text);
