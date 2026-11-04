import { worldLife } from "../../v2/card-game/resident-home.mjs";

// The Greek story journeys were written for a cast that stands still: each
// scripted Give or Ask finds its resident where the story left it. They test
// their stories alone, with rules 100's sleep and walks held off; the world
// life suites (card-world-life*.test.mjs) test those. Importing this module
// holds them off for the importing test file.
worldLife.on = false;
