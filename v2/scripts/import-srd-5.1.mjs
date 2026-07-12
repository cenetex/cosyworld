import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const sourceRoot = path.join(repoRoot, "reference-library/rpg-systems/sources/cc-srd-5e");
const packRoot = path.join(repoRoot, "v2/content/rules-srd-5.1");
const checkOnly = process.argv.includes("--check");

const conditionNames = [
  "Blinded",
  "Charmed",
  "Deafened",
  "Exhaustion",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
];

const monsterNames = ["Dryad", "Sprite", "Unicorn"];
const abilityNames = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceRoot, fileName), "utf8"));
}

function rowText(row) {
  return (row?.subelements ?? [])
    .map((part) => String(part?.text ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^•\s*/, "")
    .replaceAll("advantage,and", "advantage, and")
    .replaceAll("long--term", "long-term")
    .replaceAll("DeathIf", "Death. If")
    .replaceAll("itcan’t", "it can’t")
    .replaceAll("incapacitated(see", "incapacitated (see")
    .replaceAll("grapple ror", "grappler or")
    .replaceAll("thunder-wave", "thunderwave")
    .replaceAll("Aninvisible", "An invisible")
    .replaceAll("andDexterity", "and Dexterity")
    .replaceAll("ifthe", "if the")
    .replaceAll("Itsweight", "Its weight")
    .replaceAll("),can’t", "), can’t")
    .trim();
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildConditions(rows) {
  const sectionStart = rows.findIndex(
    (row) => row.type === "h1" && /Appendix PH\s*-A:\s*Conditions/i.test(rowText(row)),
  );
  if (sectionStart < 0) throw new Error("SRD 5.1 conditions section was not found");

  const results = [];
  for (let index = sectionStart + 1; index < rows.length; index += 1) {
    const heading = rows[index];
    if (heading.type === "h1") break;
    const name = rowText(heading);
    if (heading.type !== "h4" || !conditionNames.includes(name)) continue;

    const text = [];
    for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
      const row = rows[cursor];
      if (row.type === "h1" || row.type === "h4") break;
      const value = rowText(row);
      if (value) text.push(value);
    }
    results.push({
      id: `condition/${slug(name)}`,
      name,
      source_section: "Appendix PH-A: Conditions",
      source_text: text.join(" "),
      mapping:
        name === "Unconscious"
          ? { status: "kernel", kernel_condition: "unconscious" }
          : { status: "reference_only" },
    });
  }

  const missing = conditionNames.filter((name) => !results.some((row) => row.name === name));
  if (missing.length) throw new Error(`missing SRD conditions: ${missing.join(", ")}`);
  return results;
}

function buildMonsterSeeds(monsters) {
  return monsterNames.map((name) => {
    const monster = monsters.find((candidate) => candidate.name === name);
    if (!monster) throw new Error(`missing SRD monster: ${name}`);
    const abilityScores = Object.fromEntries(
      Object.entries(abilityNames).map(([shortName, longName]) => {
        const score = Number.parseInt(monster.stats?.[shortName], 10);
        if (!Number.isInteger(score)) throw new Error(`${name} has invalid ${shortName}`);
        return [longName, score];
      }),
    );
    return {
      id: `monster/${slug(name)}`,
      name,
      source_name: monster.name,
      size: monster.size,
      creature_type: monster.type,
      alignment: monster.alignment,
      armor_class: monster.armor_class,
      hit_points: monster.hit_points,
      speed: monster.speed,
      ability_scores: abilityScores,
      challenge: monster.challenge,
      senses: monster.senses ?? "",
      features: [...(monster.abilities ?? []), ...(monster.actions ?? [])].map((feature) => ({
        name: String(feature.name ?? "").trim(),
        description: String(feature.description ?? "")
          .replace(/\s+/g, " ")
          .replace(/([a-z)])(\d+\/day)/gi, "$1; $2")
          .trim(),
      })),
      mapping: {
        status: "reference_only",
        suggested_role: name === "Unicorn" ? "guardian" : "resident",
      },
    };
  });
}

function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeOrCheck(fileName, value) {
  const filePath = path.join(packRoot, fileName);
  const expected = serialized(value);
  if (checkOnly) {
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== expected) {
      throw new Error(`${path.relative(repoRoot, filePath)} is stale; run npm run v2:srd:import`);
    }
    return;
  }
  fs.writeFileSync(filePath, expected);
}

const readme = fs.readFileSync(path.join(sourceRoot, "README.md"), "utf8");
if (!readme.includes("Creative Commons Attribution 4.0 International License")) {
  throw new Error("CC-SRD source README no longer confirms CC-BY-4.0");
}

const documentRows = readJson("SRD5.1-CCBY4.0License-TT.json");
const monsterDocument = readJson("Monsters-SRD5.1-CCBY4.0License-TT.json");
writeOrCheck("conditions.json", buildConditions(documentRows));
writeOrCheck("monster_seeds.json", buildMonsterSeeds(monsterDocument.monsters));
console.log(`SRD 5.1 adapter ${checkOnly ? "current" : "generated"}: 15 conditions, 3 monster seeds`);
