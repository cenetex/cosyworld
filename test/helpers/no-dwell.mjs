import { dwellRule } from "../../v2/card-game/world/dwell.mjs";

// Suites written for a cast that walks on at once (rules 132 and before) hold
// the dwell rule off to test their own subject; card-resident-dwell.test.mjs
// tests the rule. Importing this module holds it off for the importing file.
dwellRule.on = false;
