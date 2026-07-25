import { z } from "zod";
import { RunsRootPathSchema } from "./runtime-config.js";

const baseSchema = z.object({
  LINEAGEGUARD_DEMO_MODE: z.enum(["LIVE", "REPLAY"]).default("REPLAY"),
  LINEAGEGUARD_RUNS_DIR: RunsRootPathSchema,
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-sol"),
});

export type WebConfig =
  | { readonly mode: "REPLAY"; readonly runsRoot: string }
  | {
      readonly mode: "LIVE";
      readonly runsRoot: string;
      readonly openaiApiKey: string;
      readonly openaiModel: string;
      readonly datahubGmsUrl: string;
      readonly datahubGmsToken: string;
      readonly uvxPath: string;
    };

export function loadWebConfig(
  environment: Readonly<Record<string, string | undefined>>,
): WebConfig {
  const base = baseSchema.safeParse(environment);
  if (!base.success) throw new Error("Demo service configuration is invalid.");
  if (base.data.LINEAGEGUARD_DEMO_MODE === "REPLAY") {
    return { mode: "REPLAY", runsRoot: base.data.LINEAGEGUARD_RUNS_DIR };
  }
  const live = z
    .object({
      OPENAI_API_KEY: z.string().min(1),
      DATAHUB_GMS_URL: z.url(),
      DATAHUB_GMS_TOKEN: z.string().min(1),
      DATAHUB_MCP_UVX_PATH: z.string().min(1).default("uvx"),
    })
    .safeParse(environment);
  if (!live.success) throw new Error("Live demo configuration is incomplete.");
  return {
    mode: "LIVE",
    runsRoot: base.data.LINEAGEGUARD_RUNS_DIR,
    openaiApiKey: live.data.OPENAI_API_KEY,
    openaiModel: base.data.OPENAI_MODEL,
    datahubGmsUrl: live.data.DATAHUB_GMS_URL,
    datahubGmsToken: live.data.DATAHUB_GMS_TOKEN,
    uvxPath: live.data.DATAHUB_MCP_UVX_PATH,
  };
}
