import {
  MAX_CHANGED_PATH_BYTES,
  MAX_CHANGED_PATHS,
  MAX_CHANGED_PATHS_BYTES,
  type ImpactContext,
} from "./contracts.js";
import { SCENARIO_TAGS, type ScenarioTag } from "./scenario-tags.js";

const compareCodePoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

class ImpactInputError extends Error {
  public constructor(
    public readonly reason: "IMPACT_INPUT_INVALID" | "IMPACT_INPUT_LIMIT_REACHED",
  ) {
    super(reason);
  }
}

const hasUnsafeControl = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

export function normalizeChangedPaths(values: readonly unknown[]): string[] {
  if (values.length > MAX_CHANGED_PATHS) {
    throw new ImpactInputError("IMPACT_INPUT_LIMIT_REACHED");
  }

  let aggregateBytes = 0;
  const normalized = new Set<string>();

  for (const input of values) {
    if (typeof input !== "string") {
      throw new ImpactInputError("IMPACT_INPUT_INVALID");
    }
    aggregateBytes += Buffer.byteLength(input, "utf8");
    if (aggregateBytes > MAX_CHANGED_PATHS_BYTES) {
      throw new ImpactInputError("IMPACT_INPUT_LIMIT_REACHED");
    }

    const value = input.replaceAll("\\", "/").replace(/^\.\//u, "");
    const segments = value.split("/");
    if (
      value.length === 0 ||
      value.startsWith("/") ||
      /^[A-Za-z]:/u.test(value) ||
      segments.some((segment) => segment === ".." || segment.length === 0) ||
      hasUnsafeControl(value) ||
      Buffer.byteLength(value, "utf8") > MAX_CHANGED_PATH_BYTES
    ) {
      throw new ImpactInputError("IMPACT_INPUT_INVALID");
    }
    normalized.add(value);
  }

  return [...normalized].sort(compareCodePoints);
}

type Classification = Pick<
  ImpactContext,
  "changedPaths" | "disposition" | "expectedTags" | "impactedAreas" | "reasonCodes"
>;

interface PathRule {
  readonly matches: (path: string) => boolean;
  readonly area: string;
  readonly tags: readonly ScenarioTag[];
  readonly fullSuite: boolean;
}

const under =
  (prefix: string) =>
  (path: string): boolean =>
    path.startsWith(prefix);
const exact =
  (...values: readonly string[]) =>
  (path: string): boolean =>
    values.includes(path);

const PATH_RULES: readonly PathRule[] = [
  {
    matches: (path) => under("app/")(path) || under("src/ui/")(path),
    area: "browser-ui",
    tags: ["@golden-flow", "@responsive", "@runtime-proof", "@shell"],
    fullSuite: false,
  },
  {
    matches: (path) =>
      [
        "src/agent/",
        "src/app/",
        "src/datahub/",
        "src/demo/",
        "src/domain/",
        "src/runtime/",
        "src/workflow/",
      ].some((prefix) => path.startsWith(prefix)),
    area: "workflow-runtime",
    tags: ["@golden-flow", "@runtime-proof", "@workflow-terminal"],
    fullSuite: false,
  },
  {
    matches: (path) =>
      [
        "src/artifacts/",
        "src/errors/",
        "src/http/",
        "src/migrations/",
        "src/runs/",
        "src/security/",
      ].some((prefix) => path.startsWith(prefix)),
    area: "artifact-and-boundary-safety",
    tags: ["@artifact-safety", "@workflow-terminal"],
    fullSuite: false,
  },
  {
    matches: exact(
      "tests/e2e/server-lifecycle.ts",
      "tests/e2e/global-setup.ts",
      "tests/e2e/global-teardown.ts",
    ),
    area: "e2e-harness",
    tags: SCENARIO_TAGS,
    fullSuite: true,
  },
  {
    matches: (path) =>
      exact(
        "playwright.config.ts",
        "package.json",
        "pnpm-lock.yaml",
        "eslint.config.mjs",
        "vitest.config.ts",
        "AGENTS.md",
      )(path) ||
      /^tsconfig(?:\.[^/]+)?\.json$/u.test(path) ||
      path.startsWith(".github/workflows/") ||
      path.startsWith("docs/specs/") ||
      path.startsWith("docs/superpowers/specs/"),
    area: "repository-authority-and-toolchain",
    tags: SCENARIO_TAGS,
    fullSuite: true,
  },
];

export function classifyChangedPaths(values: readonly unknown[]): Classification {
  let paths: string[];
  try {
    paths = normalizeChangedPaths(values);
  } catch (error) {
    const reason = error instanceof ImpactInputError ? error.reason : "IMPACT_INPUT_INVALID";
    return {
      changedPaths: [],
      disposition: "FULL_SUITE_REQUIRED",
      impactedAreas: [],
      expectedTags: [...SCENARIO_TAGS],
      reasonCodes: [reason],
    };
  }

  if (paths.length === 0) {
    return {
      changedPaths: [],
      disposition: "FULL_SUITE_REQUIRED",
      impactedAreas: [],
      expectedTags: [...SCENARIO_TAGS],
      reasonCodes: ["EMPTY_CHANGE_SET"],
    };
  }

  const areas = new Set<string>();
  const tags = new Set<ScenarioTag>();
  let fullSuite = false;
  let unmapped = false;
  for (const path of paths) {
    const rule = PATH_RULES.find((candidate) => candidate.matches(path));
    if (!rule) {
      unmapped = true;
      areas.add("unmapped");
      continue;
    }
    areas.add(rule.area);
    rule.tags.forEach((tag) => tags.add(tag));
    fullSuite ||= rule.fullSuite;
  }

  const reasonCodes: Classification["reasonCodes"] = [];
  if (fullSuite) reasonCodes.push("CRITICAL_TOOLING_CHANGE");
  if (unmapped) reasonCodes.push("UNMAPPED_PATH");
  const disposition = fullSuite || unmapped ? "FULL_SUITE_REQUIRED" : "MAPPED";

  return {
    changedPaths: paths,
    disposition,
    impactedAreas: [...areas].sort(compareCodePoints),
    expectedTags:
      disposition === "FULL_SUITE_REQUIRED"
        ? [...SCENARIO_TAGS]
        : [...tags].sort(compareCodePoints),
    reasonCodes: reasonCodes.sort(compareCodePoints),
  };
}
