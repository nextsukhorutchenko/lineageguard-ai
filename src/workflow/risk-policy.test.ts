import { describe, expect, it } from "vitest";
import { decideRisk } from "./risk-policy.js";

describe("decideRisk", () => {
  it.each([
    [0, "PROCEED_WITH_REVIEW"],
    [39, "PROCEED_WITH_REVIEW"],
    [40, "MANUAL_APPROVAL_REQUIRED"],
    [74, "MANUAL_APPROVAL_REQUIRED"],
    [75, "BLOCK_DIRECT_RENAME"],
    [100, "BLOCK_DIRECT_RENAME"],
  ] as const)("maps score %i to %s", (score, expected) => {
    expect(decideRisk(score)).toBe(expected);
  });
});
