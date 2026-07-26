import { isAbsolute } from "node:path";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";

export type EnvironmentMap = Readonly<Record<string, string | undefined>>;

export const RunsRootPathSchema = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value), "The runs root must be absolute.");

export const AbsoluteExecutablePathSchema = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value), "The executable path must be absolute.");

const environmentSchema = z.object({
  DATAHUB_GMS_URL: z.url(),
  DATAHUB_GMS_TOKEN: z.string().min(1),
  DATAHUB_MCP_UVX_PATH: AbsoluteExecutablePathSchema,
  LINEAGEGUARD_RUNS_DIR: RunsRootPathSchema,
});

export interface RuntimeConfig {
  readonly datahubGmsUrl: string;
  readonly datahubGmsToken: string;
  readonly uvxPath: string;
  readonly runsRoot: string;
  readonly maxHops: 2;
}

function invalidRunsRoot(): AppError {
  return new AppError("ARTIFACT_WRITE_FAILED", "The configured runs root is invalid.");
}

export function loadRuntimeConfig(
  environment: EnvironmentMap,
  runsRootOverride?: string,
): RuntimeConfig {
  const selectedRunsRoot = runsRootOverride ?? environment.LINEAGEGUARD_RUNS_DIR;
  const runsRoot = RunsRootPathSchema.safeParse(selectedRunsRoot);
  if (!runsRoot.success) throw invalidRunsRoot();

  const parsed = environmentSchema.parse({
    ...environment,
    LINEAGEGUARD_RUNS_DIR: runsRoot.data,
  });
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
