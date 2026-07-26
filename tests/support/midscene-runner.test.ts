import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  buildMidsceneChildEnvironment,
  runMidsceneExploratory,
  validateMidsceneEnvironment,
} from "./midscene-runner.js";

const validEnvironment = {
  NODE_ENV: "test",
  LINEAGEGUARD_MIDSCENE_EXPLORATORY: "1",
  MIDSCENE_MODEL_BASE_URL: "codex://app-server",
  MIDSCENE_MODEL_NAME: "visual-model",
  MIDSCENE_MODEL_FAMILY: "openai",
} satisfies NodeJS.ProcessEnv;

const fakeChild = (exitCode: number | null): ChildProcess => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: null,
    pid: 123,
    kill: vi.fn(() => true),
  }) as unknown as ChildProcess;
  if (exitCode !== null) {
    queueMicrotask(() => {
      Object.defineProperty(child, "exitCode", { configurable: true, value: exitCode });
      child.emit("close", exitCode, null);
    });
  }
  return child;
};

describe("Midscene exploratory runner", () => {
  it("requires explicit opt-in and bounded model settings", () => {
    expect(() =>
      validateMidsceneEnvironment({
        ...validEnvironment,
        LINEAGEGUARD_MIDSCENE_EXPLORATORY: "yes",
      }),
    ).toThrow("Midscene exploratory configuration is unavailable.");
    for (const key of [
      "MIDSCENE_MODEL_BASE_URL",
      "MIDSCENE_MODEL_NAME",
      "MIDSCENE_MODEL_FAMILY",
    ] as const) {
      expect(() => validateMidsceneEnvironment({ ...validEnvironment, [key]: "" })).toThrow(
        "Midscene exploratory configuration is unavailable.",
      );
    }
    expect(() =>
      validateMidsceneEnvironment({
        ...validEnvironment,
        MIDSCENE_MODEL_BASE_URL: "https://models.example.test",
      }),
    ).toThrow("Midscene exploratory configuration is unavailable.");
    expect(() =>
      validateMidsceneEnvironment({
        ...validEnvironment,
        MIDSCENE_MODEL_NAME: "unsafe\nmodel",
      }),
    ).toThrow("Midscene exploratory configuration is unavailable.");
    expect(() =>
      validateMidsceneEnvironment({
        ...validEnvironment,
        MIDSCENE_MODEL_FAMILY: "x".repeat(2_049),
      }),
    ).toThrow("Midscene exploratory configuration is unavailable.");
  });

  it("allows keyed endpoints without exposing unrelated credentials", () => {
    const cwd = "D:\\bounded-repository";
    const child = buildMidsceneChildEnvironment(
      {
        ...validEnvironment,
        MIDSCENE_MODEL_BASE_URL: "https://models.example.test",
        MIDSCENE_MODEL_API_KEY: "model-secret",
        OPENAI_API_KEY: "unrelated-openai-secret",
        GITHUB_TOKEN: "github-secret",
        GH_TOKEN: "gh-secret",
        DATAHUB_GMS_TOKEN: "datahub-secret",
        PATH: "safe-path",
      },
      cwd,
    );

    expect(child).toMatchObject({
      LINEAGEGUARD_MIDSCENE_EXPLORATORY: "1",
      MIDSCENE_MODEL_BASE_URL: "https://models.example.test",
      MIDSCENE_MODEL_API_KEY: "model-secret",
      MIDSCENE_MODEL_NAME: "visual-model",
      MIDSCENE_MODEL_FAMILY: "openai",
      MIDSCENE_MODEL_TIMEOUT: "60000",
      MIDSCENE_MODEL_RETRY_COUNT: "0",
      PATH: "safe-path",
    });
    expect(child.MIDSCENE_RUN_DIR).toMatch(/[\\/]\.tmp[\\/]midscene[\\/]run$/u);
    expect(child).not.toHaveProperty("OPENAI_API_KEY");
    expect(child).not.toHaveProperty("GITHUB_TOKEN");
    expect(child).not.toHaveProperty("GH_TOKEN");
    expect(child).not.toHaveProperty("DATAHUB_GMS_TOKEN");
  });

  it.each([
    [0, 0, "Midscene exploratory run completed.\n"],
    [2, 1, "Midscene exploratory run failed.\n"],
  ])("returns a fixed result for child exit %i", async (childExit, expected, message) => {
    const output: string[] = [];
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-midscene-"));

    const result = await runMidsceneExploratory({
      cwd,
      env: validEnvironment,
      resolveCli: () => "playwright-cli.js",
      spawnChild: () => fakeChild(childExit),
      write: (value) => output.push(value),
    });

    expect(result).toBe(expected);
    expect(output).toEqual([message]);
  });

  it("spawns only the installed Playwright CLI with fixed arguments", async () => {
    let invocation: readonly [string, readonly string[], NodeJS.ProcessEnv, string] | undefined;
    const spawnChild = (
      cli: string,
      args: readonly string[],
      environment: NodeJS.ProcessEnv,
      childCwd: string,
    ): ChildProcess => {
      invocation = [cli, args, environment, childCwd];
      return fakeChild(0);
    };
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-midscene-"));

    await runMidsceneExploratory({
      cwd,
      env: validEnvironment,
      resolveCli: () => "playwright-cli.js",
      spawnChild,
      write: () => undefined,
    });

    expect(invocation?.[0]).toBe("playwright-cli.js");
    expect(invocation?.[1]).toEqual(["test", "--config=playwright.midscene.config.ts"]);
    expect(invocation?.[3]).toBe(cwd);
  });

  it("replaces spawn errors with one fixed failure", async () => {
    const output: string[] = [];
    const child = fakeChild(null);

    const result = await runMidsceneExploratory({
      cwd: await mkdtemp(join(tmpdir(), "lineageguard-midscene-")),
      env: validEnvironment,
      resolveCli: () => "playwright-cli.js",
      spawnChild: () => {
        queueMicrotask(() => child.emit("error", new Error("private spawn detail")));
        return child;
      },
      write: (value) => output.push(value),
    });

    expect(result).toBe(1);
    expect(output).toEqual(["Midscene exploratory run failed.\n"]);
  });

  it("rejects a symlinked Midscene output root", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "lineageguard-midscene-"));
    const outside = await mkdtemp(join(tmpdir(), "lineageguard-midscene-outside-"));
    await symlink(outside, join(cwd, ".tmp"), "junction");
    const spawnChild = vi.fn();

    const result = await runMidsceneExploratory({
      cwd,
      env: validEnvironment,
      resolveCli: () => "playwright-cli.js",
      spawnChild,
      write: () => undefined,
    });

    expect(result).toBe(1);
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it("bounds a non-terminal child and emits no child output", async () => {
    const output: string[] = [];
    const child = fakeChild(null);
    (child.stdout as PassThrough).end("private child stdout");
    (child.stderr as PassThrough).end("private child stderr");
    const terminate = vi.fn(async () => {
      Object.defineProperty(child, "exitCode", { configurable: true, value: 1 });
      child.emit("close", 1, null);
    });

    const result = await runMidsceneExploratory({
      cwd: await mkdtemp(join(tmpdir(), "lineageguard-midscene-")),
      env: validEnvironment,
      resolveCli: () => "playwright-cli.js",
      spawnChild: () => child,
      timeoutMs: 5,
      terminate,
      write: (value) => output.push(value),
    });

    expect(result).toBe(1);
    expect(terminate).toHaveBeenCalledOnce();
    expect(output).toEqual(["Midscene exploratory run failed.\n"]);
    expect(output.join("")).not.toContain("private");
  });
});
