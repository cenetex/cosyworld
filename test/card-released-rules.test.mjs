import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Rules 2–18 were released at be94af7b. Rules 19 were qualified at 1be7794b.
// Rules 20 were frozen by the Ajax owner at 0028c76f.
// Journal commands keep these exact rules.
const released = {
  2: "c494fb944d97cd8e214f09382add1501e98c93ab8f8d29b5c13f77caa59c3fef",
  3: "4029aec75de2792ad44a1a05693e50870685a0f459cdbe172094d762a798c4db",
  4: "137776846090485d9b60f8ce3f48fe1d28db9190bf0ab1c0a3ce25bfc095d381",
  5: "ca977562a026b9f7c31f095d80dc1519e6e5217692af20e0d89893b4ff7a3e0f",
  6: "38b63303179f1cab5634d652a7e45c57b18b512f32586398bba626b5e872b366",
  7: "4bd038ea002e0778abcd0e0c89c8c887fea9d90f4ed75cdb53a24d80c57bc671",
  8: "27d04babfaae5096aab0117c2a3f3968214712e8bc41fd4e275a3069fecb4bc6",
  9: "4455643c2854b7a11c0a3773db80e6cbaf018c147f4d892544e33d946cf183cb",
  10: "899dc06fc2d524b65fcadf65ddeed0bf38e1b4cd345fc43bd86d7b612aa4b107",
  11: "7678ea323a047530af88ae83fc8fcd0933650e7833810dde5116c2271799f1a9",
  12: "d038be61db0c02908b2141b855ce2640f725ddda3978bd8d3128bd1892e03b4e",
  13: "ac9adb9142015909805a036b685283a4b5cd64cc798f50dc25f654a06076683d",
  14: "66946983a45b3c61ca13a0dc5a47c7f72a18cab6f86f07e9ac27835d305d2d96",
  15: "a458ee93ac2f1d12c6df431815319638b0c220ec5556d63f01aae6f073804fb8",
  16: "e5129d50676b54f489b16a4abd8506d5fb27e304cc28753736572fa43c4991dd",
  17: "68316e3ee4812dd416fe34bdcc9e8e6fc2a5c56c0669563f1f1a763d2845eddc",
  18: "db631d35fc0b2e6e50169e8f08c364e4d6a8bcec0971551bcf70a168cb97ef9c",
  19: "9911a38a1f49db512521b84674dad4bf3843ddcc9938fbd608747a6c82e62eb3",
  20: "1e2c2195f737c60265be71cb772654ceda3248d02ab5728862dc5ac8d455aa24",
};

it("preserves every released and qualified interpreter for exact journal replay", () => {
  for (const [version, expected] of Object.entries(released)) {
    const path = new URL(
      `../v2/orchestrator-rust/src/card_shared/engine-v${version}.js`,
      import.meta.url,
    );
    const actual = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
    expect(actual, `Released shared rules ${version}`).toBe(expected);
  }
});
