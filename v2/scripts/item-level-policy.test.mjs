import assert from "node:assert/strict";
import test from "node:test";
import { itemLevelPolicyErrors } from "./item-level-policy.mjs";

const feature = { location_id: 1, key: "scarf_basket", uses: [{ item_id: 2005 }] };
const item = { id: 2005, level_policy: { schema_version: 1, criteria: [
  { id: "fit-the-basket", location_id: 1, feature_key: "scarf_basket" },
] } };

test("item levels bind one named milestone to a real authored use", () => {
  assert.deepEqual(itemLevelPolicyErrors(item, [feature]), []);
  assert.deepEqual(itemLevelPolicyErrors({ id: 2005 }, [feature]), []);
  assert.match(itemLevelPolicyErrors(item, []).join(" "), /authored feature use/);
  assert.match(itemLevelPolicyErrors(item, [{ ...feature, uses: [{ item_id: 2007 }] }]).join(" "), /authored feature use/);
});

test("item policy rejects count rules, unsupported versions, and duplicate credit", () => {
  for (const change of [
    (p) => { p.schema_version = 2; },
    (p) => { p.use_count = 3; },
    (p) => { p.criteria = []; },
    (p) => { p.criteria.push({ ...p.criteria[0], id: "another-name" }); },
    (p) => { p.criteria[0].location_id = 0; },
    (p) => { p.criteria[0].id = ""; },
  ]) {
    const changed = structuredClone(item);
    change(changed.level_policy);
    assert(itemLevelPolicyErrors(changed, [feature]).length > 0);
  }
});
