import { startPublicReplayE2eServer } from "./public-replay-server-lifecycle.js";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = await startPublicReplayE2eServer();
  process.env.LINEAGEGUARD_PUBLIC_REPLAY_E2E_RUNS_DIR = server.runsRoot;
  return async () => {
    try {
      await server.stop();
    } finally {
      delete process.env.LINEAGEGUARD_PUBLIC_REPLAY_E2E_RUNS_DIR;
    }
  };
}
