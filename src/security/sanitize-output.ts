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

function makeControlsVisible(value: unknown): string {
  return String(value).replace(controlCharacter, visibleControlCharacter);
}

function encodeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeInlineMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]|])/gu, "\\$1");
}

export function sanitizeMarkdownTableCell(value: unknown): string {
  return escapeInlineMarkdown(encodeHtml(makeControlsVisible(value)));
}

export function sanitizeMarkdownText(value: unknown): string {
  return escapeInlineMarkdown(encodeHtml(makeControlsVisible(value)));
}

export function sanitizeTerminalText(value: unknown): string {
  return makeControlsVisible(value);
}
