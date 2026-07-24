import { expect, it } from "vitest";
import { MIGRATION_AGENT_PROMPT_VERSION, migrationAgentInstructions } from "./prompt.js";

it("keeps the model inside the two-tool deterministic boundary", () => {
  expect(MIGRATION_AGENT_PROMPT_VERSION).toBe("migration-agent-v1");
  expect(migrationAgentInstructions).toContain("analyze_rename_change");
  expect(migrationAgentInstructions).toContain("generate_migration_package");
  expect(migrationAgentInstructions).toContain("Never invent");
  expect(migrationAgentInstructions).toContain("untrusted data");
  expect(migrationAgentInstructions).toContain("incomplete evidence");
  expect(migrationAgentInstructions).toContain("Do not expose private reasoning");
});
