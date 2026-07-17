import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultContentRoot = path.resolve(scriptDir, "../content/official");
const defaultSlicePath = path.resolve(
  scriptDir,
  "../worlds/official/proof-slice.json",
);
const contentFiles = [
  "access_gates",
  "actors",
  "clocks",
  "evolution_tracks",
  "exits",
  "fronts",
  "items",
  "jobs",
  "locations",
  "recipes",
  "room_features",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadProofWorldInput(
  contentRoot = defaultContentRoot,
  slicePath = defaultSlicePath,
) {
  const content = Object.fromEntries(
    contentFiles.map((name) => [
      name,
      readJson(path.join(contentRoot, `${name}.json`)),
    ]),
  );
  return { spec: readJson(slicePath), content };
}

function groupBy(rows, keyOf) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return grouped;
}

function reachableLocations(entryLocationId, sliceIds, exits) {
  const reachable = new Set();
  if (!sliceIds.has(entryLocationId)) return reachable;
  const exitsByLocation = groupBy(exits, (exit) => exit.from_location_id);
  const pending = [entryLocationId];
  reachable.add(entryLocationId);
  while (pending.length > 0) {
    const fromLocationId = pending.shift();
    for (const exit of exitsByLocation.get(fromLocationId) ?? []) {
      if (
        !sliceIds.has(exit.to_location_id) ||
        reachable.has(exit.to_location_id)
      )
        continue;
      reachable.add(exit.to_location_id);
      pending.push(exit.to_location_id);
    }
  }
  return reachable;
}

function recipeOutputLocationId(recipe) {
  return recipe.output?.target_kind === "location_floor"
    ? recipe.output.target_id
    : null;
}

function active(row) {
  return row.status === undefined || row.status === "active";
}

