export interface ChangeFormValue {
  readonly dataset: string;
  readonly sourceColumn: string;
  readonly targetColumn: string;
}

export function ChangeRequestForm(props: {
  readonly value: ChangeFormValue;
  readonly busy: boolean;
  readonly locked: boolean;
  readonly onChange: (value: ChangeFormValue) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const field = (key: keyof ChangeFormValue, label: string) => (
    <label>
      <span>{label}</span>
      <input
        value={props.value[key]}
        onChange={(event) => props.onChange({ ...props.value, [key]: event.target.value })}
        disabled={props.busy}
        readOnly={props.locked}
        aria-readonly={props.locked}
        required
      />
    </label>
  );
  return (
    <form
      className="change-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      {field("dataset", "DataHub dataset")}
      <div className="field-grid">
        {field("sourceColumn", "Current column")}
        {field("targetColumn", "New column")}
      </div>
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={props.busy}>
          {props.busy ? "Analyzing…" : "Analyze change"}
        </button>
        {props.busy ? (
          <button className="quiet-button" type="button" onClick={props.onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
