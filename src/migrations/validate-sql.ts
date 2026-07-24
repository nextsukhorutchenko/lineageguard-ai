import { Parser } from "node-sql-parser";
import type { ExecutionClassification } from "../workflow/migration-draft.js";
import type { MigrationArtifactFilename } from "./render-snowflake-package.js";

export interface PackageFinding {
  readonly code: string;
  readonly message: string;
  readonly filename?: MigrationArtifactFilename;
}

const prohibited = /\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|CREATE\s+OR\s+REPLACE)\b/iu;
const allowedStart = /^(?:ALTER\s+TABLE|UPDATE|SELECT|SHOW\s+COLUMNS\s+IN\s+TABLE)\b/iu;

function executableStatements(sql: string): readonly string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/u, "").trim())
    .filter(Boolean)
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
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
  const statements = executableStatements(sql);
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
    if (prohibited.test(statement) || !allowedStart.test(statement)) {
      findings.push({
        code: "PROHIBITED_SQL",
        message: "SQL is outside the allowlist.",
        filename,
      });
      continue;
    }
    if (/^SHOW\s+COLUMNS\s+IN\s+TABLE\s+"[^"]+"\."[^"]+"\."[^"]+"$/iu.test(statement)) {
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
