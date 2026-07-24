import { Parser } from "node-sql-parser";
import type { ExecutionClassification } from "../workflow/migration-draft.js";
import type { MigrationArtifactFilename } from "./render-snowflake-package.js";

export interface PackageFinding {
  readonly code: string;
  readonly message: string;
  readonly filename?: MigrationArtifactFilename;
}

export interface SnowflakeRenameStatement {
  readonly table: string;
  readonly source: string;
  readonly target: string;
}

type SupportedStatementKind =
  | "ADD_COLUMN"
  | "DIRECT_VALIDATION"
  | "RENAME_COLUMN"
  | "SHOW_COLUMNS"
  | "STAGED_VALIDATION"
  | "UPDATE_BACKFILL";

const quotedIdentifierPattern = String.raw`"(?:""|[^"\p{Cc}\p{Cf}\p{Zl}\p{Zp}])+"`;
const snowflakeObjectPattern = `${quotedIdentifierPattern}\\.${quotedIdentifierPattern}\\.${quotedIdentifierPattern}`;
const nativeTypePattern = String.raw`[A-Za-z][A-Za-z0-9_]*(?:\(\d+(?:,\d+)?\))?`;

const addColumnPattern = new RegExp(
  `^ALTER\\s+TABLE\\s+${snowflakeObjectPattern}\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${quotedIdentifierPattern}\\s+${nativeTypePattern}$`,
  "iu",
);
const renameColumnPattern = new RegExp(
  `^ALTER\\s+TABLE\\s+(${snowflakeObjectPattern})\\s+RENAME\\s+COLUMN\\s+(${quotedIdentifierPattern})\\s+TO\\s+(${quotedIdentifierPattern})$`,
  "iu",
);
const updateBackfillPattern = new RegExp(
  `^UPDATE\\s+(${snowflakeObjectPattern})\\s+SET\\s+(${quotedIdentifierPattern})\\s*=\\s*(${quotedIdentifierPattern})\\s+WHERE\\s+(${quotedIdentifierPattern})\\s+IS\\s+NULL$`,
  "iu",
);
const showColumnsPattern = new RegExp(
  `^SHOW\\s+COLUMNS\\s+IN\\s+TABLE\\s+${snowflakeObjectPattern}$`,
  "iu",
);
const directValidationPattern = new RegExp(
  `^SELECT\\s+COUNT\\s*\\(\\s*\\*\\s*\\)\\s+AS\\s+row_count\\s*,\\s*COUNT_IF\\s*\\(\\s*(${quotedIdentifierPattern})\\s+IS\\s+NULL\\s*\\)\\s+AS\\s+target_null_count\\s+FROM\\s+${snowflakeObjectPattern}$`,
  "iu",
);
const stagedValidationPattern = new RegExp(
  `^SELECT\\s+COUNT\\s*\\(\\s*\\*\\s*\\)\\s+AS\\s+row_count\\s*,\\s*COUNT_IF\\s*\\(\\s*(${quotedIdentifierPattern})\\s+IS\\s+NULL\\s*\\)\\s+AS\\s+source_null_count\\s*,\\s*COUNT_IF\\s*\\(\\s*(${quotedIdentifierPattern})\\s+IS\\s+NULL\\s*\\)\\s+AS\\s+target_null_count\\s*,\\s*COUNT_IF\\s*\\(\\s*(${quotedIdentifierPattern})\\s+IS\\s+DISTINCT\\s+FROM\\s+(${quotedIdentifierPattern})\\s*\\)\\s+AS\\s+mismatched_count\\s+FROM\\s+${snowflakeObjectPattern}$`,
  "iu",
);

export function executableSqlStatements(sql: string): readonly string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/u, "").trim())
    .filter(Boolean)
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function parseSnowflakeRenameStatement(
  statement: string,
): SnowflakeRenameStatement | undefined {
  const match = renameColumnPattern.exec(statement);
  const table = match?.[1];
  const source = match?.[2];
  const target = match?.[3];
  return table === undefined || source === undefined || target === undefined
    ? undefined
    : { table, source, target };
}

function supportedStatementKind(statement: string): SupportedStatementKind | undefined {
  if (parseSnowflakeRenameStatement(statement) !== undefined) return "RENAME_COLUMN";
  if (addColumnPattern.test(statement)) return "ADD_COLUMN";
  if (showColumnsPattern.test(statement)) return "SHOW_COLUMNS";

  const update = updateBackfillPattern.exec(statement);
  if (update !== null && update[2] === update[4]) return "UPDATE_BACKFILL";

  if (directValidationPattern.test(statement)) return "DIRECT_VALIDATION";

  const stagedValidation = stagedValidationPattern.exec(statement);
  if (
    stagedValidation !== null &&
    stagedValidation[1] === stagedValidation[3] &&
    stagedValidation[2] === stagedValidation[4]
  ) {
    return "STAGED_VALIDATION";
  }
  return undefined;
}

function parserCompatibleStatement(statement: string): string {
  return statement.replace(
    /^(\s*ALTER\s+TABLE\b[\s\S]*?\bADD\s+COLUMN)\s+IF\s+NOT\s+EXISTS\b/iu,
    "$1",
  );
}

export function validateSqlArtifact(
  filename: Exclude<MigrationArtifactFilename, "rollout-plan.md">,
  sql: string,
  classification: ExecutionClassification,
): readonly PackageFinding[] {
  const findings: PackageFinding[] = [];
  const statements = executableSqlStatements(sql);
  if (classification === "NON_EXECUTABLE_TEMPLATE") {
    return statements.length === 0
      ? []
      : [
          {
            code: "EXECUTABLE_TEMPLATE_SQL",
            message: "Template output contains SQL.",
            filename,
          },
        ];
  }
  for (const statement of statements) {
    const kind = supportedStatementKind(statement);
    if (kind === undefined) {
      findings.push({
        code: "PROHIBITED_SQL",
        message: "SQL is outside the exact statement allowlist.",
        filename,
      });
      continue;
    }
    if (kind === "SHOW_COLUMNS" || kind === "RENAME_COLUMN") {
      continue;
    }
    try {
      new Parser().astify(`${parserCompatibleStatement(statement)};`, {
        database: "Snowflake",
      });
    } catch {
      findings.push({
        code: "SNOWFLAKE_PARSE_FAILED",
        message: "SQL parser rejected the statement.",
        filename,
      });
    }
  }
  return findings;
}
