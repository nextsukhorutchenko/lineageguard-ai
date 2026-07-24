export type AdvisoryDecision =
  "PROCEED_WITH_REVIEW" | "MANUAL_APPROVAL_REQUIRED" | "BLOCK_DIRECT_RENAME";

export function decideRisk(score: number): AdvisoryDecision {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError("Impact score must be an integer from 0 through 100.");
  }
  if (score < 40) return "PROCEED_WITH_REVIEW";
  if (score < 75) return "MANUAL_APPROVAL_REQUIRED";
  return "BLOCK_DIRECT_RENAME";
}
