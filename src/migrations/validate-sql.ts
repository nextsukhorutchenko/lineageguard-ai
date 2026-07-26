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
const spacing = String.raw`[ \t\n]`;
const optionalSpacing = `${spacing}*`;
const requiredSpacing = `${spacing}+`;
const unsafeSqlCharacter = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const addColumnPattern = new RegExp(
  `^ALTER${requiredSpacing}TABLE${requiredSpacing}${snowflakeObjectPattern}${requiredSpacing}ADD${requiredSpacing}COLUMN${requiredSpacing}IF${requiredSpacing}NOT${requiredSpacing}EXISTS${requiredSpacing}${quotedIdentifierPattern}${requiredSpacing}${nativeTypePattern}$`,
  "iu",
);
const renameColumnPattern = new RegExp(
  `^ALTER${requiredSpacing}TABLE${requiredSpacing}(${snowflakeObjectPattern})${requiredSpacing}RENAME${requiredSpacing}COLUMN${requiredSpacing}(${quotedIdentifierPattern})${requiredSpacing}TO${requiredSpacing}(${quotedIdentifierPattern})$`,
  "iu",
);
const updateBackfillPattern = new RegExp(
  `^UPDATE${requiredSpacing}(${snowflakeObjectPattern})${requiredSpacing}SET${requiredSpacing}(${quotedIdentifierPattern})${optionalSpacing}=${optionalSpacing}(${quotedIdentifierPattern})${requiredSpacing}WHERE${requiredSpacing}(${quotedIdentifierPattern})${requiredSpacing}IS${requiredSpacing}NULL$`,
  "iu",
);
const showColumnsPattern = new RegExp(
  `^SHOW${requiredSpacing}COLUMNS${requiredSpacing}IN${requiredSpacing}TABLE${requiredSpacing}${snowflakeObjectPattern}$`,
  "iu",
);
const directValidationPattern = new RegExp(
  `^SELECT${requiredSpacing}COUNT${optionalSpacing}\\(${optionalSpacing}\\*${optionalSpacing}\\)${requiredSpacing}AS${requiredSpacing}row_count${optionalSpacing},${optionalSpacing}COUNT_IF${optionalSpacing}\\(${optionalSpacing}(${quotedIdentifierPattern})${requiredSpacing}IS${requiredSpacing}NULL${optionalSpacing}\\)${requiredSpacing}AS${requiredSpacing}target_null_count${requiredSpacing}FROM${requiredSpacing}${snowflakeObjectPattern}$`,
  "iu",
);
const stagedValidationPattern = new RegExp(
  `^SELECT${requiredSpacing}COUNT${optionalSpacing}\\(${optionalSpacing}\\*${optionalSpacing}\\)${requiredSpacing}AS${requiredSpacing}row_count${optionalSpacing},${optionalSpacing}COUNT_IF${optionalSpacing}\\(${optionalSpacing}(${quotedIdentifierPattern})${requiredSpacing}IS${requiredSpacing}NULL${optionalSpacing}\\)${requiredSpacing}AS${requiredSpacing}source_null_count${optionalSpacing},${optionalSpacing}COUNT_IF${optionalSpacing}\\(${optionalSpacing}(${quotedIdentifierPattern})${requiredSpacing}IS${requiredSpacing}NULL${optionalSpacing}\\)${requiredSpacing}AS${requiredSpacing}target_null_count${optionalSpacing},${optionalSpacing}COUNT_IF${optionalSpacing}\\(${optionalSpacing}(${quotedIdentifierPattern})${requiredSpacing}IS${requiredSpacing}DISTINCT${requiredSpacing}FROM${requiredSpacing}(${quotedIdentifierPattern})${optionalSpacing}\\)${requiredSpacing}AS${requiredSpacing}mismatched_count${requiredSpacing}FROM${requiredSpacing}${snowflakeObjectPattern}$`,
  "iu",
);

export function executableSqlStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let current = "";
  let inComment = false;
  let inQuotedIdentifier = false;

  const appendCurrent = (): void => {
    const statement = current.replace(/^[ \t\n]+|[ \t\n]+$/gu, "");
    if (statement.length > 0) statements.push(statement);
    current = "";
  };

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1];
    if (inComment) {
      if (character === "\n") {
        inComment = false;
        current += character;
      }
      continue;
    }
    if (inQuotedIdentifier) {
      current += character;
      if (character === '"') {
        if (next === '"') {
          current += next;
          index += 1;
        } else {
          inQuotedIdentifier = false;
        }
      }
      continue;
    }
    if (character === '"') {
      inQuotedIdentifier = true;
      current += character;
      continue;
    }
    if (character === "-" && next === "-") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === ";") {
      appendCurrent();
      continue;
    }
    current += character;
  }
  appendCurrent();
  return statements;
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
  return statement.replace(/\b(ADD[ \t\n]+COLUMN)[ \t\n]+IF[ \t\n]+NOT[ \t\n]+EXISTS\b/iu, "$1");
}

function containsUnsafeSqlCharacter(sql: string): boolean {
  for (const character of sql) {
    if (character !== "\t" && character !== "\n" && unsafeSqlCharacter.test(character)) {
      return true;
    }
  }
  return false;
}

export function validateSqlArtifact(
  filename: Exclude<MigrationArtifactFilename, "rollout-plan.md">,
  sql: string,
  classification: ExecutionClassification,
): readonly PackageFinding[] {
  const findings: PackageFinding[] = [];
  if (containsUnsafeSqlCharacter(sql)) {
    return [
      {
        code: "UNSAFE_SQL_CHARACTER",
        message: "SQL contains an unsafe control or line-separator character.",
        filename,
      },
    ];
  }
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
