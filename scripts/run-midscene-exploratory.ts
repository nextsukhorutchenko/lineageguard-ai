import { runMidsceneExploratory } from "../tests/support/midscene-runner.js";

process.exitCode = await runMidsceneExploratory({
  cwd: process.cwd(),
  env: process.env,
});
