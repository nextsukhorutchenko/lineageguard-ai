import { describe, expect, it } from "vitest";
import { validateSqlArtifact } from "./validate-sql.js";

it("accepts the deterministic Snowflake staged statements", () => {
  expect(
    validateSqlArtifact(
      "migration-up.sql",
      'ALTER TABLE "DB"."PUBLIC"."T" ADD COLUMN IF NOT EXISTS "B" NUMBER(38,0);\nUPDATE "DB"."PUBLIC"."T" SET "B" = "A" WHERE "B" IS NULL;\n',
      "ADVISORY_ONLY",
    ),
  ).toEqual([]);
});

it.each(["DROP TABLE x;", "TRUNCATE TABLE x;", "DELETE FROM x;"])(
  "rejects prohibited statement %s",
  (sql) => {
    expect(validateSqlArtifact("migration-up.sql", sql, "ADVISORY_ONLY")).toContainEqual(
      expect.objectContaining({ code: "PROHIBITED_SQL" }),
    );
  },
);

describe("SQL classification safety", () => {
  it("accepts comments only for a non-executable template", () => {
    expect(
      validateSqlArtifact(
        "migration-up.sql",
        "-- NON-EXECUTABLE TEMPLATE\n-- Evidence: datahub:target-dataset\n",
        "NON_EXECUTABLE_TEMPLATE",
      ),
    ).toEqual([]);
  });

  it("rejects executable statements in a non-executable template", () => {
    expect(
      validateSqlArtifact(
        "migration-up.sql",
        'ALTER TABLE "DB"."PUBLIC"."T" RENAME COLUMN "A" TO "B";',
        "NON_EXECUTABLE_TEMPLATE",
      ),
    ).toContainEqual(expect.objectContaining({ code: "EXECUTABLE_TEMPLATE_SQL" }));
  });

  it("rejects statements outside the allowlist", () => {
    expect(
      validateSqlArtifact(
        "migration-up.sql",
        'INSERT INTO "DB"."PUBLIC"."T" ("A") VALUES (1);',
        "ADVISORY_ONLY",
      ),
    ).toContainEqual(expect.objectContaining({ code: "PROHIBITED_SQL" }));
  });

  it("reports parser failure without changing the supplied classification", () => {
    const findings = validateSqlArtifact(
      "migration-up.sql",
      'ALTER TABLE "DB"."PUBLIC"."T" INVALID SNOWFLAKE SYNTAX;',
      "ADVISORY_ONLY",
    );

    expect(findings).toEqual([
      {
        code: "SNOWFLAKE_PARSE_FAILED",
        message: "SQL parser rejected the statement.",
        filename: "migration-up.sql",
      },
    ]);
  });
});
