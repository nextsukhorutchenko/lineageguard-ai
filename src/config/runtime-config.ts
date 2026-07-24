import { z } from "zod";

export type EnvironmentMap = Readonly<Record<string, string | undefined>>;

const environmentSchema = z.object({
  DATAHUB_GMS_URL: z.url(),
  DATAHUB_GMS_TOKEN: z.string().min(1),
  DATAHUB_MCP_UVX_PATH: z.string().min(1).default("uvx"),
  LINEAGEGUARD_RUNS_DIR: z.string().min(1).default("runs"),
});

export interface RuntimeConfig {
  readonly datahubGmsUrl: string;
  readonly datahubGmsToken: string;
  readonly uvxPath: string;
  readonly runsRoot: string;
  readonly maxHops: 2;
}

export function loadRuntimeConfig(environment: EnvironmentMap): RuntimeConfig {
  const parsed = environmentSchema.parse(environment);
  const config = {
    datahubGmsUrl: parsed.DATAHUB_GMS_URL,
    uvxPath: parsed.DATAHUB_MCP_UVX_PATH,
    runsRoot: parsed.LINEAGEGUARD_RUNS_DIR,
    maxHops: 2 as const,
  } as RuntimeConfig;

  Object.defineProperty(config, "datahubGmsToken", {
    enumerable: false,
    value: parsed.DATAHUB_GMS_TOKEN,
    writable: false,
  });

  return Object.freeze(config);
}
