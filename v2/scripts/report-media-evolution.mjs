import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(scriptDir, "../media/evolution-canary.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const metricPasses = (metrics, threshold) =>
  metrics.stable_trait >= threshold.stable_trait_min
  && metrics.requested_change >= threshold.requested_change_min
  && metrics.style >= threshold.style_min
  && metrics.invention <= threshold.invention_max
  && metrics.composition >= threshold.composition_min
  && metrics.safety >= threshold.safety_min
  && metrics.blind_preference >= threshold.blind_preference_min
  && metrics.latency_p95_ms <= threshold.latency_p95_max_ms
  && metrics.cost_ratio <= threshold.cost_ratio_max
  && metrics.error_rate <= threshold.error_rate_max
  && metrics.retry_spend_ratio <= threshold.retry_spend_ratio_max;
const average = (rows, field) =>
  rows.reduce((total, row) => total + row[field], 0) / rows.length;
const bar = (value) => {
  const filled = Math.round(value * 20);
  return `${"█".repeat(filled)}${"░".repeat(20 - filled)}`;
};

assert(contract.schema_version === 1, "evolution canary schema_version must be 1");
assert(
  contract.incumbent_recipe === "replicate.flux1-dev-lora.base",
  "incumbent recipe must remain FLUX.1",
);
assert(
  contract.candidate_recipe === "replicate.flux2-dev.references",
  "candidate recipe must be pinned FLUX.2",
);
assert(
  /^[0-9a-f]{64}$/.test(contract.candidate_model_revision),
  "candidate model revision must be an exact digest",
);
assert(
  contract.rollout.completed_stages.includes("shadow")
    && contract.rollout.active_stage === "canary"
    && contract.rollout.canary_percent > 0
    && contract.rollout.canary_percent < 100
    && contract.rollout.automatic_disable
    && contract.rollout.rollback_route === "incumbent",
  "rollout must record shadow completion, bounded canary, automatic disable, and incumbent rollback",
);

const profiles = Object.keys(contract.thresholds).sort();
assert(profiles.length >= 6, "evaluation requires avatar/item/location dark and light profiles");
const summaries = [];
for (const profile of profiles) {
  const threshold = contract.thresholds[profile];
  const rows = contract.corpus.filter((row) => row.evaluation_profile === profile);
  assert(rows.length >= 2, `${profile} needs small and large delta fixtures`);
  assert(rows.some((row) => row.delta_size === "small"), `${profile} needs a small delta`);
  assert(rows.some((row) => row.delta_size === "large"), `${profile} needs a large delta`);
  for (const row of rows) {
    assert(row.reviewer_count >= 3, `${row.id} needs at least three blind reviewers`);
    assert(["actor", "item", "location"].includes(row.subject_kind), `${row.id} has bad kind`);
    for (const metrics of [row.incumbent, row.candidate]) {
      for (const value of Object.values(metrics)) {
        assert(finite(value), `${row.id} contains a non-numeric metric`);
      }
    }
    assert(metricPasses(row.candidate, threshold), `${row.id} candidate misses ${profile} gate`);
    assert(
      row.candidate.stable_trait >= row.incumbent.stable_trait
        && row.candidate.requested_change > row.incumbent.requested_change
        && row.candidate.blind_preference > row.incumbent.blind_preference,
      `${row.id} candidate does not beat incumbent on identity/change/blind preference`,
    );
  }
  summaries.push({
    profile,
    cases: rows.length,
    incumbentIdentity: average(rows.map((row) => row.incumbent), "stable_trait"),
    candidateIdentity: average(rows.map((row) => row.candidate), "stable_trait"),
    incumbentChange: average(rows.map((row) => row.incumbent), "requested_change"),
    candidateChange: average(rows.map((row) => row.candidate), "requested_change"),
    preference: average(rows.map((row) => row.candidate), "blind_preference"),
    latency: Math.max(...rows.map((row) => row.candidate.latency_p95_ms)),
    cost: average(rows.map((row) => row.candidate), "cost_ratio"),
  });
}

const lines = [
  "# FLUX.2 single-reference evolution canary",
  "",
  `Pinned candidate: \`${contract.candidate_recipe}@${contract.candidate_model_revision}\``,
  `Rollout: shadow complete → ${contract.rollout.canary_percent}% canary; automatic profile rollback to \`${contract.rollout.rollback_route}\`.`,
  "",
  "| Profile | Cases | Identity FLUX.1 → FLUX.2 | Requested change FLUX.1 → FLUX.2 | Blind preference | p95 latency | Cost ratio | Gate |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ...summaries.map((row) =>
    `| ${row.profile} | ${row.cases} | ${row.incumbentIdentity.toFixed(2)} → ${row.candidateIdentity.toFixed(2)} | ${row.incumbentChange.toFixed(2)} → ${row.candidateChange.toFixed(2)} | ${(row.preference * 100).toFixed(0)}% | ${(row.latency / 1000).toFixed(0)}s | ${row.cost.toFixed(2)}× | PASS |`
  ),
  "",
  "Requested-change fidelity (FLUX.2)",
  "",
  "```text",
  ...summaries.map((row) =>
    `${row.profile.padEnd(25)} ${bar(row.candidateChange)} ${(row.candidateChange * 100).toFixed(0)}%`
  ),
  "```",
  "",
  `PASS: ${contract.corpus.length} blind-reviewed fixtures, ${profiles.length} independently gated profiles; no global-average fallback.`,
];

process.stdout.write(`${lines.join("\n")}\n`);
