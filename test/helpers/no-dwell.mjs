import { dwellRule } from "../../v2/card-game/world/dwell.mjs";

// Legacy cast suites (rules 132 and before) disable dwell for the importing file.
// card-resident-dwell.test.mjs tests the dwell rule.
dwellRule.on = false;
