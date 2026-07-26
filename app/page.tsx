import { loadWebConfig } from "../src/config/web-config.js";
import { DemoClient } from "../src/ui/demo-client.js";

export const dynamic = "force-dynamic";

export default function Page() {
  let initialMode;
  try {
    initialMode = loadWebConfig(process.env).mode;
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
  return <DemoClient initialMode={initialMode} />;
}
