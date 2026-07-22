import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { isCanonicalDatasetUrn } from "./resolve-dataset.js";

const identifier = "[A-Za-z_][A-Za-z0-9_$]*";
const renamePattern = new RegExp(
  `^rename\\s+(?:the\\s+)?column\\s+(${identifier})\\s+to\\s+(${identifier})\\s+in\\s+(?:the\\s+)?dataset\\s+(.+?)\\.?$`,
  "i",
);
const unsafeDatasetHintPattern = /[;\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const changeVerbs = new Set(["rename", "drop", "add", "alter", "change", "remove", "delete"]);
const openingDelimiters = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);
const closingDelimiters = new Set(openingDelimiters.values());
const wordCharacterPattern = /[A-Za-z0-9_$]/;

function isClauseBoundary(character: string | undefined): boolean {
  return (
    character !== undefined &&
    (/\s/u.test(character) ||
      character === "," ||
      character === "/" ||
      openingDelimiters.has(character) ||
      closingDelimiters.has(character))
  );
}

function hasSecondaryChangeClause(value: string): boolean {
  if (isCanonicalDatasetUrn(value)) return false;

  const delimiterStack: string[] = [];
  let index = 0;
  while (index < value.length) {
    const character = value[index]!;
    const closingDelimiter = openingDelimiters.get(character);
    if (closingDelimiter !== undefined) {
      delimiterStack.push(closingDelimiter);
      index += 1;
      continue;
    }
    if (closingDelimiters.has(character)) {
      if (delimiterStack.at(-1) === character) delimiterStack.pop();
      index += 1;
      continue;
    }
    if (!wordCharacterPattern.test(character)) {
      index += 1;
      continue;
    }

    const wordStart = index;
    while (index < value.length && wordCharacterPattern.test(value[index]!)) index += 1;
    const word = value.slice(wordStart, index).toLocaleLowerCase("en-US");
    if (
      changeVerbs.has(word) &&
      (delimiterStack.length > 0 || isClauseBoundary(value[wordStart - 1]))
    ) {
      return true;
    }
  }

  return false;
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
    hasSecondaryChangeClause(datasetHint)
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
