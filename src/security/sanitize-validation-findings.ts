import type { MigrationArtifactFilename } from "../migrations/render-snowflake-package.js";
import type { PackageFinding } from "../migrations/validate-sql.js";
import { PersistedFindingSchema } from "../runs/run-envelope.js";
import { sanitizeBoundaryText } from "./sanitize-output.js";

const findingFilenames = new Set<MigrationArtifactFilename>([
  "migration-up.sql",
  "migration-down.sql",
  "validation.sql",
  "rollout-plan.md",
]);
const findingKeys = new Set<PropertyKey>(["code", "message", "filename"]);

export function sanitizeValidationFindings(
  findings: readonly unknown[],
  secrets: readonly string[],
): readonly PackageFinding[] {
  if (!Array.isArray(findings)) return [];

  const unique = new Map<string, PackageFinding>();
  for (const finding of findings) {
    const candidate = finding as Partial<PackageFinding>;
    const prototype =
      finding === null || typeof finding !== "object" ? undefined : Object.getPrototypeOf(finding);
    if (
      finding === null ||
      typeof finding !== "object" ||
      (prototype !== Object.prototype && prototype !== null) ||
      !Object.hasOwn(finding, "code") ||
      !Object.hasOwn(finding, "message") ||
      Reflect.ownKeys(finding).some((key) => !findingKeys.has(key)) ||
      typeof candidate.code !== "string" ||
      typeof candidate.message !== "string" ||
      (candidate.filename !== undefined && !findingFilenames.has(candidate.filename))
    ) {
      continue;
    }

    const message = sanitizeBoundaryText(candidate.message, secrets, 500);
    if (message.length === 0) continue;
    const parsed = PersistedFindingSchema.safeParse({
      code: candidate.code,
      message,
      ...(candidate.filename === undefined ? {} : { filename: candidate.filename }),
    });
    if (!parsed.success) continue;
    const normalized: PackageFinding =
      parsed.data.filename === undefined
        ? { code: parsed.data.code, message: parsed.data.message }
        : {
            code: parsed.data.code,
            message: parsed.data.message,
            filename: parsed.data.filename,
          };
    const key = JSON.stringify([normalized.code, normalized.filename ?? "", normalized.message]);
    unique.set(key, normalized);
  }

  return [...unique.values()]
    .sort(
      (left, right) =>
        left.code.localeCompare(right.code, "en") ||
        (left.filename ?? "").localeCompare(right.filename ?? "", "en") ||
        left.message.localeCompare(right.message, "en"),
    )
    .slice(0, 200);
}
