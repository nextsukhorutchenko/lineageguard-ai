import { z } from "zod";
import { AppError } from "../errors/app-error.js";

const identifier = "[A-Za-z_][A-Za-z0-9_$]*";
const renamePattern = new RegExp(
  `^rename\\s+(?:the\\s+)?column\\s+(${identifier})\\s+to\\s+(${identifier})\\s+in\\s+(?:the\\s+)?dataset\\s+(.+?)\\.?$`,
  "i",
);
const secondChangePattern = /\b(and|also|then)\s+(rename|drop|add|change)\b/i;

export const changeIntentSchema = z.object({
  kind: z.literal("rename_column"),
  datasetHint: z.string().trim().min(1),
  sourceColumn: z.string().regex(new RegExp(`^${identifier}$`)),
  targetColumn: z.string().regex(new RegExp(`^${identifier}$`)),
});
export type ChangeIntent = z.infer<typeof changeIntentSchema>;

export function parseChangeIntent(request: string): ChangeIntent {
  const match = request.trim().match(renamePattern);
  if (!match || secondChangePattern.test(request)) {
    throw new AppError(
      "INVALID_REQUEST",
      "Supported format: Rename column <source> to <target> in dataset <dataset hint>.",
    );
  }

  return changeIntentSchema.parse({
    kind: "rename_column",
    sourceColumn: match[1],
    targetColumn: match[2],
    datasetHint: match[3],
  });
}
