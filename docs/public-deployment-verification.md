# Public Deployment Verification

Status: PASSED
Mode: PUBLIC_REPLAY
Access: No login, DataHub, OpenAI, API key, or paid account required
Storage: Ephemeral runs; rerun the deterministic replay after restart
Project URL: https://lineageguard-ai-replay.onrender.com
Reviewed runtime commit: 7f9a534983ff58d0f6df66da0708cc5e34c0f4cd
Verified date (UTC): 2026-07-27T05:42:44Z
Verified date (Europe/Kyiv): 2026-07-27T08:42:44+03:00

## Sanitized Acceptance Evidence

| Check                  | Sanitized verified fact                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Health                 | PASSED — The public replay health endpoint was reachable.                          |
| Private-browser access | PASSED — The replay opened without a login, provider credential, or paid account.  |
| Golden result          | PASSED — The deterministic replay produced 24 / 11 / 90 and `BLOCK_DIRECT_RENAME`. |
| Four artifacts         | PASSED — All four allowlisted artifacts were available through the replay.         |
| Headers                | PASSED — Required cache and browser-security headers were present.                 |
| Console                | PASSED — The browser console had no errors or warnings.                            |
| Request host           | PASSED — Requests stayed on https://lineageguard-ai-replay.onrender.com.           |

The visible mode is Public fixture replay. No DataHub or OpenAI credentials are used. Ephemeral
runs are expected; rerun the deterministic replay if a restart removes a run.
