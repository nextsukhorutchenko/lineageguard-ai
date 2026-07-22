import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs on the pinned Node major version", () => {
    expect(Number.parseInt(process.versions.node, 10)).toBe(22);
  });
});
