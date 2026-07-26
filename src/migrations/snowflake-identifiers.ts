const safeIdentifier = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export interface SnowflakeObjectName {
  readonly database: string;
  readonly schema: string;
  readonly table: string;
}

export function parseSnowflakeObjectName(value: string): SnowflakeObjectName | undefined {
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !safeIdentifier.test(part))) return undefined;
  const [database, schema, table] = parts;
  return database === undefined || schema === undefined || table === undefined
    ? undefined
    : { database, schema, table };
}

export function quoteSnowflakeIdentifier(value: string): string {
  if (value.length === 0 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
    throw new Error("Snowflake identifiers must be non-empty printable text.");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function renderSnowflakeObjectName(name: SnowflakeObjectName): string {
  return [name.database, name.schema, name.table].map(quoteSnowflakeIdentifier).join(".");
}
