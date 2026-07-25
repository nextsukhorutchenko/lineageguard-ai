import { randomBytes } from "node:crypto";

export const createRunId = (now: Date): string =>
  `${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")}-${randomBytes(4).toString("hex")}`;
