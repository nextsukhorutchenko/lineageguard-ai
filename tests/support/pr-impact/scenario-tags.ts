export const SCENARIO_TAGS = [
  "@artifact-safety",
  "@golden-flow",
  "@harness",
  "@responsive",
  "@runtime-proof",
  "@shell",
  "@workflow-terminal",
] as const;

export type ScenarioTag = (typeof SCENARIO_TAGS)[number];
