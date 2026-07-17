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
    expect(report.ready).toBe(true);
    expect(report.gaps).toEqual([]);
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
