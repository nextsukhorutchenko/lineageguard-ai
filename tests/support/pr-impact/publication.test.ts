import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  IMPACT_CONTEXT_PATH,
  IMPACT_REPORT_JSON_PATH,
  IMPACT_REPORT_MARKDOWN_PATH,
  prepareImpactReportPublication,
  publishImpactContext,
  publishImpactReport,
} from "./publication.js";

const context = {
  schemaVersion: "1" as const,
  source: "PULL_REQUEST" as const,
  disposition: "MAPPED" as const,
  changedPaths: ["app/page.tsx"],
  impactedAreas: ["browser-ui"],
  expectedTags: ["@shell" as const],
  reasonCodes: [],
};

describe("PR impact publication", () => {
  it("atomically publishes only the fixed context path", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-impact-"));
    await publishImpactContext(context, cwd);

    expect(JSON.parse(await readFile(join(cwd, IMPACT_CONTEXT_PATH), "utf8"))).toEqual(context);
  });

  it("publishes JSON and Markdown together beneath the fixed final directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-impact-"));
    await publishImpactReport('{"schemaVersion":"1"}\n', "# Impact\n", cwd);

    expect(await readFile(join(cwd, IMPACT_REPORT_JSON_PATH), "utf8")).toBe(
      '{"schemaVersion":"1"}\n',
    );
    expect(await readFile(join(cwd, IMPACT_REPORT_MARKDOWN_PATH), "utf8")).toBe("# Impact\n");
    await expect(publishImpactReport("{}\n", "# Again\n", cwd)).rejects.toThrow(
      "PR impact publication is unavailable.",
    );
  });

  it("removes only a stale owned report before a new run", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-impact-"));
    await publishImpactReport('{"old":true}\n', "# Old\n", cwd);

    await prepareImpactReportPublication(cwd);
    await publishImpactReport('{"new":true}\n', "# New\n", cwd);

    expect(await readFile(join(cwd, IMPACT_REPORT_JSON_PATH), "utf8")).toBe('{"new":true}\n');
  });

  it("rejects oversized bounded outputs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-impact-"));
    await expect(
      publishImpactReport("a".repeat(256 * 1_024 + 1), "# Impact\n", cwd),
    ).rejects.toThrow("PR impact publication is unavailable.");
    await expect(publishImpactReport("{}\n", "a".repeat(32 * 1_024 + 1), cwd)).rejects.toThrow(
      "PR impact publication is unavailable.",
    );
  });

  it("rejects a symlinked approved root", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-impact-"));
    const outside = await mkdtemp(join(tmpdir(), "lineageguard-outside-"));
    await symlink(outside, join(cwd, ".tmp"), "junction");

    await expect(publishImpactContext(context, cwd)).rejects.toThrow(
      "PR impact publication is unavailable.",
    );
  });
});
