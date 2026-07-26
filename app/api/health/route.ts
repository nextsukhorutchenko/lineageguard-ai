import { createPublicReplayHealthHandler } from "../../../src/hosting/public-replay-health.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createPublicReplayHealthHandler();
