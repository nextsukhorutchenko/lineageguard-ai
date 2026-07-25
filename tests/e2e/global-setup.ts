import { startE2eServer } from "./server-lifecycle.js";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = await startE2eServer();
  process.env.LINEAGEGUARD_E2E_RUNS_DIR = server.runsRoot;
  return async () => {
    try {
      await server.stop();
    } finally {
      delete process.env.LINEAGEGUARD_E2E_RUNS_DIR;
    }
  };
}
