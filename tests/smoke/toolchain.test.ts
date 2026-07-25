import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs on the pinned Node major version", () => {
    expect(Number.parseInt(process.versions.node, 10)).toBe(22);
  });

  it("pins the approved browser and agent toolchain", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.dependencies).toMatchObject({
      "@openai/agents": "0.13.5",
      next: "16.2.11",
      "node-sql-parser": "5.4.0",
      react: "19.2.8",
      "react-dom": "19.2.8",
    });
    expect(packageJson.devDependencies).toMatchObject({
      "@eslint/js": "9.39.5",
      "@playwright/test": "1.61.1",
      "@types/react": "19.2.17",
      "@types/react-dom": "19.2.3",
      eslint: "9.39.5",
      "eslint-config-next": "16.2.11",
    });
    expect(packageJson.scripts).toMatchObject({
      "build:cli": "tsc -p tsconfig.build.json",
      "build:web": "next build --webpack",
      dev: "next dev --webpack",
      "start:web": "next start",
      "test:e2e": "playwright test",
    });
  });
});
