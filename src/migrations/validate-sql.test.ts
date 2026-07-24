import { describe, expect, it } from "vitest";
import { executableSqlStatements, validateSqlArtifact } from "./validate-sql.js";

it("accepts the deterministic Snowflake staged statements", () => {
  expect(
    validateSqlArtifact(
      "migration-up.sql",
      'ALTER TABLE "DB"."PUBLIC"."T" ADD COLUMN IF NOT EXISTS "B" NUMBER(38,0);\nUPDATE "DB"."PUBLIC"."T" SET "B" = "A" WHERE "B" IS NULL;\n',
      "ADVISORY_ONLY",
    ),
  ).toEqual([]);
});

it.each([
  'ALTER TABLE "DB"."PUBLIC"."T" RENAME COLUMN "A" TO "B";',
  'SHOW COLUMNS IN TABLE "DB"."PUBLIC"."T";',
  'SELECT COUNT(*) AS row_count, COUNT_IF("B" IS NULL) AS target_null_count FROM "DB"."PUBLIC"."T";',
  'SELECT COUNT(*) AS row_count, COUNT_IF("A" IS NULL) AS source_null_count, COUNT_IF("B" IS NULL) AS target_null_count, COUNT_IF("A" IS DISTINCT FROM "B") AS mismatched_count FROM "DB"."PUBLIC"."T";',
])("accepts supported rendered statement shape %s", (sql) => {
  expect(validateSqlArtifact("validation.sql", sql, "EXECUTABLE_WITH_REVIEW")).toEqual([]);
});

it.each(["DROP TABLE x;", "TRUNCATE TABLE x;", "DELETE FROM x;"])(
  "rejects prohibited statement %s",
  (sql) => {
    expect(validateSqlArtifact("migration-up.sql", sql, "ADVISORY_ONLY")).toContainEqual(
      expect.objectContaining({ code: "PROHIBITED_SQL" }),
    );
  },
);

it.each([
  'ALTER TABLE "DB"."PUBLIC"."T" DROP COLUMN "A";',
  'ALTER TABLE "DB"."PUBLIC"."T" RENAME TO "OTHER";',
  'ALTER TABLE "DB"."PUBLIC"."T" ALTER COLUMN "A" SET NOT NULL;',
  'ALTER TABLE "DB"."PUBLIC"."T" ADD COLUMN "B" NUMBER(38,0);',
  'UPDATE "DB"."PUBLIC"."T" SET "B" = 1 WHERE "B" IS NULL;',
  'UPDATE "DB"."PUBLIC"."T" SET "B" = "A";',
  'UPDATE "DB"."PUBLIC"."T" SET "B" = "A" WHERE "A" IS NULL;',
  'SELECT * FROM "DB"."PUBLIC"."T";',
  'SELECT COUNT(*) FROM "DB"."PUBLIC"."T";',
])("rejects unsupported statement shape %s", (sql) => {
  expect(validateSqlArtifact("migration-up.sql", sql, "ADVISORY_ONLY")).toContainEqual(
    expect.objectContaining({ code: "PROHIBITED_SQL" }),
  );
});

it("preserves semicolons and comment markers inside quoted identifiers", () => {
  const statement =
    'ALTER TABLE "DB"."PUBLIC"."T" RENAME COLUMN "A;--in""side" TO "B--still;in""side"';
  const sql = `-- leading comment\n${statement}; -- trailing comment with ;\n`;

  expect(executableSqlStatements(sql)).toEqual([statement]);
  expect(validateSqlArtifact("migration-up.sql", sql, "EXECUTABLE_WITH_REVIEW")).toEqual([]);
});

it("splits real comments and statement delimiters outside quoted identifiers", () => {
  expect(
    executableSqlStatements(
      '-- comment with ; and "quotes"\nSHOW COLUMNS IN TABLE "DB"."PUBLIC"."T"; -- trailing ;\nSELECT COUNT(*) AS row_count, COUNT_IF("B" IS NULL) AS target_null_count FROM "DB"."PUBLIC"."T";\n',
    ),
  ).toEqual([
    'SHOW COLUMNS IN TABLE "DB"."PUBLIC"."T"',
    'SELECT COUNT(*) AS row_count, COUNT_IF("B" IS NULL) AS target_null_count FROM "DB"."PUBLIC"."T"',
  ]);
});

it.each([
  ["vertical tab", "\u000b"],
  ["form feed", "\u000c"],
  ["carriage return", "\r"],
  ["NUL", "\u0000"],
  ["Unicode line separator", "\u2028"],
  ["Unicode paragraph separator", "\u2029"],
] as const)("rejects unsafe %s before parser-exempt statements", (_label, unsafe) => {
  for (const sql of [
    `SHOW${unsafe}COLUMNS IN TABLE "DB"."PUBLIC"."T";`,
    `ALTER TABLE "DB"."PUBLIC"."T"${unsafe}RENAME COLUMN "A" TO "B";`,
  ]) {
    expect(validateSqlArtifact("migration-up.sql", sql, "ADVISORY_ONLY")).toContainEqual(
      expect.objectContaining({ code: "UNSAFE_SQL_CHARACTER" }),
    );
  }
});

it("rejects unsafe controls in comments before tokenization", () => {
  expect(
    validateSqlArtifact(
      "migration-up.sql",
      '-- metadata\u0000\nSHOW COLUMNS IN TABLE "DB"."PUBLIC"."T";',
      "ADVISORY_ONLY",
    ),
  ).toContainEqual(expect.objectContaining({ code: "UNSAFE_SQL_CHARACTER" }));
});

it("does not treat non-ASCII whitespace as SQL grammar spacing", () => {
  expect(
    validateSqlArtifact(
      "validation.sql",
      'SHOW\u00a0COLUMNS IN TABLE "DB"."PUBLIC"."T";',
      "ADVISORY_ONLY",
    ),
  ).toContainEqual(expect.objectContaining({ code: "PROHIBITED_SQL" }));
});

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

  it("rejects an unsupported shape before parser success can matter", () => {
    const findings = validateSqlArtifact(
      "migration-up.sql",
      'ALTER TABLE "DB"."PUBLIC"."T" INVALID SNOWFLAKE SYNTAX;',
      "ADVISORY_ONLY",
    );

    expect(findings).toEqual([
      {
        code: "PROHIBITED_SQL",
        message: "SQL is outside the exact statement allowlist.",
        filename: "migration-up.sql",
      },
    ]);
  });
});
