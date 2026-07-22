import { z } from "zod";
import { AppError } from "../errors/app-error.js";

const identifier = "[A-Za-z_][A-Za-z0-9_$]*";
const renamePattern = new RegExp(
  `^rename\\s+(?:the\\s+)?column\\s+(${identifier})\\s+to\\s+(${identifier})\\s+in\\s+(?:the\\s+)?dataset\\s+(.+?)\\.?$`,
  "i",
);
const unsafeDatasetHintPattern = /[;\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const canonicalDatasetHintPattern =
  /^urn:li:dataset:\(urn:li:dataPlatform:[^(),]+,[^(),]+,[^(),]+\)$/u;
const secondaryDatasetClausePattern =
  /(?:,\s*|[([{]\s*|[.!?]\s+|\b(?:and|also|then)\s+)(?:rename|drop|add|alter|change|remove|delete)\b/i;

function secondaryClauseInspectionText(value: string): string {
  return canonicalDatasetHintPattern.test(value) ? "urn:li:dataset:()" : value;
}

export const changeIntentSchema = z.object({
  kind: z.literal("rename_column"),
  datasetHint: z.string().trim().min(1),
  sourceColumn: z.string().regex(new RegExp(`^${identifier}$`)),
  targetColumn: z.string().regex(new RegExp(`^${identifier}$`)),
});
export type ChangeIntent = z.infer<typeof changeIntentSchema>;

export function parseChangeIntent(request: string): ChangeIntent {
  const match = request.trim().match(renamePattern);
  const datasetHint = match?.[3]?.trim();
  if (
    !match ||
    datasetHint === undefined ||
    unsafeDatasetHintPattern.test(datasetHint) ||
    secondaryDatasetClausePattern.test(secondaryClauseInspectionText(datasetHint))
  ) {
    throw new AppError(
      "INVALID_REQUEST",
      "Supported format: Rename column <source> to <target> in dataset <dataset hint>.",
    );
  }

  return changeIntentSchema.parse({
    kind: "rename_column",
    sourceColumn: match[1],
    targetColumn: match[2],
    datasetHint,
  });
}
