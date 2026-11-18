import { AsyncLocalStorage } from "node:async_hooks";
import type { ScorerResult, SuiteConfig, TestMetrics } from "./types";

class Collector {
  private suiteConfigs: Map<string, SuiteConfig> = new Map();
  private suiteNames: Map<string, string> = new Map();
  private testResults: TestMetrics[] = [];
  private evalFiles: Map<string, string> = new Map();
  private currentEntryStorage: AsyncLocalStorage<TestMetrics> = new AsyncLocalStorage();
  private legacyCurrentEntry: TestMetrics | null = null;

  registerSuite(suiteName: string, config: SuiteConfig, evalFilePath?: string) {
    const suiteKey = this.createSuiteKey(suiteName, evalFilePath);
    this.suiteConfigs.set(suiteKey, config);
    this.suiteNames.set(suiteKey, suiteName);
    if (evalFilePath) {
      this.evalFiles.set(suiteKey, evalFilePath);
    }
    return suiteKey;
  }

  configureSuite(name: string, config: SuiteConfig) {
    this.suiteConfigs.set(name, config);
    this.suiteNames.set(name, name);
  }

  getSuiteConfig(suiteKey: string) {
    return this.suiteConfigs.get(suiteKey);
  }

  getSuiteName(suiteKey: string) {
    return this.suiteNames.get(suiteKey);
  }

  setEvalFile(suiteKey: string, filePath: string) {
    this.evalFiles.set(suiteKey, filePath);
  }

  getEvalFile(suiteKey: string) {
    return this.evalFiles.get(suiteKey);
  }

  beginTest(suiteKeyOrName: string, suiteNameOrTestName: string, maybeTestName?: string) {
    const suiteKey = suiteKeyOrName;
    const suiteName = maybeTestName ? suiteNameOrTestName : suiteKeyOrName;
    const testName = maybeTestName ?? suiteNameOrTestName;

    const entry = this.createTestEntry(suiteKey, suiteName, testName);
    this.testResults.push(entry);
    this.legacyCurrentEntry = entry;
  }

  async runTest<T>(suiteKey: string, suiteName: string, testName: string, fn: () => Promise<T>) {
    const entry = this.createTestEntry(suiteKey, suiteName, testName);
    this.testResults.push(entry);

    return this.currentEntryStorage.run(entry, fn);
  }

  endTest() {
    this.legacyCurrentEntry = null;
  }

  recordMetric(name: string, value: number, _unit?: string) {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.metrics[name] = value;
  }

  recordScore(name: string, value: number) {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.metrics[`score.${name}`] = value;
  }

  recordTokens(usage: { promptTokens: number; completionTokens: number; totalTokens?: number }) {
    const entry = this.currentEntry();
    if (!entry) return;
    const phase = entry._phase;
    const prefix = phase === "scoring" ? "tokens.scorer" : "tokens";

    const currentInput = numberMetric(entry.metrics[`${prefix}.input`]);
    const currentOutput = numberMetric(entry.metrics[`${prefix}.output`]);
    const currentTotal = numberMetric(entry.metrics[`${prefix}.total`]);
    const nextTotal = usage.totalTokens ?? usage.promptTokens + usage.completionTokens;

    entry.metrics[`${prefix}.input`] = currentInput + usage.promptTokens;
    entry.metrics[`${prefix}.output`] = currentOutput + usage.completionTokens;
    entry.metrics[`${prefix}.total`] = currentTotal + nextTotal;
  }

  setPhase(phase: "task" | "scoring") {
    const entry = this.currentEntry();
    if (!entry) return;
    entry._phase = phase;
  }

  setWeight(weight: number) {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.weight = weight;
  }

  setTestPassed(passed: boolean) {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.passed = passed;
  }

  setTestContext(context: { input: unknown; output: unknown; expected?: unknown }) {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.input = context.input;
    entry.output = context.output;
    entry.expected = context.expected;
  }

  addScorerResult(result: ScorerResult) {
    const entry = this.currentEntry();
    if (!entry) return;
    entry.scorerResults.push(result);
  }

  getTestResults() {
    return this.testResults;
  }

  getTestResultsForSuite(suiteKey: string) {
    return this.testResults.filter((test) => test.suiteKey === suiteKey);
  }

  getSuiteKeys() {
    return [...new Set(this.testResults.map((test) => test.suiteKey))];
  }

  getSuiteNames() {
    return this.getSuiteKeys()
      .map((suiteKey) => this.suiteNames.get(suiteKey) ?? suiteKey)
      .filter((suiteName) => suiteName.length > 0);
  }

  reset() {
    this.suiteConfigs.clear();
    this.suiteNames.clear();
    this.testResults = [];
    this.evalFiles.clear();
    this.legacyCurrentEntry = null;
  }

  private currentEntry() {
    const activeEntry = this.currentEntryStorage.getStore();
    if (activeEntry) return activeEntry;

    if (this.legacyCurrentEntry) {
      return this.legacyCurrentEntry;
    }

    console.warn("[@goodit/evals] No active test — call beginTest() before recording metrics");
    return null;
  }

  private createSuiteKey(suiteName: string, evalFilePath?: string) {
    const identity = evalFilePath ?? "<unknown>";
    const baseKey = `${identity}::${suiteName}`;
    if (!this.suiteConfigs.has(baseKey)) {
      return baseKey;
    }

    let suffix = 2;
    let candidate = `${baseKey}#${suffix}`;
    while (this.suiteConfigs.has(candidate)) {
      suffix += 1;
      candidate = `${baseKey}#${suffix}`;
    }

    return candidate;
  }

  private createTestEntry(suiteKey: string, suiteName: string, testName: string) {
    const entry: TestMetrics = {
      suiteKey,
      suiteName,
      testName,
      metrics: {},
      weight: 1,
      passed: true,
      scorerResults: [],
      _phase: "task",
    };
    return entry;
  }
}

function numberMetric(value: number | boolean | undefined) {
  return typeof value === "number" ? value : 0;
}

export const collector = new Collector();
export type { Collector };
