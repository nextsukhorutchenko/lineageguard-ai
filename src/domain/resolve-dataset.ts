import { AppError } from "../errors/app-error.js";
import type { ChangeIntent } from "./change-intent.js";

export interface DatasetCandidate {
  readonly urn: string;
  readonly name: string;
  readonly platform?: string;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");

const datasetUrnPattern = /^urn:li:dataset:\(urn:li:dataPlatform:([^,()]+),(.+),([^,()]+)\)$/;

function platformQualifiedUrnIdentity(urn: string): string | undefined {
  const match = datasetUrnPattern.exec(urn);
  const platform = match?.[1];
  const datasetName = match?.[2];
  return platform === undefined || datasetName === undefined
    ? undefined
    : `${platform}:${datasetName}`;
}

export function resolveDataset(
  intent: ChangeIntent,
  candidates: readonly DatasetCandidate[],
): DatasetCandidate {
  const hint = normalize(intent.datasetHint);
  const exact = candidates.filter((candidate) => {
    const keys = [candidate.urn, candidate.name];
    if (candidate.platform) keys.push(`${candidate.platform}:${candidate.name}`);
    const urnIdentity = platformQualifiedUrnIdentity(candidate.urn);
    if (urnIdentity) keys.push(urnIdentity);
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
