import { runPublicReplayServer } from "./public-replay-bootstrap.js";

process.exitCode = await runPublicReplayServer(process.env).catch(() => {
  process.stderr.write("Public replay failed to start.\n");
  return 1;
});
