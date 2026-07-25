import type { ValidationSummary, WorkflowFailure } from "../workflow/contracts.js";

export function RunError(props: {
  readonly failure: WorkflowFailure | undefined;
  readonly validation: ValidationSummary | undefined;
  readonly onSelectCandidate: (urn: string) => void;
  readonly onRetryGeneration: () => void;
  readonly canRetryGeneration: boolean;
}) {
  if (props.failure === undefined) return null;
  return (
    <section className="error-panel" role="alert">
      <strong>{props.failure.code.replaceAll("_", " ")}</strong>
      <p>{props.failure.message}</p>
      {props.failure.code === "VALIDATION_FAILED" && props.validation?.outcome === "REJECTED" && (
        <div>
          <p>{props.validation.findingCount} validation findings (unvalidated draft).</p>
          <ul>
            {props.validation.findingCodes.map((code) => (
              <li key={code}>{code.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </div>
      )}
      {props.failure.candidates?.map((candidate) => (
        <button key={candidate} type="button" onClick={() => props.onSelectCandidate(candidate)}>
          Use {candidate}
        </button>
      ))}
      {props.canRetryGeneration &&
        (props.failure.code === "GENERATION_FAILED" ||
          props.failure.code === "VALIDATION_FAILED") && (
          <button type="button" onClick={props.onRetryGeneration}>
            Retry generation
          </button>
        )}
    </section>
  );
}
