import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import {
  ImpactContextSchema,
  ImpactReportSchema,
  MAX_REPORT_JSON_BYTES,
  type ImpactContext,
} from "../../support/pr-impact/contracts.js";
import {
  IMPACT_CONTEXT_PATH,
  prepareImpactReportPublication,
  publishImpactReport,
} from "../../support/pr-impact/publication.js";
import {
  buildImpactReport,
  renderImpactMarkdown,
  type ObservedTestResult,
} from "../../support/pr-impact/report.js";
import { SCENARIO_TAGS } from "../../support/pr-impact/scenario-tags.js";

interface ReporterOptions {
  readonly cwd?: string;
  readonly publish?: typeof publishImpactReport;
}

interface MutableObservation {
  readonly id: string;
  readonly tags: string[];
  readonly expectedStatus: string;
  readonly attempts: Array<{ retry: number; status: string }>;
}

const unavailableContext = (): ImpactContext =>
  ImpactContextSchema.parse({
    schemaVersion: "1",
    source: "IMPACT_CONTEXT_UNAVAILABLE",
    disposition: "FULL_SUITE_REQUIRED",
    changedPaths: [],
    impactedAreas: [],
    expectedTags: [...SCENARIO_TAGS],
    reasonCodes: ["GIT_COMPARISON_UNAVAILABLE"],
  });

export class PrImpactReporter implements Reporter {
  readonly #cwd: string;
  readonly #publish: typeof publishImpactReport;
  readonly #observations = new Map<string, MutableObservation>();

  public constructor(options: ReporterOptions = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#publish = options.publish ?? publishImpactReport;
  }

  public onBegin(_config: FullConfig, suite: Suite): void {
    for (const test of suite.allTests()) {
      this.#observationFor(test);
    }
  }

  public onTestEnd(test: TestCase, result: TestResult): void {
    this.#observationFor(test).attempts.push({
      retry: result.retry,
      status: result.status,
    });
  }

  public async onEnd(result: FullResult): Promise<void> {
    try {
      await prepareImpactReportPublication(this.#cwd);
      const context = await this.#loadContext();
      const tests: ObservedTestResult[] = [...this.#observations.values()];
      const report = ImpactReportSchema.parse(buildImpactReport(context, result.status, tests));
      const json = `${JSON.stringify(report, null, 2)}\n`;
      if (Buffer.byteLength(json, "utf8") > MAX_REPORT_JSON_BYTES) {
        throw new Error("PR impact report is unavailable.");
      }
      await this.#publish(json, renderImpactMarkdown(report), this.#cwd);
    } catch {
      // Advisory publication must never change or obscure the Playwright result.
    }
  }

  public printsToStdio(): boolean {
    return false;
  }

  #observationFor(test: TestCase): MutableObservation {
    const existing = this.#observations.get(test.id);
    if (existing) return existing;
    const observation = {
      id: test.id,
      tags: [...test.tags],
      expectedStatus: test.expectedStatus,
      attempts: [],
    };
    this.#observations.set(test.id, observation);
    return observation;
  }

  async #loadContext(): Promise<ImpactContext> {
    try {
      const content = await readFile(join(this.#cwd, IMPACT_CONTEXT_PATH), "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_REPORT_JSON_BYTES) return unavailableContext();
      return ImpactContextSchema.parse(JSON.parse(content));
    } catch {
      return unavailableContext();
    }
  }
}

export default PrImpactReporter;
