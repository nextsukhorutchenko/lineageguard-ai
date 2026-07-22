import { AppError } from "../errors/app-error.js";
import type { ChangeIntent } from "./change-intent.js";

export interface DatasetCandidate {
  readonly urn: string;
  readonly name: string;
  readonly platform?: string;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");

export function resolveDataset(
  intent: ChangeIntent,
  candidates: readonly DatasetCandidate[],
): DatasetCandidate {
  const hint = normalize(intent.datasetHint);
  const exact = candidates.filter((candidate) => {
    const keys = [candidate.urn, candidate.name];
    if (candidate.platform) keys.push(`${candidate.platform}:${candidate.name}`);
    return keys.some((key) => normalize(key) === hint);
  });

  if (exact.length === 0) {
    throw new AppError("TARGET_NOT_FOUND", `No dataset exactly matches ${intent.datasetHint}.`, {
      searchHint: intent.datasetHint,
    });
  }
  if (exact.length > 1) {
    throw new AppError("NEEDS_USER_CLARIFICATION", "Several datasets match exactly.", {
      candidates: exact.map(({ urn }) => urn).sort(),
    });
  }

  return exact[0]!;
}