export function analyzeProofWorld(spec, content) {
  const sliceIds = new Set(spec.location_ids ?? []);
  const locationById = new Map(
    content.locations.map((location) => [location.id, location]),
  );
  const actorById = new Map(content.actors.map((actor) => [actor.id, actor]));
  const itemById = new Map(content.items.map((item) => [item.id, item]));
  const clockById = new Map(content.clocks.map((clock) => [clock.id, clock]));
  const jobById = new Map(content.jobs.map((job) => [job.id, job]));
  const frontById = new Map(content.fronts.map((front) => [front.id, front]));
  const gatedLocationIds = new Set(
    content.access_gates.map((gate) => gate.location_id),
  );
  const reachable = reachableLocations(
    spec.entry_location_id,
    sliceIds,
    content.exits,
  );
  const missingLocationIds = [...sliceIds].filter(
    (id) => !locationById.has(id),
  );
  const unreachableLocationIds = [...sliceIds]
    .filter((id) => locationById.has(id) && !reachable.has(id))
    .sort((left, right) => left - right);
  const gatedSliceLocationIds = [...sliceIds]
    .filter((id) => gatedLocationIds.has(id))
    .sort((left, right) => left - right);

  const actorsByLocation = groupBy(
    content.actors,
    (actor) => actor.location_id,
  );
  const itemsByLocation = groupBy(content.items, (item) => item.location_id);
  const featuresByLocation = groupBy(
    content.room_features,
    (feature) => feature.location_id,
  );
  const jobsByLocation = new Map();
  for (const job of content.jobs.filter(active)) {
    for (const locationId of job.location_ids ?? []) {
      const bucket = jobsByLocation.get(locationId) ?? [];
      bucket.push(job);
      jobsByLocation.set(locationId, bucket);
    }
  }
  const frontsByLocation = new Map();
  for (const front of content.fronts.filter(active)) {
    for (const locationId of front.location_ids ?? []) {
      const bucket = frontsByLocation.get(locationId) ?? [];
      bucket.push(front);
      frontsByLocation.set(locationId, bucket);
    }
  }
  const recipesByLocation = new Map();
  for (const recipe of content.recipes) {
    const involvedLocationIds = new Set(
      [
        ...(recipe.input_item_ids ?? []).map(
          (itemId) => itemById.get(itemId)?.location_id,
        ),
        recipeOutputLocationId(recipe),
      ].filter((id) => Number.isInteger(id)),
    );
    for (const locationId of involvedLocationIds) {
      const bucket = recipesByLocation.get(locationId) ?? [];
      bucket.push(recipe);
      recipesByLocation.set(locationId, bucket);
    }
  }

  const locationLoops = [...sliceIds]
    .filter((id) => locationById.has(id))
    .sort((left, right) => left - right)
    .map((locationId) => {
      const loopKinds = [];
      if ((actorsByLocation.get(locationId) ?? []).length > 0)
        loopKinds.push("resident_relationship");
      if ((itemsByLocation.get(locationId) ?? []).length > 0)
        loopKinds.push("item_circulation");
      if ((featuresByLocation.get(locationId) ?? []).length > 0)
        loopKinds.push("feature_interaction");
      if (
        (jobsByLocation.get(locationId) ?? []).length > 0 ||
        (frontsByLocation.get(locationId) ?? []).length > 0
      ) {
        loopKinds.push("front_response");
      }
      if ((recipesByLocation.get(locationId) ?? []).length > 0)
        loopKinds.push("crafting");
      return {
        location_id: locationId,
        location_name: locationById.get(locationId).name,
        loop_kinds: loopKinds,
      };
    });
  const deadLocations = locationLoops.filter(
    (location) =>
      location.loop_kinds.length < spec.minimum_loop_kinds_per_location,
  );

  const relevantJobs = content.jobs.filter(
    (job) =>
      active(job) &&
      (job.location_ids ?? []).some((locationId) => sliceIds.has(locationId)),
  );
  const jobClockIssues = [];
  for (const job of relevantJobs) {
    const problems = [];
    const outsideLocations = (job.location_ids ?? []).filter(
      (locationId) => !sliceIds.has(locationId),
    );
    const unreachableLocations = (job.location_ids ?? []).filter(
      (locationId) => !reachable.has(locationId),
    );
    if (outsideLocations.length > 0)
      problems.push(`locations outside slice: ${outsideLocations.join(", ")}`);
    if (unreachableLocations.length > 0)
      problems.push(
        `unreachable locations: ${unreachableLocations.join(", ")}`,
      );
    for (const [kind, clockId] of [
      ["progress", job.progress_clock_id],
      ["danger", job.danger_clock_id],
    ]) {
      const clock = clockById.get(clockId);
      if (!clock) {
        problems.push(`missing ${kind} clock ${clockId}`);
      } else if (clock.scope === "room" && !reachable.has(clock.scope_id)) {
        problems.push(
          `${kind} clock ${clockId} is scoped to unreachable room ${clock.scope_id}`,
        );
      }
    }
    const unreachableParticipants = (job.participant_ids ?? []).filter(
      (actorId) => {
        const actor = actorById.get(actorId);
        return !actor || !reachable.has(actor.location_id);
      },
    );
    if (unreachableParticipants.length > 0) {
      problems.push(
        `unreachable participants: ${unreachableParticipants.join(", ")}`,
      );
    }
    if (problems.length > 0) jobClockIssues.push({ job_id: job.id, problems });
  }

  const frontIssues = [];
  for (const frontId of spec.required_front_ids ?? []) {
    const front = frontById.get(frontId);
    const problems = [];
    if (!front) {
      problems.push("missing front");
    } else {
      if (!active(front)) problems.push(`front is ${front.status}`);
      const unreachableLocations = (front.location_ids ?? []).filter(
        (locationId) => !reachable.has(locationId),
      );
      if (unreachableLocations.length > 0)
        problems.push(
          `unreachable locations: ${unreachableLocations.join(", ")}`,
        );
      if ((front.stakes_questions ?? []).length < 2)
        problems.push("fewer than two authored response questions");
      for (const jobId of front.job_ids ?? []) {
        if (!jobById.has(jobId)) problems.push(`missing job ${jobId}`);
      }
      const portent = clockById.get(front.portent_clock_id);
      if (!portent)
        problems.push(`missing portent clock ${front.portent_clock_id}`);
      else if (portent.scope === "room" && !reachable.has(portent.scope_id)) {
        problems.push(
          `portent clock is scoped to unreachable room ${portent.scope_id}`,
        );
      }
    }
    if (problems.length > 0) frontIssues.push({ front_id: frontId, problems });
  }

  const criticalInputIds = new Set();
  for (const recipe of content.recipes) {
    const inputLocations = (recipe.input_item_ids ?? []).map(
      (itemId) => itemById.get(itemId)?.location_id,
    );
    if (
      sliceIds.has(recipeOutputLocationId(recipe)) ||
      inputLocations.some((locationId) => sliceIds.has(locationId))
    ) {
      for (const itemId of recipe.input_item_ids ?? [])
        criticalInputIds.add(itemId);
    }
  }
  for (const track of content.evolution_tracks) {
    const actor = actorById.get(track.actor_id);
    if (!actor || !sliceIds.has(actor.location_id)) continue;
    for (const requirement of track.requirements ?? [])
      criticalInputIds.add(requirement.item_id);
  }
  const criticalInputs = [...criticalInputIds]
    .sort((left, right) => left - right)
    .map((itemId) => {
      const item = itemById.get(itemId);
      const sourceLocationId = item?.location_id ?? null;
      const available = Boolean(
        item &&
          sliceIds.has(sourceLocationId) &&
          reachable.has(sourceLocationId) &&
          !gatedLocationIds.has(sourceLocationId),
      );
      return {
        item_id: itemId,
        item_name: item?.name ?? null,
        source_location_id: sourceLocationId,
        available,
        renewal: available ? "persistent_non_consuming_world_item" : null,
      };
    });
  const nonrenewableCriticalInputs = criticalInputs.filter(
    (input) => !input.available,
  );

  const productionLoops = content.recipes
    .filter((recipe) => {
      const inputIds = recipe.input_item_ids ?? [];
      return (
        inputIds.length > 0 &&
        recipe.output == null &&
        inputIds.every((itemId) =>
          criticalInputs.some(
            (input) => input.item_id === itemId && input.available,
          ),
        ) &&
        recipe.balance?.target_kind === "location_floor" &&
        sliceIds.has(recipe.balance.target_id) &&
        reachable.has(recipe.balance.target_id)
      );
    })
    .map((recipe) => recipe.id);

  const roomCount = sliceIds.size;
  const checks = {
    room_count:
      roomCount >= spec.minimum_location_count &&
      roomCount <= spec.maximum_location_count,
    locations_exist: missingLocationIds.length === 0,
    entry_is_public:
      sliceIds.has(spec.entry_location_id) &&
      !gatedLocationIds.has(spec.entry_location_id),
    pact_is_in_slice: sliceIds.has(spec.pact_location_id),
    all_rooms_reachable: unreachableLocationIds.length === 0,
    rooms_have_two_loops: deadLocations.length === 0,
    job_clock_paths_work: jobClockIssues.length === 0,
    required_fronts_work: frontIssues.length === 0,
    critical_inputs_are_renewable: nonrenewableCriticalInputs.length === 0,
    enough_production_loops:
      productionLoops.length >= spec.minimum_production_loops,
  };
  const gaps = [];
  if (!checks.room_count)
    gaps.push(
      `slice has ${roomCount} rooms; expected ${spec.minimum_location_count}-${spec.maximum_location_count}`,
    );
  if (!checks.locations_exist)
    gaps.push(`missing rooms: ${missingLocationIds.join(", ")}`);
  if (!checks.entry_is_public)
    gaps.push(`entry room ${spec.entry_location_id} is absent or gated`);
  if (!checks.pact_is_in_slice)
    gaps.push(`pact room ${spec.pact_location_id} is outside the slice`);
  if (!checks.all_rooms_reachable)
    gaps.push(`unreachable rooms: ${unreachableLocationIds.join(", ")}`);
  if (!checks.rooms_have_two_loops)
    gaps.push(
      `dead rooms: ${deadLocations.map((room) => room.location_id).join(", ")}`,
    );
  if (!checks.job_clock_paths_work)
    gaps.push(
      `broken job/clock paths: ${jobClockIssues.map((issue) => issue.job_id).join(", ")}`,
    );
  if (!checks.required_fronts_work)
    gaps.push(
      `front gaps: ${frontIssues.map((issue) => issue.front_id).join(", ")}`,
    );
  if (!checks.critical_inputs_are_renewable)
    gaps.push(
      `nonrenewable critical inputs: ${nonrenewableCriticalInputs.map((input) => input.item_id).join(", ")}`,
    );
  if (!checks.enough_production_loops)
    gaps.push(
      `only ${productionLoops.length}/${spec.minimum_production_loops} production loops are defined`,
    );

  return {
    id: spec.id,
    name: spec.name,
    ready: Object.values(checks).every(Boolean),
    checks,
    gaps,
    room_count: roomCount,
    reachable_location_ids: [...reachable].sort((left, right) => left - right),
    unreachable_location_ids: unreachableLocationIds,
    gated_location_ids: gatedSliceLocationIds,
    location_loops: locationLoops,
    dead_locations: deadLocations,
    job_clock_issues: jobClockIssues,
    front_issues: frontIssues,
    critical_inputs: criticalInputs,
    nonrenewable_critical_inputs: nonrenewableCriticalInputs,
    production_loop_ids: productionLoops,
  };
}

function printReport(report) {
  console.log(`${report.name}: ${report.ready ? "ready" : "not ready"}`);
  console.log(
    `rooms: ${report.room_count}; reachable: ${report.reachable_location_ids.length}; production loops: ${report.production_loop_ids.length}`,
  );
  console.log(
    `dead rooms: ${report.dead_locations.length ? report.dead_locations.map((room) => room.location_id).join(", ") : "none"}`,
  );
  console.log(
    `broken job/clock paths: ${report.job_clock_issues.length ? report.job_clock_issues.map((issue) => issue.job_id).join(", ") : "none"}`,
  );
  console.log(
    `nonrenewable critical inputs: ${report.nonrenewable_critical_inputs.length ? report.nonrenewable_critical_inputs.map((input) => input.item_id).join(", ") : "none"}`,
  );
  for (const gap of report.gaps) console.log(`gap: ${gap}`);
}

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const { spec, content } = loadProofWorldInput(
    positional[0] ? path.resolve(positional[0]) : defaultContentRoot,
    positional[1] ? path.resolve(positional[1]) : defaultSlicePath,
  );
  const report = analyzeProofWorld(spec, content);
  if (args.includes("--report-json"))
    console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  if (args.includes("--strict") && !report.ready) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
