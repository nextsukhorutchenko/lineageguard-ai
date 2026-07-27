import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import {
  requiredBoundaryMarkers,
  requiredDataHubResourceClassifications,
  requiredDataHubResourceUrls,
  requiredDestinationPhrases,
  requiredFiles,
  requiredLiveDocumentationMarkers,
  prohibitedAffirmativeSkillPhrases,
  requiredSkillContractTerms,
  requiredSkillFrontmatterName,
  requiredSkillReferenceMarkers,
  requiredSkillSafetySentence,
  requiredSkillTemplateHeadings,
  prohibitedSkillPhrases,
  validateDemoScenario,
  validateSkillCandidate,
  validateLiveDocumentation,
  validateLiveVerification,
  validateSubmissionAssets,
} from "./validate-submission-assets.js";

async function validateWithMutation(
  relativePath: string,
  mutate: (content: string) => string,
): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-submission-"));
  try {
    await Promise.all(
      requiredFiles
        .filter((file) => file !== publicDeploymentVerificationPath)
        .map(async (file) => {
          const destination = join(root, file);
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(join(process.cwd(), file), destination);
        }),
    );
    const verificationPath = join(root, publicDeploymentVerificationPath);
    await mkdir(dirname(verificationPath), { recursive: true });
    await writeFile(verificationPath, publicDeploymentVerificationFixture, "utf8");
    const target = join(root, relativePath);
    const original = await readFile(target, "utf8");
    await writeFile(target, mutate(original), "utf8");
    return await validateSubmissionAssets(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const publicDeploymentVerificationPath = "docs/public-deployment-verification.md";
const publicProjectUrl = "https://lineageguard-ai-replay.onrender.com";
const reviewedRuntimeCommit = "7f9a534983ff58d0f6df66da0708cc5e34c0f4cd";
const officialRenderDocumentationUrls = [
  "https://render.com/docs/blueprint-spec",
  "https://render.com/docs/deploy-nextjs-app",
  "https://render.com/docs/free",
  "https://render.com/docs/health-checks",
] as const;

const publicDeploymentVerificationFixture = `# Public Deployment Verification

Status: PASSED
Mode: PUBLIC_REPLAY
Access: No login, DataHub, OpenAI, API key, or paid account required
Storage: Ephemeral runs; rerun the deterministic replay after restart
Project URL: ${publicProjectUrl}
Reviewed runtime commit: ${reviewedRuntimeCommit}
Verified date (UTC): 2026-07-27T05:42:44Z
Verified date (Europe/Kyiv): 2026-07-27T08:42:44+03:00

| Check | Evidence | Outcome |
| --- | --- | --- |
| Health | The public replay health endpoint was reachable. | PASSED |
| Private-browser access | The replay opened without a login, provider credential, or paid account. | PASSED |
| Golden result | 24 / 11 / 90; BLOCK_DIRECT_RENAME | PASSED |
| Four artifacts | All four allowlisted artifacts were available through the replay. | PASSED |
| Headers | Required cache and browser-security headers were present. | PASSED |
| Console | The browser console had no errors or warnings. | PASSED |
| Request host | ${publicProjectUrl} | PASSED |

Public fixture replay. No DataHub or OpenAI credentials. Ephemeral runs.
`;

async function validateWithPublicDeploymentMutation(
  mutate: (content: string) => string,
): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-public-deployment-"));
  try {
    await Promise.all(
      requiredFiles
        .filter((file) => file !== publicDeploymentVerificationPath)
        .map(async (file) => {
          const destination = join(root, file);
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(join(process.cwd(), file), destination);
        }),
    );
    const target = join(root, publicDeploymentVerificationPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, mutate(publicDeploymentVerificationFixture), "utf8");
    return await validateSubmissionAssets(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("requires the public deployment verification record", async () => {
  const root = await mkdtemp(join(tmpdir(), "lineageguard-missing-public-deployment-"));
  try {
    await Promise.all(
      requiredFiles
        .filter((file) => file !== publicDeploymentVerificationPath)
        .map(async (file) => {
          const destination = join(root, file);
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(join(process.cwd(), file), destination);
        }),
    );
    await expect(validateSubmissionAssets(root)).resolves.toContain(
      `missing required submission file: ${publicDeploymentVerificationPath}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  "# Public Deployment Verification",
  "Status: PASSED",
  "Mode: PUBLIC_REPLAY",
  "Access: No login, DataHub, OpenAI, API key, or paid account required",
  "Storage: Ephemeral runs; rerun the deterministic replay after restart",
  `Project URL: ${publicProjectUrl}`,
  `Reviewed runtime commit: ${reviewedRuntimeCommit}`,
  "Verified date (UTC): 2026-07-27T05:42:44Z",
  "Verified date (Europe/Kyiv): 2026-07-27T08:42:44+03:00",
  "24 / 11 / 90",
  "BLOCK_DIRECT_RENAME",
  "Public fixture replay",
  "No DataHub or OpenAI credentials",
  "Ephemeral runs",
] as const)("requires public deployment evidence: %s", async (marker) => {
  const findings = await validateWithPublicDeploymentMutation((content) =>
    content.replaceAll(marker, ""),
  );
  expect(findings).toContain(`missing public deployment evidence: ${marker}`);
});

it("accepts Prettier-aligned public deployment evidence rows", async () => {
  const findings = await validateWithPublicDeploymentMutation((content) =>
    content.replace(
      "| Health | The public replay health endpoint was reachable. | PASSED |",
      "| Health                 | The public replay health endpoint was reachable. | PASSED |",
    ),
  );
  expect(findings).not.toContain("missing public deployment evidence: Health | PASSED");
});

it.each([
  [
    "the exact golden result",
    (content: string) => content.replace("24 / 11 / 90", "24 / 11 / 91"),
    "missing public deployment evidence row: Golden result",
  ],
  [
    "the exact golden decision",
    (content: string) => content.replace("BLOCK_DIRECT_RENAME", "ALLOW_DIRECT_RENAME"),
    "missing public deployment evidence row: Golden result",
  ],
  [
    "the golden result outcome",
    (content: string) =>
      content.replace(
        "Golden result | 24 / 11 / 90; BLOCK_DIRECT_RENAME | PASSED",
        "Golden result | 24 / 11 / 90; BLOCK_DIRECT_RENAME | VERIFIED",
      ),
    "missing public deployment evidence row: Golden result",
  ],
  [
    "the exact request host",
    (content: string) =>
      content.replace(
        `Request host | ${publicProjectUrl} | PASSED`,
        "Request host | https://public-replay.example.invalid | PASSED",
      ),
    "missing public deployment evidence row: Request host",
  ],
  [
    "the request-host outcome",
    (content: string) =>
      content.replace(
        `Request host | ${publicProjectUrl} | PASSED`,
        `Request host | ${publicProjectUrl} | VERIFIED`,
      ),
    "missing public deployment evidence row: Request host",
  ],
] as const)("requires %s in its evidence-table association", async (_name, mutate, finding) => {
  const findings = await validateWithPublicDeploymentMutation(mutate);
  expect(findings).toContain(finding);
});

it.each([
  [
    "the numeric golden-result suffix",
    (content: string) => content.replace("24 / 11 / 90", "24 / 11 / 900"),
    "missing public deployment evidence row: Golden result",
  ],
  [
    "the extended golden decision",
    (content: string) => content.replace("BLOCK_DIRECT_RENAME", "BLOCK_DIRECT_RENAME_EXTRA"),
    "missing public deployment evidence row: Golden result",
  ],
  [
    "the negated golden outcome",
    (content: string) =>
      content.replace(
        "Golden result | 24 / 11 / 90; BLOCK_DIRECT_RENAME | PASSED",
        "Golden result | 24 / 11 / 90; BLOCK_DIRECT_RENAME | NOT PASSED",
      ),
    "missing public deployment evidence row: Golden result",
  ],
  [
    "the extended request host",
    (content: string) =>
      content.replace(
        `Request host | ${publicProjectUrl} | PASSED`,
        `Request host | ${publicProjectUrl}.evil | PASSED`,
      ),
    "missing public deployment evidence row: Request host",
  ],
  [
    "the negated request-host outcome",
    (content: string) =>
      content.replace(
        `Request host | ${publicProjectUrl} | PASSED`,
        `Request host | ${publicProjectUrl} | NOT PASSED`,
      ),
    "missing public deployment evidence row: Request host",
  ],
] as const)("rejects %s in an exact evidence-table cell", async (_name, mutate, finding) => {
  const baselineFindings = await validateWithPublicDeploymentMutation((content) => content);
  expect(baselineFindings).not.toContain(finding);
  const findings = await validateWithPublicDeploymentMutation(mutate);
  expect(findings).toContain(finding);
});

it.each([
  publicProjectUrl,
  "approximately one minute",
  "runs are ephemeral",
  "Run expired; analyze again.",
  "rerun the deterministic scenario",
] as const)("requires README public replay guidance: %s", async (marker) => {
  const findings = await validateWithMutation("README.md", (content) =>
    content.replaceAll(marker, ""),
  );
  expect(findings).toContain(`missing README public replay guidance: ${marker}`);
});

it.each(officialRenderDocumentationUrls)(
  "requires official Render documentation: %s",
  async (url) => {
    const findings = await validateWithMutation("docs/resources-and-attribution.md", (content) =>
      content.replace(url, ""),
    );
    expect(findings).toContain(`missing official Render resource: ${url}`);
  },
);

it.each(["Deployment infrastructure", "No code or prose copied"] as const)(
  "requires Render attribution classification: %s",
  async (marker) => {
    const findings = await validateWithMutation("docs/resources-and-attribution.md", (content) =>
      content.replaceAll(marker, ""),
    );
    expect(findings).toContain(`missing Render attribution requirement: ${marker}`);
  },
);

it.each([publicProjectUrl, "docs/public-deployment-verification.md"] as const)(
  "requires judging-map public deployment evidence: %s",
  async (marker) => {
    const findings = await validateWithMutation("docs/judging-map.md", (content) =>
      content.replaceAll(marker, ""),
    );
    expect(findings).toContain(`missing judging-map public deployment evidence: ${marker}`);
  },
);

it.each([
  ["TODO", "unresolved public deployment planning marker"],
  ["https://fabricated-host.onrender.com", "fabricated public deployment hostname"],
  ["Account ID: 123456", "unsafe public deployment documentation marker"],
  ["Token: not-a-secret", "unsafe public deployment documentation marker"],
  [
    "https://render.com/docs/free?token=not-a-secret",
    "unsafe public deployment documentation marker",
  ],
] as const)("rejects unsafe public deployment documentation: %s", async (unsafeMarker, finding) => {
  const findings = await validateWithPublicDeploymentMutation(
    (content) => `${content}\n${unsafeMarker}\n`,
  );
  expect(findings).toContain(finding);
});

it.each([
  "Raw log: request completed",
  "Trace: provider envelope",
  'Response body: {"status":"ok"}',
  "C:\\private\\lineageguard\\run.json",
  "/var/lib/lineageguard/run.json",
  "Trace output: provider envelope",
  'Response bodies: [{"status":"ok"}]',
  "Raw dump:\nrequest payload\nresponse payload",
  "```text\nRaw log\nrequest payload\n```",
  "\\\\server\\share\\run.json",
] as const)("rejects a raw public-deployment disclosure: %s", async (unsafeMarker) => {
  const findings = await validateWithPublicDeploymentMutation(
    (content) => `${content}\n${unsafeMarker}\n`,
  );
  expect(findings).toContain("unsafe public deployment documentation disclosure");
});

it("accepts the complete English hackathon package and read-only skill", async () => {
  await expect(validateSubmissionAssets(process.cwd())).resolves.toEqual([]);
});

it.each(requiredDataHubResourceUrls)("rejects a missing official resource: %s", async (url) => {
  const findings = await validateWithMutation("docs/resources-and-attribution.md", (content) =>
    content.replace(url, ""),
  );
  expect(findings).toContain(`missing official DataHub resource: ${url}`);
});

it.each(requiredDestinationPhrases)(
  "binds $finding to $path",
  async ({ path, phrase, finding }) => {
    const findings = await validateWithMutation(path, (content) => content.replaceAll(phrase, ""));
    expect(findings).toContain(finding);
  },
);

it.each(["PR Review Summary", "Reviewer Gates"] as const)(
  "requires exactly one rollout heading: %s",
  async (heading) => {
    const findings = await validateWithMutation(
      "examples/002-nextjs-openai-agent-demo/rollout-plan.md",
      (content) => content.replace(`## ${heading}`, ""),
    );
    expect(findings).toContain(`rollout plan must contain exactly one ${heading} heading`);
  },
);

it.each(requiredLiveDocumentationMarkers)(
  "rejects a missing live-documentation marker: %s",
  async (marker) => {
    const findings = await validateWithMutation("README.md", (content) =>
      content.replaceAll(marker, ""),
    );
    expect(findings).toContain(`missing live documentation requirement: ${marker}`);
  },
);

it("accepts the complete seven-step live operator preflight", async () => {
  const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
  expect(validateLiveDocumentation(readme)).not.toContain(
    "live operator preflight must contain exactly seven steps",
  );
});

it("requires exactly seven live operator steps", async () => {
  const findings = await validateWithMutation("README.md", (content) =>
    content.replace("\n7. Only after Steps 1–6 pass", "\nOnly after Steps 1–6 pass"),
  );
  expect(findings).toContain("live operator preflight must contain exactly seven steps");
});

it("does not accept a preflight marker elsewhere in README", async () => {
  const marker = "pnpm test:integration";
  const findings = await validateWithMutation(
    "README.md",
    (content) => `Outside preflight: ${marker}\n\n${content.replaceAll(marker, "")}`,
  );
  expect(findings).toContain(`missing live documentation requirement: ${marker}`);
});

it.each([
  ["README.md", "relative uvx command in README.md"],
  ["docs/demo-scenario.md", "relative uvx command in docs/demo-scenario.md"],
] as const)("rejects a relative uvx command in %s", async (path, finding) => {
  const absoluteCommand = "$env:DATAHUB_MCP_UVX_PATH = (Get-Command uvx -ErrorAction Stop).Source";
  const relativeCommand = '$env:DATAHUB_MCP_UVX_PATH = "uvx"';
  const findings = await validateWithMutation(path, (content) =>
    content.replaceAll(relativeCommand, absoluteCommand).replace(absoluteCommand, relativeCommand),
  );

  expect(findings).toContain(finding);
});

function mutateResourceCell(content: string, url: string, index: number, value: string): string {
  return content
    .split(/\r?\n/u)
    .map((line) => {
      if (!line.includes(url)) return line;
      const trimmed = line.trim();
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());
      cells[index] = value;
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
}

it("rejects a duplicate official resource row", async () => {
  const url = requiredDataHubResourceUrls[0];
  const findings = await validateWithMutation("docs/resources-and-attribution.md", (content) => {
    const row = content.split(/\r?\n/u).find((line) => line.includes(url));
    if (row === undefined) throw new Error("Expected source row missing from test fixture.");
    return `${content.trimEnd()}\n${row}\n`;
  });
  expect(findings).toContain(`duplicate official DataHub resource: ${url}`);
});

it.each([
  [1, "missing reviewed date"],
  [2, "missing license or terms"],
  [3, "missing project classification"],
  [4, "missing LineageGuard resource use"],
  [5, "missing code/prose copy declaration"],
] as const)("rejects an empty resource cell: %s", async (index, findingPrefix) => {
  const url = requiredDataHubResourceUrls[0];
  const findings = await validateWithMutation("docs/resources-and-attribution.md", (content) =>
    mutateResourceCell(content, url, index, ""),
  );
  expect(findings).toContain(`${findingPrefix}: ${url}`);
});

it.each([...requiredDataHubResourceClassifications])(
  "rejects the wrong classification for %s",
  async (url) => {
    const findings = await validateWithMutation("docs/resources-and-attribution.md", (content) =>
      mutateResourceCell(content, url, 3, "Wrong classification"),
    );
    expect(findings).toContain(`invalid project classification: ${url}`);
  },
);

it("requires the clean-room Skills copy declaration", async () => {
  const url = "https://github.com/datahub-project/datahub-skills";
  const findings = await validateWithMutation("docs/resources-and-attribution.md", (content) =>
    mutateResourceCell(content, url, 5, "No code copied"),
  );
  expect(findings).toContain(`invalid code/prose copy declaration: ${url}`);
  expect(findings).toContain("invalid DataHub Skills attribution");
});

it.each([
  ["864ee5800c55eb90628f290bd8e91602b0a3e28e", "invalid DataHub Skills attribution"],
  ["Apache-2.0", "invalid DataHub Skills attribution"],
  [
    "https://github.com/acryldata/mcp-server-datahub/releases/tag/v0.6.0",
    "missing pinned MCP source/release attribution",
  ],
  [
    "https://github.com/acryldata/mcp-server-datahub/tree/v0.6.0",
    "missing pinned MCP source/release attribution",
  ],
] as const)("rejects missing pinned attribution evidence: %s", async (marker, finding) => {
  const findings = await validateWithMutation("docs/resources-and-attribution.md", (content) =>
    content.replace(marker, ""),
  );
  expect(findings).toContain(finding);
});

it.each(requiredBoundaryMarkers)(
  "rejects a missing boundary: $finding",
  async ({ path, marker, finding }) => {
    const findings = await validateWithMutation(path, (content) => content.replace(marker, ""));
    expect(findings).toContain(finding);
  },
);

it("rejects a forbidden Agent Context Kit runtime dependency", async () => {
  const findings = await validateWithMutation("package.json", (content) => {
    const packageJson = JSON.parse(content) as { dependencies: Record<string, string> };
    packageJson.dependencies["datahub-agent-context"] = "0.0.0";
    return `${JSON.stringify(packageJson, null, 2)}\n`;
  });
  expect(findings).toContain("forbidden runtime dependency: datahub-agent-context");
});

it.each(["package.json", ".github/workflows/ci.yml"] as const)(
  "rejects official Skills bundle installation in %s",
  async (path) => {
    const findings = await validateWithMutation(path, (content) => {
      if (path === "package.json") {
        const packageJson = JSON.parse(content) as {
          scripts?: Record<string, string>;
        };
        packageJson.scripts = {
          ...packageJson.scripts,
          "install-datahub-skills": "npx skills add datahub-project/datahub-skills",
        };
        return `${JSON.stringify(packageJson, null, 2)}\n`;
      }
      return `${content.trimEnd()}\n      - run: npx skills add datahub-project/datahub-skills\n`;
    });
    expect(findings).toContain(`forbidden official Skills bundle installation: ${path}`);
  },
);

it.each(prohibitedSkillPhrases)("rejects unsafe candidate text: %s", async (injected) => {
  const finding =
    injected === "allowed-tools: Bash(datahub *)"
      ? "forbidden broad skill permission"
      : injected === "datahub lineage" ||
          injected === "datahub graphql" ||
          injected === "get_lineage(urn, direction, depth)"
        ? "forbidden skill fallback: CLI or GraphQL"
        : `forbidden skill phrase: ${injected}`;
  const findings = await validateWithMutation(
    "skills/lineageguard-schema-change-impact/SKILL.md",
    (content) => `${content}\n${injected}\n`,
  );
  expect(findings).toContain(finding);
});

it.each(prohibitedAffirmativeSkillPhrases)(
  "rejects an affirmative dangerous skill action: %s",
  async (injected) => {
    const findings = await validateWithMutation(
      "skills/lineageguard-schema-change-impact/SKILL.md",
      (content) => `${content}\n${injected}\n`,
    );
    const finding = injected.includes("approve")
      ? "forbidden autonomous approval"
      : `forbidden affirmative skill action: ${injected}`;
    expect(findings).toContain(finding);
  },
);

it("requires the exact skill frontmatter name", async () => {
  const findings = await validateWithMutation(
    "skills/lineageguard-schema-change-impact/SKILL.md",
    (content) => content.replace(`name: ${requiredSkillFrontmatterName}`, "name: wrong-skill-name"),
  );
  expect(findings).toContain("invalid skill frontmatter name");
});

it("rejects any allowed-tools frontmatter", async () => {
  const findings = await validateWithMutation(
    "skills/lineageguard-schema-change-impact/SKILL.md",
    (content) =>
      content.replace("user-invocable: true", "user-invocable: true\nallowed-tools: Read"),
  );
  expect(findings).toContain("forbidden broad skill permission");
});

it("requires the exact negative skill safety boundary", async () => {
  const findings = await validateWithMutation(
    "skills/lineageguard-schema-change-impact/SKILL.md",
    (content) => content.replace(requiredSkillSafetySentence, ""),
  );
  expect(findings).toContain("missing skill safety boundary");
});

it.each(requiredSkillTemplateHeadings)(
  "rejects a missing skill template heading: %s",
  async (heading) => {
    const findings = await validateWithMutation(
      "skills/lineageguard-schema-change-impact/templates/schema-change-impact.md",
      (content) => content.replace(`## ${heading}`, ""),
    );
    expect(findings).toContain(`missing skill template heading: ${heading}`);
  },
);

it("requires human-readable names beside evidence URNs", async () => {
  const findings = await validateWithMutation(
    "skills/lineageguard-schema-change-impact/templates/schema-change-impact.md",
    (content) => content.replace("| Entity name | Evidence URN | Evidence kind |", ""),
  );
  expect(findings).toContain("missing human-readable evidence table");
});

it.each(requiredSkillContractTerms)(
  "rejects a missing skill contract term: $term",
  async ({ term, marker }) => {
    const [skill, reference, template] = await Promise.all([
      readFile(join(process.cwd(), "skills/lineageguard-schema-change-impact/SKILL.md"), "utf8"),
      readFile(
        join(
          process.cwd(),
          "skills/lineageguard-schema-change-impact/references/pinned-mcp-contract.md",
        ),
        "utf8",
      ),
      readFile(
        join(
          process.cwd(),
          "skills/lineageguard-schema-change-impact/templates/schema-change-impact.md",
        ),
        "utf8",
      ),
    ]);
    const findings = validateSkillCandidate({
      skill: skill.replaceAll(marker, ""),
      reference: reference.replaceAll(marker, ""),
      template: template.replaceAll(marker, ""),
    });
    expect(findings).toContain(`missing skill contract term: ${term}`);
  },
);

it.each(requiredSkillReferenceMarkers)(
  "rejects a missing pinned MCP reference term: $term",
  async ({ term, marker }) => {
    const findings = await validateWithMutation(
      "skills/lineageguard-schema-change-impact/references/pinned-mcp-contract.md",
      (content) => content.replaceAll(marker, ""),
    );
    expect(findings).toContain(`missing pinned MCP reference term: ${term}`);
  },
);

it("rejects an empty pinned MCP reference", async () => {
  const findings = await validateWithMutation(
    "skills/lineageguard-schema-change-impact/references/pinned-mcp-contract.md",
    () => "",
  );
  expect(findings).toContain("missing pinned MCP reference term: pinned MCP version");
  expect(findings).toContain("missing pinned MCP reference term: lineage signature");
  expect(findings).toContain("missing pinned MCP reference term: token-budget truncation field");
});

const passedLiveRecord = `# Live Verification

- Overall status: \`PASSED\`
- Verified at: \`2026-07-23T12:00:00.000Z\`
- Commit: \`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`
- DataHub account: \`LOCAL QUICKSTART USER: datahub\`
- Search visibility scope: \`NO DEFAULT VIEW\`

| Check                                     | Status   | Evidence              |
| ----------------------------------------- | -------- | --------------------- |
| GMS health                                | \`PASSED\` | health endpoint       |
| DataHub UI asset, schema, lineage, owners | \`PASSED\` | visible golden asset  |
| Pinned read-only MCP integration contract | \`PASSED\` | pnpm test:integration |
| OpenAI live smoke and validated package   | \`PASSED\` | pnpm test:openai      |
`;

it.each([
  [
    "DataHub account: `LOCAL QUICKSTART USER: datahub`",
    "DataHub account: `NOT RUN`",
    "live attempt missing DataHub account",
  ],
  [
    "Search visibility scope: `NO DEFAULT VIEW`",
    "Search visibility scope: `NOT RUN`",
    "live attempt missing search visibility scope",
  ],
  [
    "DataHub account: `LOCAL QUICKSTART USER: datahub`",
    "DataHub account: `UNAVAILABLE`",
    "passed live record has unavailable DataHub account",
  ],
  [
    "Search visibility scope: `NO DEFAULT VIEW`",
    "Search visibility scope: `UNAVAILABLE`",
    "passed live record has unavailable search visibility scope",
  ],
] as const)("rejects inconsistent passed live bindings: %s", (from, to, finding) => {
  expect(validateLiveVerification(passedLiveRecord.replace(from, to))).toContain(finding);
});

it.each([
  ["empty", ""],
  ["NOT RUN", "NOT RUN"],
] as const)("rejects %s evidence for a passed live check", (_name, evidence) => {
  expect(validateLiveVerification(passedLiveRecord.replace("health endpoint", evidence))).toContain(
    "attempted live check missing concrete evidence: GMS health",
  );
});

const notRunLiveRecord = `# Live Verification

- Overall status: \`NOT RUN\`
- Verified at: \`NOT RUN\`
- Commit: \`NOT RUN\`
- DataHub account: \`NOT RUN\`
- Search visibility scope: \`NOT RUN\`

| Check                                     | Status    | Evidence  |
| ----------------------------------------- | --------- | --------- |
| GMS health                                | \`NOT RUN\` | \`NOT RUN\` |
| DataHub UI asset, schema, lineage, owners | \`NOT RUN\` | \`NOT RUN\` |
| Pinned read-only MCP integration contract | \`NOT RUN\` | \`NOT RUN\` |
| OpenAI live smoke and validated package   | \`NOT RUN\` | \`NOT RUN\` |
`;

it("requires exact NOT RUN evidence for an untouched check", () => {
  const invalid = notRunLiveRecord.replace(
    "| GMS health                                | `NOT RUN` | `NOT RUN` |",
    "| GMS health                                | `NOT RUN` | evidence  |",
  );
  expect(validateLiveVerification(invalid)).toContain(
    "not-run live check evidence must be NOT RUN: GMS health",
  );
});

it("requires bindings for a failed live attempt", () => {
  const failed = passedLiveRecord
    .replace("Overall status: `PASSED`", "Overall status: `FAILED`")
    .replace(
      "| GMS health                                | `PASSED`",
      "| GMS health                                | `FAILED`",
    )
    .replace("DataHub account: `LOCAL QUICKSTART USER: datahub`", "DataHub account: `NOT RUN`")
    .replace("Search visibility scope: `NO DEFAULT VIEW`", "Search visibility scope: `NOT RUN`");
  expect(validateLiveVerification(failed)).toEqual(
    expect.arrayContaining([
      "live attempt missing DataHub account",
      "live attempt missing search visibility scope",
    ]),
  );
});

const validDemoScript = `# Demo

## Three-Minute Video Script

1. 0:00–0:20 — Frame the Metadata-Aware Code Generation & Development problem and trigger.
2. 0:20–0:35 — Show the LIVE/REPLAY badge and state which evidence source is active.
3. 0:35–1:05 — Verify the DataHub dataset, schema, table lineage, column lineage, and ownership.
4. 1:05–1:30 — Show Evidence Completeness, Context Coverage, and Runtime Proof as separate panels.
5. 1:30–1:50 — Show 24 downstream, 11 column-confirmed, risk score 90, and BLOCK_DIRECT_RENAME.
6. 1:50–2:35 — Run analyze_rename_change and generate_migration_package; inspect four artifacts and the non-executable physical-name gate.
7. 2:35–2:55 — Close on mutations disabled, read-only/no-SQL behavior, human approval, and practical team value.
`;

it("accepts the approved seven-beat demo timeline", () => {
  expect(validateDemoScenario(validDemoScript)).toEqual([]);
});

it.each([
  [
    (content: string) => content.replace(/^7\..*$/mu, ""),
    "demo script must contain exactly seven numbered beats",
  ],
  [(content: string) => content.replace("0:20–0:35", "0:20 to 0:35"), "malformed demo beat: 2"],
  [(content: string) => content.replace("0:20–0:35", "0:19–0:35"), "demo beats overlap at beat: 2"],
  [
    (content: string) => content.replace("0:20–0:35", "0:21–0:35"),
    "demo script has a gap before beat: 2",
  ],
  [
    (content: string) => content.replace("LIVE/REPLAY badge", "mode badge"),
    "demo beat 2 missing topic: LIVE/REPLAY badge",
  ],
  [
    (content: string) => content.replace("2:35–2:55", "2:35–3:00"),
    "demo script exceeds the 2:55 limit",
  ],
  [
    (content: string) => content.replace("2:35–2:55", "2:45–3:00"),
    "demo script exceeds the 2:55 limit",
  ],
  [
    (content: string) => content.replace("0:20–0:35", "0:20–0:20"),
    "demo beat must have positive duration: 2",
  ],
] as const)("rejects an invalid demo timeline", (mutate, finding) => {
  expect(validateDemoScenario(mutate(validDemoScript))).toContain(finding);
});

const projectRoot = process.cwd();
const validatorScript = join(projectRoot, "scripts/validate-submission-assets.ts");
const tsxCli = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

function runValidatorCli(cwd: string) {
  const result = spawnSync(process.execPath, [tsxCli, validatorScript], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

it("returns zero and fixed output for a complete package", () => {
  const result = runValidatorCli(projectRoot);
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("Submission assets: OK");
  expect(result.stderr).toBe("");
});

it("returns nonzero stable output without native paths for an incomplete package", async () => {
  const emptyRoot = await mkdtemp(join(tmpdir(), "lineageguard-empty-submission-"));
  try {
    const result = runValidatorCli(emptyRoot);
    const lines = result.stderr.trimEnd().split(/\r?\n/u);
    expect(result.status).toBe(1);
    expect(lines).toContain("missing required submission file: README.md");
    expect(lines).toEqual([...new Set(lines)].sort((left, right) => left.localeCompare(right)));
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(emptyRoot);
    expect(result.stderr).not.toMatch(/(?:^|[\s("'])[A-Za-z]:[\\/]/u);
    expect(result.stderr).not.toContain("Error:");
  } finally {
    await rm(emptyRoot, { recursive: true, force: true });
  }
});

it("has no CLI side effect when imported", () => {
  const moduleUrl = pathToFileURL(validatorScript).href;
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      "--eval",
      `import(${JSON.stringify(moduleUrl)}).then(() => console.log("IMPORTED_ONLY"))`,
    ],
    { cwd: projectRoot, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } },
  );
  if (result.error !== undefined) throw result.error;
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("IMPORTED_ONLY");
  expect(result.stderr).toBe("");
});
