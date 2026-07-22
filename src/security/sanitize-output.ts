import { redact } from "./redact.js";

const controlCharacter = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function visibleControlCharacter(character: string): string {
  if (character === "\n") return "\\n";
  if (character === "\r") return "\\r";
  if (character === "\t") return "\\t";

  const codePoint = character.codePointAt(0);
  return codePoint === undefined
    ? ""
    : `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function makeControlsVisible(value: unknown, secrets: readonly string[]): string {
  return String(redact(String(value), secrets)).replace(controlCharacter, visibleControlCharacter);
}

const credentialPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /\b(?:sk-(?:proj-)?|github_pat_|gh[pousr]_)[A-Za-z0-9_-]{20,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu,
] as const;

export function sanitizeBoundaryText(
  value: unknown,
  secrets: readonly string[] = [],
  maxLength: number,
): string {
  let safe = String(redact(String(value), secrets));
  for (const pattern of credentialPatterns) safe = safe.replace(pattern, "[REDACTED]");
  safe = safe.normalize("NFC").replace(controlCharacter, visibleControlCharacter);
  return safe.slice(0, Math.max(0, Math.trunc(maxLength)));
}

function encodeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeInlineMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]|])/gu, "\\$1");
}

export function sanitizeMarkdownTableCell(value: unknown, secrets: readonly string[] = []): string {
  return escapeInlineMarkdown(encodeHtml(makeControlsVisible(value, secrets)));
}

export function sanitizeMarkdownText(value: unknown, secrets: readonly string[] = []): string {
  return escapeInlineMarkdown(encodeHtml(makeControlsVisible(value, secrets)));
}

export function sanitizeTerminalText(value: unknown, secrets: readonly string[] = []): string {
  return makeControlsVisible(value, secrets);
}
