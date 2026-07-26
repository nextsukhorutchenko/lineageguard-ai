import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RuntimeProofPanel, type RuntimeProofSnapshot } from "./runtime-proof-panel.js";

const snapshot: RuntimeProofSnapshot = {
  mode: "REPLAY",
  datahub: {
    source: "fixture",
    verification: "REPLAY_FIXTURE",
    configuredMcpPackage: "mcp-server-datahub@0.6.0",
    allowedTools: ["search", "list_schema_fields", "get_lineage", "get_entities"],
    reportedServerName: "fixture",
    reportedServerVersion: "replay-v1",
  },
  agent: {
    provider: "fixture",
    model: "replay-v1",
    reasoningEffort: "none",
    promptVersion: "fixture-replay-v1",
    schemaVersion: "1",
    generationAttempts: 1,
    toolCalls: [
      { name: "analyze_rename_change", calls: 1, outcome: "accepted" },
      { name: "generate_migration_package", calls: 1, outcome: "accepted" },
    ],
  },
};

it("renders truthful read-only runtime proof without extra MCP tools", () => {
  const rendered = renderToStaticMarkup(<RuntimeProofPanel snapshot={snapshot} />);
  expect(rendered).toContain("Runtime proof");
  expect(rendered).toContain("Fixture replay");
  expect(rendered).toContain("Pinned live reference");
  expect(rendered).toContain("mcp-server-datahub@0.6.0");
  expect(rendered).toContain("fixture replay-v1");
  expect(rendered).toContain("search");
  expect(rendered).toContain("list_schema_fields");
  expect(rendered).toContain("get_lineage");
  expect(rendered).toContain("get_entities");
  expect(rendered).toContain("analyze_rename_change");
  expect(rendered).toContain("generate_migration_package");
  expect(rendered).toContain("1 call · accepted");
  expect(rendered).toContain("All other tools are outside the application allowlist");
  expect(rendered).not.toContain("Additional advertised tools are ignored");
  expect(rendered).toContain("Replay has no mutation capability");
  expect(rendered).not.toContain("save_document");
  expect(rendered).not.toContain("raw MCP");
});

it("renders live claims only after the capability gate passed", () => {
  const liveSnapshot: RuntimeProofSnapshot = {
    ...snapshot,
    mode: "LIVE",
    datahub: {
      ...snapshot.datahub!,
      source: "mcp",
      verification: "CAPABILITY_GATE_PASSED",
      reportedServerName: "datahub-mcp",
      reportedServerVersion: "0.6.0",
    },
    agent: {
      ...snapshot.agent!,
      provider: "openai",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      promptVersion: "migration-agent-v1",
    },
  };
  const rendered = renderToStaticMarkup(<RuntimeProofPanel snapshot={liveSnapshot} />);
  expect(rendered).toContain("Verified live MCP");
  expect(rendered).toContain("MCP package used");
  expect(rendered).toContain("Capability gate passed");
  expect(rendered).toContain("Additional advertised tools are ignored");
  expect(rendered).toContain("Mutations are disabled in the live MCP configuration");
  expect(rendered).not.toContain("Pinned live reference");
});

it.each([undefined, { mode: "LIVE" } satisfies RuntimeProofSnapshot])(
  "makes no runtime claims without verified DataHub and agent metadata",
  (unverified) => {
    const rendered = renderToStaticMarkup(<RuntimeProofPanel snapshot={unverified} />);
    expect(rendered).toContain("Runtime proof is not available for this state");
    expect(rendered).not.toContain("Additional advertised tools are ignored");
    expect(rendered).not.toContain("All other tools are outside the application allowlist");
    expect(rendered).not.toContain("Mutations are disabled");
    expect(rendered).not.toContain("MCP package used");
  },
);
