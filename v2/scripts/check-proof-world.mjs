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
  "room_sheets",
];

const supportedVisitActions = new Set([
  "arrive",
  "care",
  "grow",
  "help",
  "notice",
  "remember",
  "take",
  "trade",
  "travel",
  "work",
]);

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
  const recipeById = new Map(
    content.recipes.map((recipe) => [recipe.id, recipe]),
  );
  const roomSheetByLocationId = new Map(
    content.room_sheets.map((sheet) => [sheet.location_id, sheet]),
  );
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

  const pactIssues = [];
  const pact = spec.pact;
  if (!pact || typeof pact !== "object") {
    pactIssues.push("missing pact definition");
  } else {
    if (!pact.id || !pact.name) pactIssues.push("pact identity is incomplete");
    if (pact.home_location_id !== spec.pact_location_id) {
      pactIssues.push("pact home does not match pact_location_id");
    }
    if (!sliceIds.has(pact.home_location_id)) {
      pactIssues.push(`pact home ${pact.home_location_id} is outside the slice`);
    }
    if (gatedLocationIds.has(pact.home_location_id)) {
      pactIssues.push(`pact home ${pact.home_location_id} is entitlement gated`);
    }
    if (pact.join_requires_entitlement !== false) {
      pactIssues.push("joining the pact must not require an entitlement");
    }
    const homeSheet = roomSheetByLocationId.get(pact.home_location_id);
    if (!homeSheet || homeSheet.zone !== "sanctuary") {
      pactIssues.push("pact home must have a sanctuary room sheet");
    }
    const careRecipeIds = pact.care_recipe_ids ?? [];
    if (careRecipeIds.length < spec.minimum_production_loops) {
      pactIssues.push(
        `pact has ${careRecipeIds.length}/${spec.minimum_production_loops} care recipes`,
      );
    }
    for (const recipeId of careRecipeIds) {
      if (!productionLoops.includes(recipeId)) {
        pactIssues.push(`care recipe ${recipeId} is not repeatable in the slice`);
      }
    }
    if (!careRecipeIds.includes(pact.first_visit_contribution_recipe_id)) {
      pactIssues.push("first-visit contribution is not one of the pact care recipes");
    }
    if (pact.public_trace_event !== "item.crafted") {
      pactIssues.push("pact care must emit the public item.crafted trace");
    }
    if (pact.return_beat_projection !== "room_memory") {
      pactIssues.push("pact care must return through the room-memory projection");
    }
  }

  const frontPathIssues = [];
  const frontPaths = new Map(
    (spec.front_paths ?? []).map((pathSpec) => [pathSpec.front_id, pathSpec]),
  );
  for (const frontId of spec.required_front_ids ?? []) {
    const pathSpec = frontPaths.get(frontId);
    const front = frontById.get(frontId);
    const problems = [];
    if (!pathSpec) {
      problems.push("missing front play path");
    } else {
      const job = jobById.get(pathSpec.job_id);
      if (!job || !active(job)) problems.push(`missing active job ${pathSpec.job_id}`);
      if (front && !(front.job_ids ?? []).includes(pathSpec.job_id)) {
        problems.push(`job ${pathSpec.job_id} does not belong to the front`);
      }
      if (pathSpec.solo_action !== "work") {
        problems.push("solo path must use the authoritative work action");
      }
      if (pathSpec.cooperative_action !== "help") {
        problems.push("cooperative path must use the authoritative help action");
      }
      if (pathSpec.minimum_cooperative_players < 2) {
        problems.push("cooperative path must exercise at least two players");
      }
    }
    if (problems.length > 0) frontPathIssues.push({ front_id: frontId, problems });
  }

  const visitScriptIssues = [];
  const visitScripts = [...(spec.visit_scripts ?? [])].sort(
    (left, right) => left.visit - right.visit,
  );
  const expectedVisitNumbers = [1, 2, 3, 4, 5, 6, 7];
  if (
    visitScripts.length !== expectedVisitNumbers.length ||
    visitScripts.some((visit, index) => visit.visit !== expectedVisitNumbers[index])
  ) {
    visitScriptIssues.push({
      visit: null,
      problems: ["visit scripts must define visits 1 through 7 exactly once"],
    });
  }
  const exitPairs = new Set(
    content.exits.map(
      (exit) => `${exit.from_location_id}:${exit.to_location_id}`,
    ),
  );
  const coveredRecipeIds = new Set();
  const coveredFrontIds = new Set();
  for (const visit of visitScripts) {
    const problems = [];
    const locationIds = visit.location_ids ?? [];
    if (!visit.label) problems.push("missing visit label");
    if (locationIds.length === 0) {
      problems.push("visit has no route");
    } else if (
      pact &&
      (locationIds[0] !== pact.home_location_id ||
        locationIds.at(-1) !== pact.home_location_id)
    ) {
      problems.push("visit must begin and end at the pact home");
    }
    for (const locationId of locationIds) {
      if (!sliceIds.has(locationId))
        problems.push(`room ${locationId} is outside the slice`);
      else if (!reachable.has(locationId))
        problems.push(`room ${locationId} is unreachable`);
      if (gatedLocationIds.has(locationId))
        problems.push(`room ${locationId} is entitlement gated`);
    }
    for (let index = 1; index < locationIds.length; index += 1) {
      const from = locationIds[index - 1];
      const to = locationIds[index];
      if (!exitPairs.has(`${from}:${to}`)) {
        problems.push(`route step ${from} -> ${to} has no authored exit`);
      }
    }
    const actionKinds = visit.action_kinds ?? [];
    for (const action of actionKinds) {
      if (!supportedVisitActions.has(action))
        problems.push(`unsupported action ${action}`);
    }
    for (const recipeId of visit.recipe_ids ?? []) {
      coveredRecipeIds.add(recipeId);
      if (!productionLoops.includes(recipeId))
        problems.push(`recipe ${recipeId} is not a repeatable slice loop`);
    }
    for (const itemId of visit.required_item_ids ?? []) {
      const item = itemById.get(itemId);
      if (!item) problems.push(`missing required item ${itemId}`);
      else if (!sliceIds.has(item.location_id) || !reachable.has(item.location_id))
        problems.push(`required item ${itemId} starts outside the reachable slice`);
      else if (gatedLocationIds.has(item.location_id))
        problems.push(`required item ${itemId} starts behind an entitlement gate`);
    }
    for (const frontId of visit.front_ids ?? []) {
      coveredFrontIds.add(frontId);
      const pathSpec = frontPaths.get(frontId);
      if (!pathSpec) {
        problems.push(`front ${frontId} has no play path`);
      } else {
        if (!actionKinds.includes(pathSpec.solo_action))
          problems.push(`front ${frontId} visit omits its solo action`);
        if (!actionKinds.includes(pathSpec.cooperative_action))
          problems.push(`front ${frontId} visit omits its cooperative action`);
      }
    }
    if (problems.length > 0)
      visitScriptIssues.push({ visit: visit.visit ?? null, problems });
  }
  if (
    pact &&
    !visitScripts
      .find((visit) => visit.visit === 1)
      ?.recipe_ids?.includes(pact.first_visit_contribution_recipe_id)
  ) {
    visitScriptIssues.push({
      visit: 1,
      problems: ["first visit does not contribute to the pact"],
    });
  }
  for (const recipeId of pact?.care_recipe_ids ?? []) {
    if (!coveredRecipeIds.has(recipeId)) {
      visitScriptIssues.push({
        visit: null,
        problems: [`care recipe ${recipeId} is absent from the seven visits`],
      });
    }
  }
  for (const frontId of spec.required_front_ids ?? []) {
    if (!coveredFrontIds.has(frontId)) {
      visitScriptIssues.push({
        visit: null,
        problems: [`front ${frontId} is absent from the seven visits`],
      });
    }
  }

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
    pact_is_playable: pactIssues.length === 0,
    fronts_have_solo_and_cooperative_paths: frontPathIssues.length === 0,
    seven_visit_path_works: visitScriptIssues.length === 0,
    public_contribution_has_return_beat:
      pact?.public_trace_event === "item.crafted" &&
      pact?.return_beat_projection === "room_memory",
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
  if (!checks.pact_is_playable)
    gaps.push(`pact gaps: ${pactIssues.join("; ")}`);
  if (!checks.fronts_have_solo_and_cooperative_paths)
    gaps.push(
      `front play gaps: ${frontPathIssues.map((issue) => issue.front_id).join(", ")}`,
    );
  if (!checks.seven_visit_path_works)
    gaps.push(
      `visit path gaps: ${visitScriptIssues.map((issue) => issue.visit ?? "shared").join(", ")}`,
    );
  if (!checks.public_contribution_has_return_beat)
    gaps.push("pact contribution has no public trace and return-beat projection");

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
    pact_issues: pactIssues,
    front_path_issues: frontPathIssues,
    visit_script_issues: visitScriptIssues,
    visit_scripts: visitScripts,
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
  console.log(
    `pact/front/visit gaps: ${report.pact_issues.length}/${report.front_path_issues.length}/${report.visit_script_issues.length}`,
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
