import {
  analyzeProofWorld,
  loadProofWorldInput,
} from "../../v2/scripts/check-proof-world.mjs";

function fixture() {
  return structuredClone(loadProofWorldInput());
}

describe("pact proof-world report", () => {
  it("keeps the current P0 slice dense, connected, and repeatable", () => {
    const { spec, content } = fixture();
    const report = analyzeProofWorld(spec, content);

    expect(report.room_count).toBe(8);
    expect(report.reachable_location_ids).toEqual(spec.location_ids);
    expect(report.dead_locations).toEqual([]);
    expect(report.job_clock_issues).toEqual([]);
    expect(report.front_issues).toEqual([]);
    expect(report.nonrenewable_critical_inputs).toEqual([]);
    expect(report.production_loop_ids).toEqual([3002, 3003, 3004]);
    expect(report.pact_issues).toEqual([]);
    expect(report.front_path_issues).toEqual([]);
    expect(report.visit_script_issues).toEqual([]);
    expect(report.visit_scripts.map((visit) => visit.visit)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(report.checks.pact_is_playable).toBe(true);
    expect(report.checks.fronts_have_solo_and_cooperative_paths).toBe(true);
    expect(report.checks.seven_visit_path_works).toBe(true);
    expect(report.checks.public_contribution_has_return_beat).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.gaps).toEqual([]);
  });

  it("fails closed when the pact home is gated or its return trace is removed", () => {
    const { spec, content } = fixture();
    content.access_gates.push({ location_id: spec.pact_location_id });
    spec.pact.return_beat_projection = "process_log";

    const report = analyzeProofWorld(spec, content);

    expect(report.checks.entry_is_public).toBe(false);
    expect(report.checks.pact_is_playable).toBe(false);
    expect(report.checks.public_contribution_has_return_beat).toBe(false);
    expect(report.pact_issues).toContain(
      `pact home ${spec.pact_location_id} is entitlement gated`,
    );
    expect(report.pact_issues).toContain(
      "pact care must return through the room-memory projection",
    );
  });

  it("requires distinct solo and cooperative paths for both fronts", () => {
    const { spec, content } = fixture();
    spec.front_paths[0].cooperative_action = "work";
    spec.front_paths[1].minimum_cooperative_players = 1;

    const report = analyzeProofWorld(spec, content);

    expect(report.checks.fronts_have_solo_and_cooperative_paths).toBe(false);
    expect(report.front_path_issues).toEqual([
      {
        front_id: "moonlit-trail:echo-front",
        problems: ["cooperative path must use the authoritative help action"],
      },
      {
        front_id: "haunted-mansion:barred-threshold",
        problems: ["cooperative path must exercise at least two players"],
      },
    ]);
  });

  it("reports a seven-visit route that crosses a missing edge or gated input", () => {
    const { spec, content } = fixture();
    content.exits = content.exits.filter(
      (exit) => !(exit.from_location_id === 44 && exit.to_location_id === 43),
    );
    content.access_gates.push({ location_id: 43 });

    const report = analyzeProofWorld(spec, content);
    const visitFive = report.visit_script_issues.find(
      (issue) => issue.visit === 5,
    );

    expect(report.checks.seven_visit_path_works).toBe(false);
    expect(visitFive.problems).toContain("route step 44 -> 43 has no authored exit");
    expect(visitFive.problems).toContain("room 43 is entitlement gated");
    expect(visitFive.problems).toContain(
      "required item 2004 starts behind an entitlement gate",
    );
  });

  it("does not count a one-time physical output as a repeatable care loop", () => {
    const { spec, content } = fixture();
    const recipe = content.recipes.find((candidate) => candidate.id === 3004);
    recipe.output = {
      item_id: 2999,
      name: "One-Time Marker",
      description: "A marker that can only enter the world once.",
      kind: "keepsake",
      charges: 1,
      target_kind: "location_floor",
      target_id: 3,
    };

    const report = analyzeProofWorld(spec, content);

    expect(report.production_loop_ids).toEqual([3002, 3003]);
    expect(report.checks.enough_production_loops).toBe(false);
    expect(report.gaps).toContain("only 2/3 production loops are defined");
  });

  it("reports rooms disconnected from the public arrival path", () => {
    const { spec, content } = fixture();
    content.exits = content.exits.filter(
      (exit) =>
        !(
          (exit.from_location_id === 2 && exit.to_location_id === 40) ||
          (exit.from_location_id === 40 && exit.to_location_id === 2)
        ),
    );

    const report = analyzeProofWorld(spec, content);

    expect(report.unreachable_location_ids).toEqual([40, 41, 42, 43, 44]);
    expect(report.checks.all_rooms_reachable).toBe(false);
  });

  it("reports broken job clocks and stranded critical inputs", () => {
    const { spec, content } = fixture();
    content.clocks = content.clocks.filter(
      (clock) => clock.id !== "moonlit-trail.danger",
    );
    content.items.find((item) => item.id === 2004).location_id = 30;

    const report = analyzeProofWorld(spec, content);

    expect(report.job_clock_issues).toContainEqual({
      job_id: "moonlit-trail:quiet-the-echo",
      problems: ["missing danger clock moonlit-trail.danger"],
    });
    expect(report.nonrenewable_critical_inputs).toContainEqual({
      item_id: 2004,
      item_name: "Moonwool Thread",
      source_location_id: 30,
      available: false,
      renewal: null,
    });
  });

  it("reports a room that loses its meaningful loops", () => {
    const { spec, content } = fixture();
    content.actors = content.actors.filter((actor) => actor.location_id !== 44);
    content.items = content.items.filter((item) => item.location_id !== 44);

    const report = analyzeProofWorld(spec, content);

    expect(report.dead_locations).toContainEqual({
      location_id: 44,
      location_name: "Flower Meadow",
      loop_kinds: [],
    });
  });
});
