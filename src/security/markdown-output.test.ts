import { describe, expect, it } from "vitest";
import { sanitizeBoundaryText } from "./sanitize-output.js";
import { escapeMarkdownText, markdownCodeSpan } from "./markdown-output.js";

function backtickRunAt(value: string, index: number): number {
  let length = 0;
  while (value[index + length] === "`") length += 1;
  return length;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "`") continue;
    const length = backtickRunAt(value, index);
    longest = Math.max(longest, length);
    index += length - 1;
  }
  return longest;
}

function stripWellFormedCodeSpans(markdown: string): string {
  let outside = "";
  let index = 0;
  while (index < markdown.length) {
    if (markdown[index] !== "`") {
      outside += markdown[index];
      index += 1;
      continue;
    }

    const fenceLength = backtickRunAt(markdown, index);
    let cursor = index + fenceLength;
    let closed = false;
    while (cursor < markdown.length) {
      if (markdown[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      const runLength = backtickRunAt(markdown, cursor);
      if (runLength > fenceLength) throw new Error("Undersized code-span fence.");
      if (runLength === fenceLength) {
        index = cursor + runLength;
        closed = true;
        break;
      }
      cursor += runLength;
    }
    if (!closed) throw new Error("Unclosed code span.");
  }
  return outside;
}

describe("markdownCodeSpan", () => {
  it.each([
    "plain",
    "`single`",
    "``repeated```",
    "<script>|[link](https://example.test)|one`two```three|Ω雪",
  ])("uses a fence longer than every backtick run in %j", (value) => {
    const rendered = markdownCodeSpan(value);
    const fenceLength = backtickRunAt(rendered, 0);
    const fence = "`".repeat(fenceLength);

    expect(fenceLength).toBe(longestBacktickRun(value) + 1);
    expect(rendered).toBe(`${fence} ${value} ${fence}`);
  });

  it("keeps HTML-like text inside a removable code span with exact raw evidence", () => {
    const evidence = "<script>|[evidence](javascript:alert(1))|`id``Ω";
    const markdown = `Evidence: ${markdownCodeSpan(evidence)}.`;

    expect(markdown).toContain(evidence);
    expect(stripWellFormedCodeSpans(markdown)).toBe("Evidence: .");
    expect(stripWellFormedCodeSpans(markdown)).not.toContain("<");
  });

  it("preserves an all-space value without unsafe padding", () => {
    expect(markdownCodeSpan("  ")).toBe("`  `");
  });

  it("quotes already boundary-sanitized controls without reinterpreting them", () => {
    const sanitized = sanitizeBoundaryText("line\n\u001b|<script>Ω", [], 500);
    const rendered = markdownCodeSpan(sanitized);

    expect(sanitized).toBe("line\\n\\u001B|<script>Ω");
    expect(rendered).toContain(sanitized);
    expect(stripWellFormedCodeSpans(rendered)).toBe("");
  });

  it("has a strict test scanner that rejects unclosed and undersized fences", () => {
    expect(() => stripWellFormedCodeSpans("before `` unclosed")).toThrow("Unclosed code span.");
    expect(() => stripWellFormedCodeSpans("before `` value ``` still open `` after")).toThrow(
      "Undersized code-span fence.",
    );
  });
});

describe("escapeMarkdownText", () => {
  it("escapes Markdown delimiters, angle brackets, pipes, and physical line breaks", () => {
    const value = "\\*_[x](y)|<tag>`tick`\n\r\u2028\u2029";

    expect(escapeMarkdownText(value)).toBe(
      String.raw`\\\*\_\[x\]\(y\)\|\<tag\>\`tick\`\\n\\r\\u2028\\u2029`,
    );
  });

  it("preserves mixed Unicode text", () => {
    expect(escapeMarkdownText("Résumé 雪 Ω")).toBe("Résumé 雪 Ω");
  });
});
