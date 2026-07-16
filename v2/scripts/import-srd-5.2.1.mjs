import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const sourcePath = path.join(repoRoot, "reference-library/rpg-systems/raw/srd-5.2.1-cosyworld.json");
const packRoot = path.join(repoRoot, "v2/content/rules-srd-5.2.1");
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

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function requiredString(label, value) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
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

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const packManifest = JSON.parse(fs.readFileSync(path.join(packRoot, "pack.json"), "utf8"));
const packAttribution = fs.readFileSync(path.join(packRoot, "ATTRIBUTION.md"), "utf8");
if (
  source.document !== "System Reference Document 5.2.1"
  || source.source_url !== "https://www.dndbeyond.com/srd"
  || source.license !== "CC-BY-4.0"
  || !source.attribution?.includes("creativecommons.org/licenses/by/4.0/legalcode")
) {
  throw new Error("SRD 5.2.1 selected source metadata is invalid");
}
if (
  packManifest.license !== "CC-BY-4.0"
  || packManifest.license_url !== "https://creativecommons.org/licenses/by/4.0/"
  || packManifest.provenance?.author !== "Wizards of the Coast LLC"
  || !packManifest.provenance?.modification_notice
  || packManifest.attribution?.file !== "ATTRIBUTION.md"
  || !packAttribution.includes("System Reference Document 5.2.1")
  || !packAttribution.includes("Wizards of the Coast LLC")
  || !packAttribution.includes("creativecommons.org/licenses/by/4.0/legalcode")
) {
  throw new Error("SRD 5.2.1 pack is missing its required CC-BY-4.0 attribution record");
}

const conditions = conditionNames.map((name) => {
  const condition = source.conditions.find((candidate) => candidate.name === name);
  if (!condition) throw new Error(`missing SRD 5.2.1 condition: ${name}`);
  return {
    id: `condition/${slug(name)}`,
    name,
    source_section: "Rules Glossary: Condition",
    source_text: requiredString(`${name} source text`, condition.source_text),
    mapping:
      name === "Unconscious"
        ? { status: "kernel", kernel_condition: "unconscious" }
        : { status: "reference_only" },
  };
});

const monsterSeeds = monsterNames.map((name) => {
  const monster = source.monsters.find((candidate) => candidate.name === name);
  if (!monster) throw new Error(`missing SRD 5.2.1 monster: ${name}`);
  const abilityScores = {};
  for (const ability of ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]) {
    const score = monster.ability_scores?.[ability];
    if (!Number.isInteger(score) || score < 1 || score > 30) throw new Error(`${name} has invalid ${ability}`);
    abilityScores[ability] = score;
  }
  return {
    id: `monster/${slug(name)}`,
    name,
    source_name: name,
    size: requiredString(`${name} size`, monster.size),
    creature_type: requiredString(`${name} creature type`, monster.creature_type),
    alignment: requiredString(`${name} alignment`, monster.alignment),
    armor_class: requiredString(`${name} armor class`, monster.armor_class),
    hit_points: requiredString(`${name} hit points`, monster.hit_points),
    speed: requiredString(`${name} speed`, monster.speed),
    ability_scores: abilityScores,
    challenge: requiredString(`${name} challenge`, monster.challenge),
    senses: requiredString(`${name} senses`, monster.senses),
    features: monster.features.map((feature) => ({
      name: requiredString(`${name} feature name`, feature.name),
      description: requiredString(`${name} feature description`, feature.description),
    })),
    mapping: {
      status: "reference_only",
      suggested_role: name === "Unicorn" ? "guardian" : "resident",
    },
  };
});

writeOrCheck("conditions.json", conditions);
writeOrCheck("monster_seeds.json", monsterSeeds);
console.log(`SRD 5.2.1 adapter ${checkOnly ? "current" : "generated"}: 15 conditions, 3 monster seeds`);
