import { describe, expect, it } from "vitest";
import { SCENARIO_TAGS } from "./scenario-tags.js";
import { classifyChangedPaths, normalizeChangedPaths } from "./impact-map.js";

describe("PR impact path mapping", () => {
  it("maps known browser paths deterministically", () => {
    expect(classifyChangedPaths(["src/ui/demo-client.tsx", "app/page.tsx"])).toMatchObject({
      disposition: "MAPPED",
      impactedAreas: ["browser-ui"],
      expectedTags: ["@golden-flow", "@responsive", "@runtime-proof", "@shell"],
      reasonCodes: [],
    });
  });

  it("requires the full suite for unmapped paths", () => {
    expect(classifyChangedPaths(["unknown/new-surface.ts"])).toMatchObject({
      disposition: "FULL_SUITE_REQUIRED",
      expectedTags: [...SCENARIO_TAGS],
      reasonCodes: ["UNMAPPED_PATH"],
    });
  });

  it("requires the full suite for critical tooling", () => {
    expect(classifyChangedPaths(["package.json"])).toMatchObject({
      disposition: "FULL_SUITE_REQUIRED",
      expectedTags: [...SCENARIO_TAGS],
      reasonCodes: ["CRITICAL_TOOLING_CHANGE"],
    });
  });

  it.each([
    ["C:\\private\\file.ts"],
    ["/private/file.ts"],
    ["../escape.ts"],
    ["safe/../escape.ts"],
    ["safe/\u0000file.ts"],
    ["safe/\u001bfile.ts"],
    [""],
    [`safe/${"a".repeat(513)}.ts`],
  ])("fails closed for invalid input %j", (path) => {
    expect(classifyChangedPaths([path])).toMatchObject({
      disposition: "FULL_SUITE_REQUIRED",
      expectedTags: [...SCENARIO_TAGS],
      reasonCodes: ["IMPACT_INPUT_INVALID"],
    });
  });

  it("enforces count and aggregate input limits", () => {
    expect(
      classifyChangedPaths(Array.from({ length: 2_001 }, (_, index) => `app/${index}.ts`)),
    ).toMatchObject({
      reasonCodes: ["IMPACT_INPUT_LIMIT_REACHED"],
    });
    expect(
      classifyChangedPaths(
        Array.from({ length: 600 }, (_, index) => `app/${index}-${"a".repeat(450)}.ts`),
      ),
    ).toMatchObject({ reasonCodes: ["IMPACT_INPUT_LIMIT_REACHED"] });
  });

  it("normalizes separators, leading dot segments, duplicates, and order", () => {
    expect(normalizeChangedPaths(["src\\ui\\b.ts", "./app/a.ts", "app/a.ts"])).toEqual([
      "app/a.ts",
      "src/ui/b.ts",
    ]);
  });

  it("produces byte-identical classifications for permuted input", () => {
    const first = classifyChangedPaths(["src/workflow/a.ts", "app/page.tsx"]);
    const second = classifyChangedPaths(["app/page.tsx", "src/workflow/a.ts"]);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("marks an empty comparison as full-suite-required", () => {
    expect(classifyChangedPaths([])).toMatchObject({
      disposition: "FULL_SUITE_REQUIRED",
      changedPaths: [],
      reasonCodes: ["EMPTY_CHANGE_SET"],
    });
  });
});
