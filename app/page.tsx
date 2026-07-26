import { loadWebConfig } from "../src/config/web-config.js";
import { DemoClient } from "../src/ui/demo-client.js";

export const dynamic = "force-dynamic";

export default function Page() {
  let config: ReturnType<typeof loadWebConfig>;
  try {
    config = loadWebConfig(process.env);
  } catch {
    return (
      <main>
        <section className="panel" role="alert">
          <p className="eyebrow">Configuration required</p>
          <h1>LineageGuard AI is not ready to start.</h1>
          <p>Check the server-only live demo environment and restart the local application.</p>
        </section>
      </main>
    );
  }
  return <DemoClient initialMode={config.mode} deploymentProfile={config.deploymentProfile} />;
}
