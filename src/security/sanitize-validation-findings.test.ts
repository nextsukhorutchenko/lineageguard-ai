import { describe, expect, it } from "vitest";
import { PersistedFindingSchema } from "../runs/run-envelope.js";
import {
  MAX_RAW_VALIDATION_FINDINGS,
  sanitizeValidationFindings,
} from "./sanitize-validation-findings.js";

describe("sanitizeValidationFindings", () => {
  it("rebuilds a closed, secret-free finding that satisfies the persisted schema", () => {
    const secret = "provider-secret-value";
    const result = sanitizeValidationFindings(
      [
        {
          code: "PROHIBITED_SQL",
          message: `Provider failed with ${secret}\ntrace`,
          filename: "migration-up.sql",
        },
      ],
      [secret],
    );

    expect(result).toEqual([
      {
        code: "PROHIBITED_SQL",
        message: "Provider failed with [REDACTED]\\ntrace",
        filename: "migration-up.sql",
      },
    ]);
    expect(() => result.forEach((finding) => PersistedFindingSchema.parse(finding))).not.toThrow();
  });

  it("rejects extra keys, invalid values, and native exception objects", () => {
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
          { code: "invalid-code", message: "invalid code" },
          { code: "INVALID_FILENAME", message: "invalid filename", filename: "../../secret.txt" },
          error,
        ],
        [],
      ),
    ).toEqual([]);
  });

  it("drops messages that are empty after sanitization", () => {
    expect(
      sanitizeValidationFindings(
        [
          { code: "EMPTY", message: "" },
          { code: "VALID", message: "Visible message", filename: "validation.sql" },
        ],
        [],
      ),
    ).toEqual([{ code: "VALID", message: "Visible message", filename: "validation.sql" }]);
  });

  it("deduplicates by the complete canonical tuple after sanitization", () => {
    expect(
      sanitizeValidationFindings(
        [
          { code: "A_CODE", message: "same", filename: "migration-up.sql" },
          { code: "A_CODE", message: "same", filename: "migration-up.sql" },
          { code: "A_CODE", message: "same", filename: "migration-down.sql" },
          { code: "A_CODE", message: "different", filename: "migration-up.sql" },
        ],
        [],
      ),
    ).toEqual([
      { code: "A_CODE", message: "same", filename: "migration-down.sql" },
      { code: "A_CODE", message: "different", filename: "migration-up.sql" },
      { code: "A_CODE", message: "same", filename: "migration-up.sql" },
    ]);
  });

  it("returns findings in canonical code, filename, and message order", () => {
    expect(
      sanitizeValidationFindings(
        [
          { code: "Z_CODE", message: "z", filename: "validation.sql" },
          { code: "A_CODE", message: "z", filename: "migration-down.sql" },
          { code: "A_CODE", message: "a", filename: "migration-down.sql" },
          { code: "A_CODE", message: "no filename" },
        ],
        [],
      ),
    ).toEqual([
      { code: "A_CODE", message: "no filename" },
      { code: "A_CODE", message: "a", filename: "migration-down.sql" },
      { code: "A_CODE", message: "z", filename: "migration-down.sql" },
      { code: "Z_CODE", message: "z", filename: "validation.sql" },
    ]);
  });

  it("accepts exactly 200 unique valid findings", () => {
    const findings = Array.from({ length: 200 }, (_, index) => ({
      code: "VALID_FINDING",
      message: `Finding ${index.toString().padStart(3, "0")}`,
      filename: "validation.sql",
    }));

    const result = sanitizeValidationFindings(findings, []);

    expect(result).toHaveLength(200);
    expect(() => result.forEach((finding) => PersistedFindingSchema.parse(finding))).not.toThrow();
  });

  it("caps at 200 only after validation and deduplication", () => {
    const findings = [
      { code: "invalid-code", message: "drop me" },
      { code: "VALID_FINDING", message: "Finding 000", filename: "validation.sql" },
      ...Array.from({ length: 201 }, (_, index) => ({
        code: "VALID_FINDING",
        message: `Finding ${index.toString().padStart(3, "0")}`,
        filename: "validation.sql",
      })),
    ];

    const result = sanitizeValidationFindings(findings, []);

    expect(result).toHaveLength(200);
    expect(result[0]?.message).toBe("Finding 000");
    expect(result.at(-1)?.message).toBe("Finding 199");
    expect(() => result.forEach((finding) => PersistedFindingSchema.parse(finding))).not.toThrow();
  });

  it("accepts the exact raw input boundary and still inspects its last item", () => {
    const findings = Array.from({ length: MAX_RAW_VALIDATION_FINDINGS }, (_, index) => ({
      code: index === MAX_RAW_VALIDATION_FINDINGS - 1 ? "A_LAST_ITEM" : "Z_VALID_FINDING",
      message: `Finding ${index.toString().padStart(4, "0")}`,
      filename: "validation.sql",
    }));

    const result = sanitizeValidationFindings(findings, []);

    expect(result).toHaveLength(200);
    expect(result[0]).toEqual({
      code: "A_LAST_ITEM",
      message: `Finding ${(MAX_RAW_VALIDATION_FINDINGS - 1).toString().padStart(4, "0")}`,
      filename: "validation.sql",
    });
  });

  it("fails closed at raw maximum plus one without reading a hostile element", () => {
    let elementReads = 0;
    const findings = new Array<unknown>(MAX_RAW_VALIDATION_FINDINGS + 1);
    Object.defineProperty(findings, 0, {
      configurable: true,
      get() {
        elementReads += 1;
        throw new Error("hostile element getter");
      },
    });

    expect(sanitizeValidationFindings(findings, [])).toEqual([]);
    expect(elementReads).toBe(0);
  });
});
