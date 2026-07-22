import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("removes secret keys and literal secret values recursively without mutating the input", () => {
    const secret = "dhp_example_secret_123";
    const input = {
      AuThOrIzAtIoN: `Bearer ${secret}`,
      ToKeN: "visible token value",
      pAsSwOrD: "datahub",
      SeCrEt: "visible secret value",
      aPiKeY: "visible API key",
      PrIvAtEkEy: "visible private key",
      nested: {
        note: `token=${secret}`,
        values: ["datahub", `prefix-${secret}-suffix`],
      },
    };
    const snapshot = structuredClone(input);

    expect(redact(input, [secret, "datahub", ""])).toEqual({
      AuThOrIzAtIoN: "[REDACTED]",
      ToKeN: "[REDACTED]",
      pAsSwOrD: "[REDACTED]",
      SeCrEt: "[REDACTED]",
      aPiKeY: "[REDACTED]",
      PrIvAtEkEy: "[REDACTED]",
      nested: {
        note: "token=[REDACTED]",
        values: ["[REDACTED]", "prefix-[REDACTED]-suffix"],
      },
    });
    expect(input).toEqual(snapshot);
  });
});
