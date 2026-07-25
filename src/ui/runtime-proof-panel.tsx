import type { WorkflowSnapshot } from "../workflow/contracts.js";

export type RuntimeProofSnapshot = Pick<WorkflowSnapshot, "mode" | "datahub" | "agent">;

const callLabel = (calls: number): string => `${calls} ${calls === 1 ? "call" : "calls"}`;

export function RuntimeProofPanel({
  snapshot,
}: {
  readonly snapshot: RuntimeProofSnapshot | undefined;
}) {
  const datahub = snapshot?.datahub;
  const agent = snapshot?.agent;
  if (datahub === undefined || agent === undefined) {
    return (
      <section className="panel runtime-proof" aria-labelledby="runtime-proof-title">
        <div className="section-heading">
          <p className="eyebrow">Auditable execution</p>
          <h2 id="runtime-proof-title">Runtime proof</h2>
        </div>
        <p>Runtime proof is not available for this state.</p>
      </section>
    );
  }
  const isLive = datahub.verification === "CAPABILITY_GATE_PASSED";
  const source = isLive ? "Verified live MCP" : "Fixture replay";
  const packageLabel = isLive ? "MCP package used" : "Pinned live reference";
  const extraToolStatement = isLive
    ? "Additional advertised tools are ignored."
    : "All other tools are outside the application allowlist.";
  const mutationStatement = isLive
    ? "Mutations are disabled in the live MCP configuration."
    : "Replay has no mutation capability.";
  const server =
    datahub.reportedServerName === undefined
      ? "Not reported"
      : [datahub.reportedServerName, datahub.reportedServerVersion].filter(Boolean).join(" ");

  return (
    <section className="panel runtime-proof" aria-labelledby="runtime-proof-title">
      <div className="section-heading">
        <p className="eyebrow">Auditable execution</p>
        <h2 id="runtime-proof-title">Runtime proof</h2>
      </div>
      <div className="runtime-proof-grid">
        <div>
          <h3>DataHub boundary</h3>
          <dl>
            <dt>Source</dt>
            <dd>{source}</dd>
            <dt>Verification</dt>
            <dd>{isLive ? "Capability gate passed" : "Replay fixture"}</dd>
            <dt>{packageLabel}</dt>
            <dd>{datahub.configuredMcpPackage}</dd>
            <dt>Reported server</dt>
            <dd>{server}</dd>
          </dl>
          <h4>Required read-only operations</h4>
          <ul className="runtime-proof-list">
            {datahub.allowedTools.map((tool) => (
              <li key={tool}>
                <code>{tool}</code>
              </li>
            ))}
          </ul>
          <p>{extraToolStatement}</p>
          <p>{mutationStatement}</p>
        </div>
        <div>
          <h3>Agent boundary</h3>
          <dl>
            <dt>Provider</dt>
            <dd>{agent.provider}</dd>
            <dt>Model</dt>
            <dd>{agent.model}</dd>
            <dt>Reasoning</dt>
            <dd>{agent.reasoningEffort}</dd>
          </dl>
          <h4>Application tools</h4>
          <ul className="runtime-proof-list">
            {agent.toolCalls.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                <span>
                  {callLabel(tool.calls)} · {tool.outcome.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
