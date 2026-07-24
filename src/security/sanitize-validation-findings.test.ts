import { describe, expect, it } from "vitest";
import { sanitizeValidationFindings } from "./sanitize-validation-findings.js";

describe("sanitizeValidationFindings", () => {
  it("rebuilds a closed, bounded, secret-free finding shape", () => {
    const secret = "provider-secret-value";
    const finding = {
      code: "PROHIBITED_SQL",
      message: `Provider failed with ${secret}\ntrace`,
      filename: "migration-up.sql",
    };

    expect(sanitizeValidationFindings([finding], [secret])).toEqual([
      {
        code: "PROHIBITED_SQL",
        message: "Provider failed with [REDACTED]\\ntrace",
        filename: "migration-up.sql",
      },
    ]);
  });

  it("rejects extra keys and native exception objects", () => {
    const error = Object.assign(new Error("native failure"), {
      code: "NATIVE_FAILURE",
      filename: "validation.sql" as const,
    });

    expect(
      sanitizeValidationFindings(
        [
          {
            code: "EXTRA_SHAPE",
            message: "must not persist",
            filename: "validation.sql",
            nativeError: "trace envelope",
          },
          error,
        ],
        [],
      ),
    ).toEqual([]);
  });

  it("drops invalid codes and filenames and caps output at 200 findings", () => {
    const findings = Array.from({ length: 201 }, (_, index) => ({
      code: index === 0 ? "invalid-code" : "VALID_FINDING",
      message: `Finding ${index}`,
      filename: index === 1 ? "../../secret.txt" : "validation.sql",
    }));

    const sanitized = sanitizeValidationFindings(findings, []);

    expect(sanitized).toHaveLength(198);
    expect(sanitized.every(({ code }) => code === "VALID_FINDING")).toBe(true);
    expect(sanitized.every(({ filename }) => filename === "validation.sql")).toBe(true);
  });

  it("returns findings in deterministic canonical order", () => {
    expect(
      sanitizeValidationFindings(
        [
          { code: "Z_CODE", message: "z", filename: "validation.sql" },
          { code: "A_CODE", message: "a", filename: "migration-down.sql" },
        ],
        [],
      ),
    ).toEqual([
      { code: "A_CODE", message: "a", filename: "migration-down.sql" },
      { code: "Z_CODE", message: "z", filename: "validation.sql" },
    ]);
  });
});
