function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function markdownCodeSpan(value: string): string {
  if (value.length === 0) throw new Error("Markdown code-span values must be non-empty.");
  const fence = "`".repeat(longestBacktickRun(value) + 1);
  return /^ +$/u.test(value) ? `${fence}${value}${fence}` : `${fence} ${value} ${fence}`;
}

export function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n|\u2028|\u2029/gu, (lineBreak) => {
      if (lineBreak === "\r\n") return "\\\\r\\\\n";
      if (lineBreak === "\r") return "\\\\r";
      if (lineBreak === "\n") return "\\\\n";
      return lineBreak === "\u2028" ? "\\\\u2028" : "\\\\u2029";
    })
    .replace(/[`*_[\]()|<>]/gu, (delimiter) => `\\${delimiter}`);
}
