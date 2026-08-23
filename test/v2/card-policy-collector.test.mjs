import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const collector = readFileSync(
  new URL("../../v2/scripts/collect-card-policy-objectives.sh", import.meta.url),
  "utf8",
);

describe("card policy objective collector", () => {
  it("submits the compact offer certificate exposed by /state", () => {
    expect(collector).toContain(
      "{path:$path,offer_id:$offer.offer_id,composition_id:$offer.composition_id,kind:$offer.kind,payload:",
    );
    expect(collector).not.toMatch(/rules_profile:\$offer\.rules_profile/);
    expect(collector).not.toMatch(/state_revision:\$offer\.state_revision/);
    expect(collector).not.toMatch(/rules_action:\$offer\.rules_action/);
    expect(collector).toContain('post_json_lenient /commands "$body"');
    expect(collector).toContain('=~ ^(409|423)$');
  });

  it("uses ordinary card reactions and keeps optional setup outside the label", () => {
    expect(collector).toContain(
      'SETUP_ACTION_SEQUENCE="${COSYWORLD_CARD_POLICY_COLLECT_SETUP_ACTIONS:-notice_actor}"',
    );
    expect(collector).toContain(
      'ACTION_SEQUENCE="${COSYWORLD_CARD_POLICY_COLLECT_ACTIONS:-chat,pick_up}"',
    );
    expect(collector).toContain(
      'OBJECTIVE_MAX_TURNS="${COSYWORLD_CARD_POLICY_COLLECT_MAX_TURNS:-2}"',
    );
    expect(collector.indexOf('for setup_action_kind in "${SETUP_ACTIONS[@]}"')).toBeLessThan(
      collector.indexOf("treasure_index="),
    );
    expect(collector.indexOf('seek_offer "$actor_id" "$actor_session" "$action_kind"')).toBeLessThan(
      collector.indexOf("treasure_index="),
    );
  });
});
