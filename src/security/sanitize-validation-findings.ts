import type { MigrationArtifactFilename } from "../migrations/render-snowflake-package.js";
import type { PackageFinding } from "../migrations/validate-sql.js";
import { sanitizeBoundaryText } from "./sanitize-output.js";

const findingCodePattern = /^[A-Z][A-Z0-9_]{0,99}$/u;
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

  return findings
    .slice(0, 200)
    .flatMap((finding) => {
      const candidate = finding as Partial<PackageFinding>;
      const prototype =
        finding === null || typeof finding !== "object"
          ? undefined
          : Object.getPrototypeOf(finding);
      if (
        finding === null ||
        typeof finding !== "object" ||
        (prototype !== Object.prototype && prototype !== null) ||
        !Object.hasOwn(finding, "code") ||
        !Object.hasOwn(finding, "message") ||
        Reflect.ownKeys(finding).some((key) => !findingKeys.has(key)) ||
        typeof candidate.code !== "string" ||
        !findingCodePattern.test(candidate.code) ||
        typeof candidate.message !== "string" ||
        (candidate.filename !== undefined && !findingFilenames.has(candidate.filename))
      ) {
        return [];
      }

      return [
        {
          code: candidate.code,
          message: sanitizeBoundaryText(candidate.message, secrets, 500),
          ...(candidate.filename === undefined ? {} : { filename: candidate.filename }),
        },
      ];
    })
    .sort(
      (left, right) =>
        left.code.localeCompare(right.code, "en") ||
        (left.filename ?? "").localeCompare(right.filename ?? "", "en") ||
        left.message.localeCompare(right.message, "en"),
    );
}
