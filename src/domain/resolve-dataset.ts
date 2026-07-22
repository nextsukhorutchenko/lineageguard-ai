import { AppError } from "../errors/app-error.js";
import type { ChangeIntent } from "./change-intent.js";

export interface DatasetCandidate {
  readonly urn: string;
  readonly name: string;
  readonly platform?: string;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");

const datasetUrnPrefix = "urn:li:dataset:(";
const dataPlatformUrnPrefix = "urn:li:dataPlatform:";
const invalidRawComponentCharacter = /[(),]/;

function isCanonicalUrnComponent(value: string): boolean {
  return value.length > 0 && !value.includes("\u001F") && !invalidRawComponentCharacter.test(value);
}

function platformQualifiedUrnIdentity(urn: string): string | undefined {
  if (!urn.startsWith(datasetUrnPrefix) || !urn.endsWith(")")) return undefined;

  const components = urn.slice(datasetUrnPrefix.length, -1).split(",");
  if (components.length !== 3) return undefined;

  const [platformUrn, datasetName, environment] = components;
  if (
    platformUrn === undefined ||
    datasetName === undefined ||
    environment === undefined ||
    !platformUrn.startsWith(dataPlatformUrnPrefix) ||
    !isCanonicalUrnComponent(platformUrn) ||
    !isCanonicalUrnComponent(datasetName) ||
    !isCanonicalUrnComponent(environment)
  ) {
    return undefined;
  }

  const platform = platformUrn.slice(dataPlatformUrnPrefix.length);
  return platform.length === 0 ? undefined : `${platform}:${datasetName}`;
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
